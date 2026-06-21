import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
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
    return this.callBpm('GET', `approvals/my-tasks`, undefined, bpmId);
  }

  async approve(processInstanceId: string, sysUserId: string, approved: boolean, comment?: string) {
    const bpmId = await this.bpmIdFor(sysUserId);
    return this.callBpm('POST', `approvals/${processInstanceId}/approve`, { approved, comment }, bpmId);
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
