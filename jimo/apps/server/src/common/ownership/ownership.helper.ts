import { Inject, Injectable } from '@nestjs/common';
import { eq, or, sql, SQL } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';

export type VisibilityStrategy = 'private' | 'department' | 'shared' | 'public';

/**
 * Row-level visibility for generated lc_* tables.
 *
 * Generated services call
 *   `visibleCondition(owner, sharedWith, userId, isAdmin, strategy, deptScope)`
 * inside findAll. Admins/super_admin bypass (see all). `strategy` is baked in at
 * code-generation time (default 'private'):
 *   - private:    owner only
 *   - department: owner + members of the owner's department and its sub-departments
 *                 (passed as the viewer's dept ancestor chain via `deptScope`)
 *   - shared:     owner + users in the row's shared_with list
 *   - public:     all authenticated users (no filter)
 * shared_with is consulted ONLY in the 'shared' strategy.
 *
 * The legacy 4-arg call (no strategy) keeps the original owner+shared behavior for
 * tables generated before this field existed.
 */
@Injectable()
export class OwnershipHelper {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  /**
   * @returns a Drizzle condition, or undefined when the caller bypasses
   *          visibility (admins, or public strategy) — i.e. no filter applied.
   */
  visibleCondition(
    ownerCol: unknown,
    sharedWithCol: unknown,
    userId: string | undefined,
    isAdmin: boolean,
    strategy?: VisibilityStrategy,
    deptScope?: string[],
  ): SQL | undefined {
    if (isAdmin) return undefined;
    if (strategy === 'public') return undefined;
    if (!userId) return eq(ownerCol as never, '__nobody__' as never) as SQL;

    // Legacy 4-arg call (no strategy): owner OR shared_with — original behavior.
    if (!strategy) {
      return or(
        eq(ownerCol as never, userId as never),
        sql`${sharedWithCol} @> ${sql.raw(`'${JSON.stringify([userId])}'::jsonb`)}`,
      ) as SQL;
    }

    switch (strategy) {
      case 'private':
        return eq(ownerCol as never, userId as never) as SQL;
      case 'shared':
        return or(
          eq(ownerCol as never, userId as never),
          sql`${sharedWithCol} @> ${sql.raw(`'${JSON.stringify([userId])}'::jsonb`)}`,
        ) as SQL;
      case 'department': {
        // Owner always sees their own rows; plus anyone whose dept is in the viewer's
        // dept ancestor chain (owner's dept contains the viewer's dept as a descendant,
        // which is the "含子部门" semantics). Falls back to owner-only when no dept.
        if (!deptScope || deptScope.length === 0) {
          return eq(ownerCol as never, userId as never) as SQL;
        }
        return or(
          eq(ownerCol as never, userId as never),
          sql`${ownerCol} IN (SELECT id FROM sys_users WHERE dept_id = ANY(${sql.raw(
            `ARRAY[${deptScope.map((d) => `'${d}'`).join(',')}]::uuid[]`,
          )}))`,
        ) as SQL;
      }
      default:
        return eq(ownerCol as never, userId as never) as SQL;
    }
  }

  /**
   * Resolve the viewer's department ancestor chain (the dept itself + all ancestors),
   * for the 'department' visibility strategy. A row owned by someone in any of these
   * departments is visible. Returns [] when the viewer has no department (-> owner-only).
   */
  async viewerDeptScope(userId: string): Promise<string[]> {
    const res = await this.db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id FROM sys_departments
        WHERE id = (SELECT dept_id FROM sys_users WHERE id = ${userId})
        UNION ALL
        SELECT d.id, d.parent_id FROM sys_departments d
        JOIN chain c ON d.id = c.parent_id
      )
      SELECT id FROM chain
    `);
    const arr = Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? []);
    return (arr as { id: string }[]).map((r) => r.id);
  }
}
