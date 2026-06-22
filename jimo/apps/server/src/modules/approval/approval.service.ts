import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull, desc, inArray, or, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  businessApprovals,
  BusinessApproval,
} from '../../db/schema/business-approvals';
import { sysUsers } from '../../db/schema/users';
import { sysApprovalFlows } from '../../db/schema/sys-approval-flows';
import { ApprovalExecutor } from '@jimo/shared';
import { BpmApprovalCallbackDto } from './bpm-callback.dto';
import {
  StartApprovalDto,
  UpsertApprovalFlowDto,
} from './dto/approval.dto';

/** Postgres unique-violation error code (for race handling). */
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Valid physical table-name suffix. businessType is stored WITHOUT the `lc_`
 * prefix (e.g. "reimbursements"); the physical table is `lc_${businessType}`.
 * Same guard as {@link ../../common/ownership/ownership.service.ts}.
 */
const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/;

export interface ApplyOutcomeResult {
  id: string;
  replay: boolean;
}

interface FlowConfig {
  rules?: Array<{ when?: Record<string, unknown>; chain: string[] }>;
  defaultChain?: string[];
}

/**
 * Unified approval facade.
 * - applyBpmOutcome: ingest BPM outcome callbacks (MVP, idempotent).
 * - startApproval: resolve a dynamic chain from sys_approval_flows + the record,
 *   start the generic BPM flow, track in lc_business_approvals.
 * - getMyTasks / approve: proxy to BPM /api/approvals.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);
  private readonly bpmUrl: string;
  private readonly syncUserId: string;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly config: ConfigService,
  ) {
    this.bpmUrl = (this.config.get<string>('BPM_SERVICE_URL') || 'http://localhost:8090').replace(/\/$/, '');
    this.syncUserId = this.config.get<string>('BPM_SYNC_USER_ID') || 'EMP008';
  }

  // ===================== Start / proxy =====================

  async startApproval(dto: StartApprovalDto, initiatorSysUserId: string) {
    // Resolve the initiator's BPM identity (must be synced + have a dept).
    const u = await this.db
      .select({ bpmUserId: sysUsers.bpmUserId, deptId: sysUsers.deptId })
      .from(sysUsers)
      .where(and(eq(sysUsers.id, initiatorSysUserId), isNull(sysUsers.deletedAt)))
      .limit(1);
    if (!u[0]?.bpmUserId) {
      throw new BadRequestException('Initiator is not synced to BPM (no bpm_user_id)');
    }
    const initiatorBpmId = u[0]!.bpmUserId;

    const chain = await this.resolveChain(dto.businessType, dto.record);
    if (chain.length === 0) {
      throw new BadRequestException(`No approval chain resolved for ${dto.businessType}`);
    }

    const res = await this.callBpm(
      'POST',
      'approvals/start',
      {
        businessType: dto.businessType,
        businessKey: dto.businessId,
        initiator: initiatorBpmId,
        approvalChain: chain,
      },
      this.syncUserId,
    );
    const processInstanceId: string | undefined = res?.data?.processInstanceId;
    if (!processInstanceId) {
      throw new BadRequestException(`BPM did not return a processInstanceId: ${JSON.stringify(res).slice(0, 200)}`);
    }

    await this.trackStarted(dto.businessType, dto.businessId, processInstanceId, initiatorBpmId);
    this.logger.log(`startApproval ${dto.businessType}:${dto.businessId} pi=${processInstanceId} chain=${chain.join(',')}`);
    return { processInstanceId, chain, status: 'PENDING' };
  }

  async getMyTasks(sysUserId: string) {
    const bpmId = await this.bpmIdFor(sysUserId);
    const res = await this.callBpm('GET', `approvals/my-tasks`, undefined, bpmId);
    const items: Array<Record<string, unknown>> = res?.data?.list ?? [];
    if (items.length === 0) return { list: [], total: 0 };
    const enriched = await this.enrichTasks(items);
    // Also fetch the actual business record so the approver sees the detail inline.
    return { list: await this.enrichRecords(enriched), total: items.length };
  }

  async approve(processInstanceId: string, sysUserId: string, approved: boolean, comment?: string) {
    const bpmId = await this.bpmIdFor(sysUserId);
    return this.callBpm('POST', `approvals/${processInstanceId}/approve`, { approved, comment }, bpmId);
  }

  /** Approvals I submitted (from lc_business_approvals by initiator). */
  async myInitiated(sysUserId: string) {
    const bpmId = await this.bpmIdFor(sysUserId);
    const rows = await this.db
      .select({
        businessType: businessApprovals.businessType,
        businessId: businessApprovals.businessId,
        status: businessApprovals.status,
        executor: businessApprovals.executor,
        processInstanceId: businessApprovals.processInstanceId,
        initiatorId: businessApprovals.initiatorId,
        approverId: businessApprovals.approverId,
        comment: businessApprovals.comment,
        createdAt: businessApprovals.createdAt,
        updatedAt: businessApprovals.updatedAt,
      })
      .from(businessApprovals)
      .where(and(eq(businessApprovals.initiatorId, bpmId), isNull(businessApprovals.deletedAt)))
      .orderBy(desc(businessApprovals.createdAt));
    return { list: rows, total: rows.length };
  }

  /** Tasks I've already acted on (已办) — BPM historic tasks, enriched. */
  async myDoneTasks(sysUserId: string) {
    const bpmId = await this.bpmIdFor(sysUserId);
    const res = await this.callBpm('GET', 'approvals/my-done', undefined, bpmId);
    const items: Array<Record<string, unknown>> = res?.data?.list ?? [];
    if (items.length === 0) return { list: [], total: 0 };
    const enriched = await this.enrichTasks(items);
    return { list: await this.enrichRecords(enriched), total: items.length };
  }

  /** Finalized processes I'm involved in (办结) — terminal approvals where I am
   *  the initiator or the final approver. Unified local view (works for both engines). */
  async finalized(sysUserId: string) {
    const bpmId = await this.bpmIdFor(sysUserId);
    const rows = await this.db
      .select({
        businessType: businessApprovals.businessType,
        businessId: businessApprovals.businessId,
        status: businessApprovals.status,
        processInstanceId: businessApprovals.processInstanceId,
        initiatorId: businessApprovals.initiatorId,
        approverId: businessApprovals.approverId,
        comment: businessApprovals.comment,
        updatedAt: businessApprovals.updatedAt,
      })
      .from(businessApprovals)
      .where(
        and(
          inArray(businessApprovals.status, ['APPROVED', 'REJECTED']),
          or(eq(businessApprovals.initiatorId, bpmId), eq(businessApprovals.approverId, bpmId)),
          isNull(businessApprovals.deletedAt),
        ),
      )
      .orderBy(desc(businessApprovals.updatedAt))
      .limit(200);
    return { list: rows, total: rows.length };
  }

  /** My drafts (我的起草) — my owned records of approval-enabled types that are
   *  NOT in a PENDING or APPROVED approval, i.e. never submitted or returned.
   *  Aggregated across all approval-enabled business types via dynamic query. */
  async myDrafts(sysUserId: string) {
    const flows = await this.db
      .select({ businessType: sysApprovalFlows.businessType, name: sysApprovalFlows.name })
      .from(sysApprovalFlows)
      .where(and(eq(sysApprovalFlows.enabled, true), isNull(sysApprovalFlows.deletedAt)));

    const out: Array<Record<string, unknown>> = [];
    for (const f of flows) {
      if (!TABLE_RE.test(f.businessType)) continue;
      const res = await this.db.execute(sql`
        SELECT t.id, t.created_at, t.updated_at, a.status AS approval_status
        FROM ${sql.raw(`"lc_${f.businessType}"`)} t
        LEFT JOIN lc_business_approvals a
          ON a.business_id = t.id::text AND a.business_type = ${f.businessType} AND a.deleted_at IS NULL
        WHERE t.owner_id = ${sysUserId} AND t.deleted_at IS NULL
          AND (a.status IS NULL OR a.status = 'REJECTED')
        ORDER BY t.updated_at DESC LIMIT 200`);
      const rows = this.unwrapRows(res);
      for (const r of rows) {
        out.push({
          businessType: f.businessType,
          businessName: f.name || f.businessType,
          businessId: r.id,
          status: r.approval_status ?? 'DRAFT',
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        });
      }
    }
    out.sort((a, b) => {
      const at = a.updatedAt instanceof Date ? (a.updatedAt as Date).getTime() : 0;
      const bt = b.updatedAt instanceof Date ? (b.updatedAt as Date).getTime() : 0;
      return bt - at;
    });
    return { list: out, total: out.length };
  }

  // ===================== Dynamic chain resolution =====================

  /** Resolve the approval chain from the business_type's runtime rules + the record. */
  async resolveChain(businessType: string, record?: Record<string, unknown>): Promise<string[]> {
    const flow = await this.getFlow(businessType);
    if (!flow) {
      throw new BadRequestException(`No approval flow configured for business_type '${businessType}'`);
    }
    const cfg = flow.config as FlowConfig;
    if (record && Array.isArray(cfg.rules)) {
      for (const rule of cfg.rules) {
        if (this.matchWhen(rule.when, record)) return rule.chain;
      }
    }
    return cfg.defaultChain ?? [];
  }

  /**
   * Evaluate a rule's `when` conditions against the record.
   * when: { field: value } (eq) or { field: { op: value } } (lt/lte/gt/gte/eq/ne/in).
   */
  private matchWhen(when: Record<string, unknown> | undefined, record: Record<string, unknown>): boolean {
    if (!when) return true;
    for (const [field, cond] of Object.entries(when)) {
      const actual = record[field];
      if (cond !== null && typeof cond === 'object' && !Array.isArray(cond)) {
        for (const [op, val] of Object.entries(cond as Record<string, unknown>)) {
          if (!this.applyOp(actual, op, val)) return false;
        }
      } else {
        if (actual !== cond) return false;
      }
    }
    return true;
  }

  private applyOp(actual: unknown, op: string, val: unknown): boolean {
    const a = Number(actual);
    const v = Number(val);
    switch (op) {
      case 'eq': return actual == val;
      case 'ne': return actual != val;
      case 'lt': return Number.isFinite(a) && Number.isFinite(v) && a < v;
      case 'lte': return Number.isFinite(a) && Number.isFinite(v) && a <= v;
      case 'gt': return Number.isFinite(a) && Number.isFinite(v) && a > v;
      case 'gte': return Number.isFinite(a) && Number.isFinite(v) && a >= v;
      case 'in': return Array.isArray(val) && val.includes(actual);
      default: return false;
    }
  }

  // ===================== Flow config CRUD =====================

  async getFlow(businessType: string) {
    const rows = await this.db
      .select()
      .from(sysApprovalFlows)
      .where(and(eq(sysApprovalFlows.businessType, businessType), isNull(sysApprovalFlows.deletedAt)))
      .limit(1);
    return rows[0];
  }

  async upsertFlow(businessType: string, dto: UpsertApprovalFlowDto) {
    const existing = await this.getFlow(businessType);
    if (existing) {
      const rows = await this.db
        .update(sysApprovalFlows)
        .set({ name: dto.name, config: dto.config, enabled: dto.enabled, updatedAt: new Date() })
        .where(eq(sysApprovalFlows.id, existing.id))
        .returning();
      return rows[0]!;
    }
    const rows = await this.db
      .insert(sysApprovalFlows)
      .values({ businessType, name: dto.name, config: dto.config, enabled: dto.enabled })
      .returning();
    return rows[0]!;
  }

  // ===================== BPM callback ingest (MVP) =====================

  async applyBpmOutcome(dto: BpmApprovalCallbackDto): Promise<ApplyOutcomeResult> {
    const existing = await this.findActive(dto.businessType, dto.businessId);

    if (existing) {
      if (existing.status === dto.status) {
        this.logger.log(`Idempotent replay ${dto.businessType}:${dto.businessId} status=${dto.status}`);
        return { id: existing.id, replay: true };
      }
      await this.db
        .update(businessApprovals)
        .set({
          status: dto.status,
          processInstanceId: dto.processInstanceId,
          initiatorId: dto.initiatorId ?? existing.initiatorId,
          approverId: dto.approverId ?? existing.approverId,
          comment: dto.comment ?? existing.comment,
          payload: dto,
          updatedAt: new Date(),
        })
        .where(eq(businessApprovals.id, existing.id));
      return { id: existing.id, replay: false };
    }

    try {
      const rows = await this.db
        .insert(businessApprovals)
        .values({
          businessType: dto.businessType,
          businessId: dto.businessId,
          executor: ApprovalExecutor.BPM,
          status: dto.status,
          processInstanceId: dto.processInstanceId,
          initiatorId: dto.initiatorId,
          approverId: dto.approverId,
          comment: dto.comment,
          payload: dto,
        })
        .returning({ id: businessApprovals.id });
      return { id: rows[0]!.id, replay: false };
    } catch (err) {
      const winner = await this.findActive(dto.businessType, dto.businessId);
      if (winner) {
        this.logger.warn(`Concurrent insert for ${dto.businessType}:${dto.businessId}; reusing existing`);
        return { id: winner.id, replay: winner.status === dto.status };
      }
      if ((err as { code?: string })?.code !== PG_UNIQUE_VIOLATION) throw err;
      throw err;
    }
  }

  // ===================== helpers =====================

  private async trackStarted(businessType: string, businessId: string, processInstanceId: string, initiatorBpmId: string) {
    const existing = await this.findActive(businessType, businessId);
    if (existing) {
      await this.db
        .update(businessApprovals)
        .set({ executor: ApprovalExecutor.BPM, status: 'PENDING', processInstanceId, initiatorId: initiatorBpmId, approverId: null, comment: null, payload: { startedAt: Date.now() }, updatedAt: new Date() })
        .where(eq(businessApprovals.id, existing.id));
      return;
    }
    await this.db.insert(businessApprovals).values({
      businessType,
      businessId,
      executor: ApprovalExecutor.BPM,
      status: 'PENDING',
      processInstanceId,
      initiatorId: initiatorBpmId,
      payload: { startedAt: Date.now() },
    });
  }

  /** Batch-enrich BPM task/result rows with businessType/businessId from
   *  lc_business_approvals (looked up by processInstanceId). */
  private async enrichTasks(
    items: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    const piIds = items
      .map((i) => i.processInstanceId as string | undefined)
      .filter((v): v is string => !!v);

    const byPi = new Map<string, { businessType: string; businessId: string; status: string }>();
    if (piIds.length) {
      const rows = await this.db
        .select({
          businessType: businessApprovals.businessType,
          businessId: businessApprovals.businessId,
          status: businessApprovals.status,
          processInstanceId: businessApprovals.processInstanceId,
        })
        .from(businessApprovals)
        .where(and(inArray(businessApprovals.processInstanceId, piIds), isNull(businessApprovals.deletedAt)));
      for (const r of rows) {
        if (r.processInstanceId) byPi.set(r.processInstanceId, r);
      }
    }

    return items.map((i) => {
      const pi = i.processInstanceId as string | undefined;
      const a = pi ? byPi.get(pi) : undefined;
      return { ...i, businessType: a?.businessType ?? null, businessId: a?.businessId ?? null, status: a?.status ?? null };
    });
  }

  /** Fetch the full business record for each task so the approver can see the
   *  detail inline (e.g. amount, applicant, reason for a reimbursement). */
  private async enrichRecords(
    items: Array<Record<string, unknown>>,
  ): Promise<Array<Record<string, unknown>>> {
    const out: Array<Record<string, unknown>> = [];
    for (const item of items) {
      const bt = item.businessType as string | undefined;
      const bid = item.businessId as string | undefined;
      if (!bt || !bid || !TABLE_RE.test(bt)) {
        out.push(item);
        continue;
      }
      const res = await this.db.execute(sql`
        SELECT * FROM ${sql.raw(`"lc_${bt}"`)}
        WHERE id = ${bid} AND deleted_at IS NULL
        LIMIT 1`);
      const rows = this.unwrapRows(res);
      out.push({ ...item, record: rows[0] ?? null });
    }
    return out;
  }

  private async bpmIdFor(sysUserId: string): Promise<string> {
    const u = await this.db
      .select({ bpmUserId: sysUsers.bpmUserId })
      .from(sysUsers)
      .where(and(eq(sysUsers.id, sysUserId), isNull(sysUsers.deletedAt)))
      .limit(1);
    if (!u[0]?.bpmUserId) throw new BadRequestException('User is not synced to BPM (no bpm_user_id)');
    return u[0]!.bpmUserId;
  }

  private async findActive(businessType: string, businessId: string): Promise<BusinessApproval | undefined> {
    const rows = await this.db
      .select()
      .from(businessApprovals)
      .where(and(eq(businessApprovals.businessType, businessType), eq(businessApprovals.businessId, businessId), isNull(businessApprovals.deletedAt)))
      .limit(1);
    return rows[0];
  }

  /** Normalize a raw `db.execute` result into a row array (postgres-js returns an
   *  array directly, but guard the `{rows: []}` shape too). */
  private unwrapRows(result: unknown): any[] {
    if (Array.isArray(result)) return result as any[];
    if (result && typeof result === 'object' && Array.isArray((result as any).rows)) {
      return (result as any).rows;
    }
    return [];
  }

  private async callBpm(method: string, path: string, body: unknown, xUserId: string): Promise<any> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(`${this.bpmUrl}/bpm/api/${path}`, {
        method,
        headers: { 'Content-Type': 'application/json', 'x-user-id': xUserId },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const text = await res.text();
      let json: any = null;
      try { json = JSON.parse(text); } catch { /* non-JSON */ }
      if (!res.ok) throw new BadRequestException(`BPM ${method} ${path} -> ${res.status} ${text.slice(0, 160)}`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}
