import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  sysDictionarySnapshots,
  SysDictionarySnapshot,
} from '../../db/schema/dictionary-snapshots';
import { sysDictionaries } from '../../db/schema/dictionaries';
import { sysDictionaryDetails } from '../../db/schema/dictionary-details';
import { ApiErrorCode } from '@jimo/shared';

export type SnapshotChangeType =
  | 'create'
  | 'update'
  | 'delete'
  | 'detail_add'
  | 'detail_update'
  | 'detail_delete'
  | 'import'
  | 'restore';

export interface SnapshotMeta {
  dictId: string;
  changeType: SnapshotChangeType;
  operator?: string;
  note?: string;
}

export interface SnapshotListItem {
  id: string;
  version: number;
  changeType: string;
  operator: string | null;
  note: string | null;
  createdAt: Date;
}

@Injectable()
export class DictionarySnapshotService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  /**
   * Build the current dict+details payload, write snapshot row, bump version.
   * Call AFTER the dict/detail mutation has been committed.
   */
  async capture(meta: SnapshotMeta): Promise<void> {
    const { dictId, changeType, operator, note } = meta;

    // Load dict (may be soft-deleted for 'delete' snapshots)
    const dictRows = await this.db
      .select()
      .from(sysDictionaries)
      .where(eq(sysDictionaries.id, dictId))
      .limit(1);

    if (dictRows.length === 0) return;
    const dict = dictRows[0]!;

    // Load live details (only non-deleted)
    const details = await this.db
      .select()
      .from(sysDictionaryDetails)
      .where(
        and(
          eq(sysDictionaryDetails.dictId, dictId),
          isNull(sysDictionaryDetails.deletedAt),
        ),
      )
      .orderBy(sysDictionaryDetails.sort, sysDictionaryDetails.createdAt);

    const snapshot = {
      name: dict.name,
      type: dict.type,
      status: dict.status,
      desc: dict.desc,
      details: details.map((d) => ({
        label: d.label,
        value: d.value,
        status: d.status,
        sort: d.sort,
        parent_id: d.parentId,
      })),
    };

    const newVersion = (dict.version ?? 0) + 1;

    // Bump dict version + insert snapshot atomically
    await this.db.transaction(async (tx) => {
      await tx
        .update(sysDictionaries)
        .set({ version: newVersion, updatedAt: new Date() })
        .where(eq(sysDictionaries.id, dictId));

      await tx.insert(sysDictionarySnapshots).values({
        dictId,
        version: newVersion,
        snapshot,
        changeType,
        operator: operator ?? null,
        note: note ?? null,
      });
    });
  }

  async listVersions(dictId: string): Promise<SnapshotListItem[]> {
    const rows = await this.db
      .select({
        id: sysDictionarySnapshots.id,
        version: sysDictionarySnapshots.version,
        changeType: sysDictionarySnapshots.changeType,
        operator: sysDictionarySnapshots.operator,
        note: sysDictionarySnapshots.note,
        createdAt: sysDictionarySnapshots.createdAt,
      })
      .from(sysDictionarySnapshots)
      .where(eq(sysDictionarySnapshots.dictId, dictId))
      .orderBy(desc(sysDictionarySnapshots.version));

    return rows;
  }

  async getVersion(dictId: string, version: number): Promise<SysDictionarySnapshot> {
    const rows = await this.db
      .select()
      .from(sysDictionarySnapshots)
      .where(
        and(
          eq(sysDictionarySnapshots.dictId, dictId),
          eq(sysDictionarySnapshots.version, version),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Snapshot version ${version} not found for dictionary ${dictId}`,
      });
    }

    return rows[0]!;
  }
}
