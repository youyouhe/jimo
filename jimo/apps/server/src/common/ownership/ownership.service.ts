import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysUsers } from '../../db/schema/users';

const TABLE_RE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Generic ownership operations across all generated lc_* tables (share / transfer).
 * The table is addressed dynamically by business_type (validated); only the record
 * owner may share or transfer. This is the anchor for "离职交接" (ownership handover).
 */
@Injectable()
export class OwnershipService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb) {}

  private tableRef(businessType: string) {
    if (!TABLE_RE.test(businessType)) {
      throw new BadRequestException(`Invalid businessType: ${businessType}`);
    }
    return sql.raw(`"lc_${businessType}"`);
  }

  private rows(r: unknown): unknown[] {
    const res = r as { rows?: unknown[] } | unknown[];
    return Array.isArray(res) ? res : (res?.rows ?? []);
  }

  /** Share a record: replaces shared_with with the given user ids (owner-only). */
  async share(businessType: string, businessId: string, userIds: string[], actorId: string) {
    const t = this.tableRef(businessType);
    const owned = this.rows(
      await this.db.execute(
        sql`SELECT id FROM ${t} WHERE id=${businessId} AND owner_id=${actorId} AND deleted_at IS NULL LIMIT 1`,
      ),
    );
    if (owned.length === 0) {
      throw new NotFoundException('Record not found or you are not the owner');
    }
    await this.db.execute(
      sql`UPDATE ${t} SET shared_with=${sql.raw(`'${JSON.stringify(userIds)}'::jsonb`)}, updated_at=now() WHERE id=${businessId}`,
    );
    return { businessType, businessId, sharedWith: userIds };
  }

  /** Transfer ownership to a new user (owner-only). Clears shared_with. */
  async transfer(businessType: string, businessId: string, newOwnerId: string, actorId: string) {
    const t = this.tableRef(businessType);
    const owned = this.rows(
      await this.db.execute(
        sql`SELECT id FROM ${t} WHERE id=${businessId} AND owner_id=${actorId} AND deleted_at IS NULL LIMIT 1`,
      ),
    );
    if (owned.length === 0) {
      throw new NotFoundException('Record not found or you are not the owner');
    }
    await this.db.execute(
      sql`UPDATE ${t} SET owner_id=${newOwnerId}, shared_with='[]'::jsonb, updated_at=now() WHERE id=${businessId}`,
    );
    return { businessType, businessId, newOwnerId };
  }

  /**
   * Reassign ownership of multiple records to a new user (batch).
   * Permitted when the actor owns the record OR the record is ownerless
   * (owner_id IS NULL — "无主数据" anyone may claim/reassign). Records owned
   * by another user are skipped and returned in skippedIds. Clears shared_with
   * on each reassigned row (same semantics as transfer).
   */
  async reassign(businessType: string, ids: string[], newOwnerId: string, actorId: string) {
    const t = this.tableRef(businessType);

    // Validate target user exists (prevent ghost owner)
    const target = this.rows(
      await this.db.execute(
        sql`SELECT 1 FROM ${sysUsers} WHERE id=${newOwnerId} AND deleted_at IS NULL LIMIT 1`,
      ),
    );
    if (target.length === 0) {
      throw new NotFoundException('Target user not found');
    }

    // Reassign only rows the actor owns or that are ownerless
    const updated = this.rows(
      await this.db.execute(
        sql`UPDATE ${t}
            SET owner_id=${newOwnerId}, shared_with='[]'::jsonb, updated_at=now()
            WHERE id IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
              AND (owner_id=${actorId} OR owner_id IS NULL)
              AND deleted_at IS NULL
            RETURNING id`,
      ),
    ) as { id: string }[];
    const reassignedIds = updated.map((r) => r.id);
    const skippedIds = ids.filter((id) => !reassignedIds.includes(id));
    return {
      businessType,
      newOwnerId,
      reassigned: reassignedIds.length,
      skipped: skippedIds.length,
      skippedIds,
    };
  }
}
