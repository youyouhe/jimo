import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysUsers } from '../../db/schema/users';
import { sysUserRoles } from '../../db/schema/user-roles';
import { sysEmployees } from '../../db/schema/sys-employees';
import { sysDepartments } from '../../db/schema/sys-departments';
import {
  sysCandidateRules,
  CandidateRuleFilter,
} from '../../db/schema/sys-candidate-rules';
import {
  CreateCandidateRuleDto,
  UpdateCandidateRuleDto,
} from './dto/candidate-rule.dto';
import { collectSubtree, findRootAncestor } from './org-scope.util';

export interface Candidate {
  id: string;
  username: string;
  nickname: string;
}

/**
 * Resolves a Candidate List (see CONTEXT.md) for the new Server-side
 * combined-filter Resolution Rules — entirely against Server's own tables
 * (sys_users/sys_user_roles/sys_roles/sys_employees/sys_departments). Does
 * not touch BPM or Org Sync (ADR-0003).
 *
 * Org Scope relative anchors (`self`/`parent`/`company`) are always resolved
 * against the flow's ORIGINAL INITIATOR's department, regardless of which
 * chain step is being resolved — never the department of whoever is
 * currently acting.
 */
@Injectable()
export class CandidateResolutionService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  // ===================== Rule CRUD =====================

  async listRules() {
    return this.db
      .select()
      .from(sysCandidateRules)
      .where(isNull(sysCandidateRules.deletedAt))
      .orderBy(sysCandidateRules.name);
  }

  async getRule(id: string) {
    const rows = await this.db
      .select()
      .from(sysCandidateRules)
      .where(and(eq(sysCandidateRules.id, id), isNull(sysCandidateRules.deletedAt)))
      .limit(1);
    return rows[0];
  }

  async getRuleOrThrow(id: string) {
    const rule = await this.getRule(id);
    if (!rule) throw new NotFoundException(`Candidate rule ${id} not found`);
    return rule;
  }

  async createRule(dto: CreateCandidateRuleDto) {
    const rows = await this.db
      .insert(sysCandidateRules)
      .values({ name: dto.name, filter: dto.filter, enabled: dto.enabled ?? true })
      .returning();
    return rows[0]!;
  }

  async updateRule(id: string, dto: UpdateCandidateRuleDto) {
    await this.getRuleOrThrow(id);
    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.filter !== undefined) data.filter = dto.filter;
    if (dto.enabled !== undefined) data.enabled = dto.enabled;
    const rows = await this.db
      .update(sysCandidateRules)
      .set(data)
      .where(eq(sysCandidateRules.id, id))
      .returning();
    return rows[0]!;
  }

  async deleteRule(id: string) {
    await this.getRuleOrThrow(id);
    await this.db
      .update(sysCandidateRules)
      .set({ deletedAt: sql`NOW()` })
      .where(eq(sysCandidateRules.id, id));
  }

  // ===================== Resolution =====================

  /**
   * Resolve the Candidate List for a rule, given the flow's initiator.
   * Returns an empty array if the filter's dimensions intersect to nothing —
   * callers must treat that as a blocking condition, never a fallback.
   */
  async resolveCandidates(ruleId: string, initiatorUserId: string): Promise<Candidate[]> {
    const rule = await this.getRule(ruleId);
    if (!rule || !rule.enabled) return [];
    return this.resolveByFilter(rule.filter as CandidateRuleFilter, initiatorUserId);
  }

  async resolveByFilter(filter: CandidateRuleFilter, initiatorUserId: string): Promise<Candidate[]> {
    const deptIds = await this.resolveOrgScope(filter.orgScope, initiatorUserId);
    // orgScope was specified but resolved to no departments (e.g. initiator has
    // no department, or a "parent" anchor with no parent) -> empty intersection.
    if (filter.orgScope && deptIds !== null && deptIds.length === 0) return [];

    const conditions = [isNull(sysUsers.deletedAt)];
    if (deptIds !== null) conditions.push(inArray(sysUsers.deptId, deptIds));

    const base = {
      id: sysUsers.id,
      username: sysUsers.username,
      nickname: sysUsers.nickname,
      employeeId: sysUsers.employeeId,
    };

    const rows = filter.roleIds?.length
      ? await this.db
          .select(base)
          .from(sysUsers)
          .innerJoin(sysUserRoles, eq(sysUserRoles.userId, sysUsers.id))
          .where(and(...conditions, inArray(sysUserRoles.roleId, filter.roleIds)))
      : await this.db.select(base).from(sysUsers).where(and(...conditions));
    const deduped = new Map<string, Candidate>();
    for (const r of rows) deduped.set(r.id, { id: r.id, username: r.username, nickname: r.nickname });

    if (!filter.positions?.length) return [...deduped.values()];

    // Position lives on sys_employees, linked via sys_users.employee_id —
    // filter the already-narrowed candidate set by intersecting with it.
    const employeeIds = rows.map((r) => r.employeeId).filter((v): v is string => !!v);
    if (employeeIds.length === 0) return [];
    const empRows = await this.db
      .select({ id: sysEmployees.id, position: sysEmployees.position })
      .from(sysEmployees)
      .where(and(inArray(sysEmployees.id, employeeIds), isNull(sysEmployees.deletedAt)));
    const matchingEmployeeIds = new Set(
      empRows.filter((e) => e.position && filter.positions!.includes(e.position)).map((e) => e.id),
    );
    return rows
      .filter((r) => r.employeeId && matchingEmployeeIds.has(r.employeeId))
      .map((r) => deduped.get(r.id)!)
      .filter(Boolean);
  }

  /**
   * Resolve an Org Scope to a concrete list of department ids, or `null` if
   * no org constraint was specified. An empty (non-null) array means the
   * scope was specified but resolved to nothing (e.g. no parent department).
   */
  private async resolveOrgScope(
    orgScope: CandidateRuleFilter['orgScope'],
    initiatorUserId: string,
  ): Promise<string[] | null> {
    if (!orgScope) return null;

    if (orgScope.type === 'fixed') {
      if (!orgScope.includeSubtree) return [orgScope.deptId];
      const allDepts = await this.loadAllDepartments();
      return collectSubtree(allDepts, orgScope.deptId);
    }

    const initiator = await this.db
      .select({ deptId: sysUsers.deptId })
      .from(sysUsers)
      .where(and(eq(sysUsers.id, initiatorUserId), isNull(sysUsers.deletedAt)))
      .limit(1);
    const initiatorDeptId = initiator[0]?.deptId ?? null;
    if (!initiatorDeptId) return [];

    if (orgScope.type === 'self') return [initiatorDeptId];

    const allDepts = await this.loadAllDepartments();

    if (orgScope.type === 'parent') {
      const dept = allDepts.find((d) => d.id === initiatorDeptId);
      return dept?.parentId ? [dept.parentId] : [];
    }

    // company: walk parentId up to the root ancestor, then include its full subtree.
    const root = findRootAncestor(allDepts, initiatorDeptId);
    if (!root) return [];
    return collectSubtree(allDepts, root.id);
  }

  private async loadAllDepartments(): Promise<Array<{ id: string; parentId: string | null }>> {
    return this.db
      .select({ id: sysDepartments.id, parentId: sysDepartments.parentId })
      .from(sysDepartments)
      .where(isNull(sysDepartments.deletedAt));
  }
}
