import { Injectable } from '@nestjs/common';
import { eq, or, sql, SQL } from 'drizzle-orm';

/**
 * Row-level ownership isolation (Strategy B: owner + shared).
 *
 * Generated services call `visibleCondition(table.ownerId, table.sharedWith, userId, isAdmin)`
 * inside their findAll where-clause. Admins/super_admins bypass (see all); everyone else sees
 * rows they own OR that are shared with them (shared_with jsonb contains their user id).
 */
@Injectable()
export class OwnershipHelper {
  /**
   * @returns a Drizzle condition, or undefined when the caller bypasses
   *          ownership (admins) — i.e. no filter applied.
   */
  visibleCondition(
    ownerCol: unknown,
    sharedWithCol: unknown,
    userId: string | undefined,
    isAdmin: boolean,
  ): SQL | undefined {
    if (isAdmin) return undefined;
    if (!userId) return eq(ownerCol as never, '__nobody__' as never) as SQL;
    return or(
      eq(ownerCol as never, userId as never),
      sql`${sharedWithCol} @> ${sql.raw(`'${JSON.stringify([userId])}'::jsonb`)}`,
    ) as SQL;
  }
}
