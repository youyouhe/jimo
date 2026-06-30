import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  sysDictionaryDetails,
  SysDictionaryDetail,
} from '../../db/schema/dictionary-details';
import { sysDictionaries } from '../../db/schema/dictionaries';
import { CreateDetailDto } from './dto/create-detail.dto';
import { UpdateDetailDto } from './dto/update-detail.dto';
import { QueryDetailDto } from './dto/query-detail.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';
import { DictionarySnapshotService } from '../dictionary/dictionary-snapshot.service';

export interface DetailTreeNode extends SysDictionaryDetail {
  children: DetailTreeNode[];
}

const MAX_DEPTH = 20;

@Injectable()
export class DictionaryDetailService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly snapshotService: DictionarySnapshotService,
  ) {}

  async findAll(query: QueryDetailDto): Promise<PaginatedData<SysDictionaryDetail>> {
    const { page, pageSize, dict_id, label, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysDictionaryDetails.deletedAt)];

    if (dict_id) {
      conditions.push(eq(sysDictionaryDetails.dictId, dict_id));
    }
    if (label) {
      conditions.push(like(sysDictionaryDetails.label, `%${label}%`));
    }
    if (status !== undefined) {
      conditions.push(eq(sysDictionaryDetails.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysDictionaryDetails)
        .where(whereClause)
        .orderBy(sysDictionaryDetails.sort, sysDictionaryDetails.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysDictionaryDetails)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysDictionaryDetail> {
    const rows = await this.db
      .select()
      .from(sysDictionaryDetails)
      .where(
        and(eq(sysDictionaryDetails.id, id), isNull(sysDictionaryDetails.deletedAt)),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Dictionary detail with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async findTreeByDictId(dictId: string): Promise<DetailTreeNode[]> {
    const allDetails = await this.db
      .select()
      .from(sysDictionaryDetails)
      .where(
        and(
          eq(sysDictionaryDetails.dictId, dictId),
          isNull(sysDictionaryDetails.deletedAt),
        ),
      )
      .orderBy(sysDictionaryDetails.sort, sysDictionaryDetails.createdAt);

    return this.buildTree(allDetails, null);
  }

  async findByDictType(type: string): Promise<SysDictionaryDetail[]> {
    // Look up the dictionary by type string; return empty array if not found
    const dictRows = await this.db
      .select({ id: sysDictionaries.id })
      .from(sysDictionaries)
      .where(and(eq(sysDictionaries.type, type), isNull(sysDictionaries.deletedAt)))
      .limit(1);

    if (dictRows.length === 0) {
      return [];
    }

    const dictId = dictRows[0]!.id;

    return this.db
      .select()
      .from(sysDictionaryDetails)
      .where(
        and(
          eq(sysDictionaryDetails.dictId, dictId),
          isNull(sysDictionaryDetails.deletedAt),
        ),
      )
      .orderBy(sysDictionaryDetails.sort, sysDictionaryDetails.createdAt);
  }

  async create(dto: CreateDetailDto, operator?: string): Promise<SysDictionaryDetail> {
    // Validate parent_id if provided
    if (dto.parent_id) {
      await this.findOne(dto.parent_id);
    }

    const rows = await this.db
      .insert(sysDictionaryDetails)
      .values({
        dictId: dto.dict_id,
        label: dto.label,
        value: dto.value,
        status: (dto.status ?? 1) as 1 | 2,
        sort: dto.sort ?? 0,
        parentId: dto.parent_id ?? null,
      })
      .returning();

    const detail = rows[0]!;
    await this.snapshotService.capture({ dictId: detail.dictId, changeType: 'detail_add', operator });
    return detail;
  }

  async update(id: string, dto: UpdateDetailDto, operator?: string): Promise<SysDictionaryDetail> {
    const existing = await this.findOne(id);

    // Circular reference check on parent_id change
    if (dto.parent_id !== undefined && dto.parent_id !== null) {
      if (dto.parent_id === id) {
        throw new BadRequestException({
          code: ApiErrorCode.PARAM_ERROR,
          message: 'A detail cannot be its own parent',
        });
      }
      await this.checkCircularReference(id, dto.parent_id);
      await this.findOne(dto.parent_id);
    }

    type DetailUpdateFields = {
      label?: string;
      value?: string;
      status?: number;
      sort?: number;
      parentId?: string | null;
      updatedAt?: Date;
    };

    const updateData: DetailUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.label !== undefined) updateData.label = dto.label;
    if (dto.value !== undefined) updateData.value = dto.value;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.sort !== undefined) updateData.sort = dto.sort;
    if (dto.parent_id !== undefined) updateData.parentId = dto.parent_id ?? null;

    const rows = await this.db
      .update(sysDictionaryDetails)
      .set(updateData)
      .where(
        and(eq(sysDictionaryDetails.id, id), isNull(sysDictionaryDetails.deletedAt)),
      )
      .returning();

    const detail = rows[0]!;
    await this.snapshotService.capture({ dictId: detail.dictId, changeType: 'detail_update', operator });
    return detail;
  }

  /**
   * Soft-delete a detail and cascade to all its children.
   */
  async remove(id: string, operator?: string): Promise<void> {
    const detail = await this.findOne(id);

    // Find all descendants recursively and soft-delete them
    await this.cascadeSoftDelete(id);

    // Soft-delete the node itself
    await this.db
      .update(sysDictionaryDetails)
      .set({ deletedAt: sql`NOW()` })
      .where(
        and(eq(sysDictionaryDetails.id, id), isNull(sysDictionaryDetails.deletedAt)),
      );

    await this.snapshotService.capture({ dictId: detail.dictId, changeType: 'detail_delete', operator });
  }

  /**
   * Recursively find all children of a node by parent_id and soft-delete them.
   */
  private async cascadeSoftDelete(parentId: string): Promise<void> {
    const children = await this.db
      .select({ id: sysDictionaryDetails.id })
      .from(sysDictionaryDetails)
      .where(
        and(
          eq(sysDictionaryDetails.parentId, parentId),
          isNull(sysDictionaryDetails.deletedAt),
        ),
      );

    for (const child of children) {
      // Recurse first (depth-first) to delete deepest children first
      await this.cascadeSoftDelete(child.id);
      await this.db
        .update(sysDictionaryDetails)
        .set({ deletedAt: sql`NOW()` })
        .where(
          and(
            eq(sysDictionaryDetails.id, child.id),
            isNull(sysDictionaryDetails.deletedAt),
          ),
        );
    }
  }

  /**
   * Walk up the parent chain to verify no circular reference.
   */
  private async checkCircularReference(
    currentId: string,
    targetParentId: string,
  ): Promise<void> {
    let checkId: string | null = targetParentId;
    let depth = 0;

    while (checkId !== null && depth < MAX_DEPTH) {
      if (checkId === currentId) {
        throw new BadRequestException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Cannot set parent_id to ${targetParentId}: this would create a circular reference`,
        });
      }

      const rows = await this.db
        .select({ parentId: sysDictionaryDetails.parentId })
        .from(sysDictionaryDetails)
        .where(
          and(
            eq(sysDictionaryDetails.id, checkId),
            isNull(sysDictionaryDetails.deletedAt),
          ),
        )
        .limit(1);

      if (rows.length === 0 || rows[0]!.parentId === null) {
        break;
      }

      checkId = rows[0]!.parentId;
      depth++;
    }

    if (depth >= MAX_DEPTH) {
      throw new BadRequestException({
        code: ApiErrorCode.PARAM_ERROR,
        message: 'Parent chain exceeds maximum depth limit',
      });
    }
  }

  /**
   * Build a tree from flat list using O(n) hash-map pattern.
   */
  private buildTree(
    details: SysDictionaryDetail[],
    parentId: string | null = null,
  ): DetailTreeNode[] {
    const childrenMap = new Map<string | null, SysDictionaryDetail[]>();
    for (const detail of details) {
      const key = detail.parentId ?? null;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(detail);
    }

    const buildNodes = (
      pid: string | null,
      visited = new Set<string | null>(),
    ): DetailTreeNode[] => {
      if (visited.has(pid)) return [];
      const nextVisited = new Set(visited).add(pid);
      const children = childrenMap.get(pid) ?? [];
      return children
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((detail) => ({
          ...detail,
          children: buildNodes(detail.id, nextVisited),
        }));
    };

    return buildNodes(parentId);
  }
}
