import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysDictionaries, SysDictionary } from '../../db/schema/dictionaries';
import { sysDictionaryDetails } from '../../db/schema/dictionary-details';
import { CreateDictDto } from './dto/create-dict.dto';
import { UpdateDictDto } from './dto/update-dict.dto';
import { QueryDictDto } from './dto/query-dict.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

export interface DictTreeNode extends SysDictionary {
  children: DictTreeNode[];
}

export interface ExportedDict {
  name: string;
  type: string;
  status: number;
  desc: string | null;
  details: Array<{
    label: string;
    value: string;
    status: number;
    sort: number;
    parent_id: string | null;
  }>;
}

const MAX_DEPTH = 20;

@Injectable()
export class DictionaryService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryDictDto): Promise<PaginatedData<SysDictionary>> {
    const { page, pageSize, name, type, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysDictionaries.deletedAt)];

    if (name) {
      conditions.push(like(sysDictionaries.name, `%${name}%`));
    }
    if (type) {
      conditions.push(like(sysDictionaries.type, `%${type}%`));
    }
    if (status !== undefined) {
      conditions.push(eq(sysDictionaries.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysDictionaries)
        .where(whereClause)
        .orderBy(sysDictionaries.sort, sysDictionaries.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysDictionaries)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findTree(): Promise<DictTreeNode[]> {
    const allDicts = await this.db
      .select()
      .from(sysDictionaries)
      .where(isNull(sysDictionaries.deletedAt))
      .orderBy(sysDictionaries.sort, sysDictionaries.createdAt);

    return this.buildTree(allDicts, null);
  }

  async findOne(id: string): Promise<SysDictionary> {
    const rows = await this.db
      .select()
      .from(sysDictionaries)
      .where(and(eq(sysDictionaries.id, id), isNull(sysDictionaries.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Dictionary with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async findByType(type: string): Promise<SysDictionary> {
    const rows = await this.db
      .select()
      .from(sysDictionaries)
      .where(and(eq(sysDictionaries.type, type), isNull(sysDictionaries.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Dictionary with type '${type}' not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateDictDto): Promise<SysDictionary> {
    // Check type uniqueness
    const existing = await this.db
      .select()
      .from(sysDictionaries)
      .where(and(eq(sysDictionaries.type, dto.type), isNull(sysDictionaries.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Dictionary type '${dto.type}' is already taken`,
      });
    }

    // Validate parent_id if provided
    if (dto.parent_id) {
      await this.findOne(dto.parent_id);
    }

    const rows = await this.db
      .insert(sysDictionaries)
      .values({
        name: dto.name,
        type: dto.type,
        status: (dto.status ?? 1) as 1 | 2,
        desc: dto.desc ?? null,
        parentId: dto.parent_id ?? null,
        sort: dto.sort ?? 0,
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateDictDto): Promise<SysDictionary> {
    const existing = await this.findOne(id);

    // Check type uniqueness if changed
    if (dto.type && dto.type !== existing.type) {
      const typeConflict = await this.db
        .select()
        .from(sysDictionaries)
        .where(and(eq(sysDictionaries.type, dto.type), isNull(sysDictionaries.deletedAt)))
        .limit(1);

      if (typeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Dictionary type '${dto.type}' is already taken`,
        });
      }
    }

    // Circular reference check on parent_id change
    if (dto.parent_id !== undefined && dto.parent_id !== null) {
      if (dto.parent_id === id) {
        throw new BadRequestException({
          code: ApiErrorCode.PARAM_ERROR,
          message: 'A dictionary cannot be its own parent',
        });
      }
      await this.checkCircularReference(id, dto.parent_id);
      // Validate parent exists
      await this.findOne(dto.parent_id);
    }

    type DictUpdateFields = {
      name?: string;
      type?: string;
      status?: number;
      desc?: string | null;
      parentId?: string | null;
      sort?: number;
      updatedAt?: Date;
    };

    const updateData: DictUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.desc !== undefined) updateData.desc = dto.desc;
    if (dto.parent_id !== undefined) updateData.parentId = dto.parent_id ?? null;
    if (dto.sort !== undefined) updateData.sort = dto.sort;

    const rows = await this.db
      .update(sysDictionaries)
      .set(updateData)
      .where(and(eq(sysDictionaries.id, id), isNull(sysDictionaries.deletedAt)))
      .returning();

    return rows[0]!;
  }

  /**
   * Walk up the parent chain to verify that targetParentId is not in the
   * subtree rooted at currentId (would create a cycle).
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
        .select({ parentId: sysDictionaries.parentId })
        .from(sysDictionaries)
        .where(and(eq(sysDictionaries.id, checkId), isNull(sysDictionaries.deletedAt)))
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

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    // Cascade: soft-delete all details belonging to this dictionary
    await this.db
      .update(sysDictionaryDetails)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysDictionaryDetails.dictId, id), isNull(sysDictionaryDetails.deletedAt)));

    // Soft-delete the dictionary itself
    await this.db
      .update(sysDictionaries)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysDictionaries.id, id), isNull(sysDictionaries.deletedAt)));
  }

  async removeBatch(ids: string[]): Promise<{ count: number }> {
    // Cascade: soft-delete all details for the batch of dictionaries
    await this.db
      .update(sysDictionaryDetails)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysDictionaryDetails.dictId, ids), isNull(sysDictionaryDetails.deletedAt)));

    // Soft-delete the dictionaries
    const rows = await this.db
      .update(sysDictionaries)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysDictionaries.id, ids), isNull(sysDictionaries.deletedAt)))
      .returning({ id: sysDictionaries.id });

    return { count: rows.length };
  }

  /**
   * Import a dictionary with its details in a transaction.
   * Expects JSON body matching ExportDict shape.
   * Creates the dict, inserts all details with ID remapping for parent_id references.
   */
  async importDict(json: Record<string, any>): Promise<SysDictionary> {
    const name = json.name as string | undefined;
    const type = json.type as string | undefined;
    const details = (json.details ?? json.sysDictionaryDetails ?? []) as Array<Record<string, any>>;

    if (!name || !type) {
      throw new BadRequestException({
        code: ApiErrorCode.PARAM_ERROR,
        message: 'Import data must include "name" and "type" fields',
      });
    }

    // Check type uniqueness
    const existing = await this.db
      .select()
      .from(sysDictionaries)
      .where(and(eq(sysDictionaries.type, type), isNull(sysDictionaries.deletedAt)))
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Dictionary type '${type}' already exists. Remove it first or use a different type.`,
      });
    }

    return await this.db.transaction(async (tx) => {
      // Insert the dictionary
      const [dict] = await tx
        .insert(sysDictionaries)
        .values({
          name,
          type,
          status: (json.status ?? 1) as 1 | 2,
          desc: json.desc ?? null,
          parentId: json.parent_id ?? null,
          sort: json.sort ?? 0,
        })
        .returning();

      if (!dict) {
        throw new BadRequestException({
          code: ApiErrorCode.INTERNAL_ERROR,
          message: 'Failed to create dictionary during import',
        });
      }

      if (details.length === 0) {
        return dict;
      }

      // First pass: insert all details, building old-id -> new-id map
      const idMap = new Map<string, string>();

      for (const detail of details) {
        const [row] = await tx
          .insert(sysDictionaryDetails)
          .values({
            dictId: dict.id,
            label: detail.label ?? '',
            value: detail.value ?? '',
            status: (detail.status ?? 1) as 1 | 2,
            sort: detail.sort ?? 0,
            parentId: null, // temporary, remapped in second pass
          })
          .returning();

        if (row) {
          idMap.set(detail.id, row.id);
        }
      }

      // Second pass: remap parent_id references using the ID map
      for (const detail of details) {
        if (detail.parent_id && idMap.has(detail.parent_id)) {
          const newId = idMap.get(detail.id);
          const newParentId = idMap.get(detail.parent_id);
          if (newId && newParentId) {
            await tx
              .update(sysDictionaryDetails)
              .set({ parentId: newParentId })
              .where(eq(sysDictionaryDetails.id, newId));
          }
        }
      }

      return dict;
    });
  }

  /**
   * Export a dictionary and all its details as a clean JSON structure.
   */
  async exportDict(id: string): Promise<ExportedDict> {
    const dict = await this.findOne(id);

    const details = await this.db
      .select()
      .from(sysDictionaryDetails)
      .where(
        and(
          eq(sysDictionaryDetails.dictId, id),
          isNull(sysDictionaryDetails.deletedAt),
        ),
      )
      .orderBy(sysDictionaryDetails.sort, sysDictionaryDetails.createdAt);

    return {
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
  }

  /**
   * Build a tree from flat list using O(n) hash-map pattern.
   * Reuses the same approach as MenuService.buildTree with cycle-safe visited set.
   */
  private buildTree(
    dicts: SysDictionary[],
    parentId: string | null = null,
  ): DictTreeNode[] {
    // Build lookup map once -- O(n)
    const childrenMap = new Map<string | null, SysDictionary[]>();
    for (const dict of dicts) {
      const key = dict.parentId ?? null;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(dict);
    }

    // Recursive build using map -- O(n) total, with cycle detection
    const buildNodes = (
      pid: string | null,
      visited = new Set<string | null>(),
    ): DictTreeNode[] => {
      if (visited.has(pid)) return [];
      const nextVisited = new Set(visited).add(pid);
      const children = childrenMap.get(pid) ?? [];
      return children
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map((dict) => ({
          ...dict,
          children: buildNodes(dict.id, nextVisited),
        }));
    };

    return buildNodes(parentId);
  }
}
