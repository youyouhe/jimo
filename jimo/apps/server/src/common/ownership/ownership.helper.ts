import { Injectable } from '@nestjs/common';
import { eq, SQL } from 'drizzle-orm';

/**
 * Row-level ownership isolation (Strategy B core).
 *
 * Generated services call `visibleCondition(table.ownerId, userId, isAdmin)`
 * inside their findAll where-clause. Admins/super_admins bypass (see all);
 * everyone else sees only rows they own. `shared_with`-based sharing will hook
 * in here once that column is surfaced in generated Drizzle schemas.
 */
@Injectable()
export class OwnershipHelper {
  /**
   * @returns a Drizzle condition, or undefined when the caller bypasses
   *          ownership (admins) — i.e. no filter applied.
   */
  visibleCondition(ownerCol: unknown, userId: string | undefined, isAdmin: boolean): SQL | undefined {
    if (isAdmin) return undefined;
    if (!userId) return eq(ownerCol as never, '__nobody__' as never) as SQL;
    return eq(ownerCol as never, userId as never) as SQL;
  }
}
