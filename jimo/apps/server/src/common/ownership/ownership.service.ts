import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';

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
}
