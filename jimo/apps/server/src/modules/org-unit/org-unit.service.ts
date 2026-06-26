import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { orgUnits, OrgUnits } from '../../db/schema/org-units';
import { CreateOrgUnitDto } from './dto/create-org-unit.dto';
import { UpdateOrgUnitDto } from './dto/update-org-unit.dto';
import { QueryOrgUnitDto } from './dto/query-org-unit.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class OrgUnitService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryOrgUnitDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<OrgUnits>> {
    const { page, pageSize, name, code, manager_name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(orgUnits.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(orgUnits.ownerId, orgUnits.sharedWith, userId, isAdmin, 'public');
    if (_ownership) conditions.push(_ownership);

    if (name) {
      conditions.push(like(orgUnits.name, `%${name}%`));
    }
    if (code) {
      conditions.push(like(orgUnits.code, `%${code}%`));
    }
    if (manager_name) {
      conditions.push(like(orgUnits.manager_name, `%${manager_name}%`));
    }

    const whereClause = and(...conditions);
    const parent_alias = alias(orgUnits, 'parent_alias');

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(orgUnits),
      parent_display: parent_alias.name,
        })
        .from(orgUnits)
        .leftJoin(parent_alias, eq(orgUnits.parent, parent_alias.id))
        .where(whereClause)
        .orderBy(desc(orgUnits.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(orgUnits)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string, userId?: string, isAdmin: boolean = false): Promise<OrgUnits> {
    const conditions = [eq(orgUnits.id, id), isNull(orgUnits.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(orgUnits.ownerId, orgUnits.sharedWith, userId, isAdmin, 'public');
    if (_ownership) conditions.push(_ownership);
    const parent_alias = alias(orgUnits, 'parent_alias');
    const rows = await this.db
      .select({
        ...getTableColumns(orgUnits),
      parent_display: parent_alias.name,
      })
      .from(orgUnits)
        .leftJoin(parent_alias, eq(orgUnits.parent, parent_alias.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `OrgUnit with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateOrgUnitDto, userId?: string): Promise<OrgUnits> {
    // Check unique: code
    const existingByCode = await this.db
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.code, dto.code), isNull(orgUnits.deletedAt)))
      .limit(1);

    if (existingByCode.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Code '${dto.code}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(orgUnits)
      .values({
        ownerId: userId,
        name: dto.name,
        code: dto.code,
        parent: dto.parent,
        description: dto.description,
        manager_name: dto.manager_name,
        sort_order: dto.sort_order,
        is_active: dto.is_active,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateOrgUnitDto, userId?: string, isAdmin: boolean = false): Promise<OrgUnits> {
    const existing = await this.findOne(id, userId, isAdmin);

    if (dto.code && dto.code !== existing.code) {
      const codeConflict = await this.db
        .select()
        .from(orgUnits)
        .where(and(eq(orgUnits.code, dto.code), isNull(orgUnits.deletedAt)))
        .limit(1);

      if (codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Code '${dto.code}' is already taken`,
        });
      }
    }

    type OrgUnitUpdateFields = {
      name?: string;
      code?: string;
      parent?: string;
      description?: string;
      manager_name?: string;
      sort_order?: number;
      is_active?: boolean;
      updatedAt?: Date;
    };

    const updateData: OrgUnitUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.parent !== undefined) updateData.parent = dto.parent ?? undefined;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.manager_name !== undefined) updateData.manager_name = dto.manager_name;
    if (dto.sort_order !== undefined) updateData.sort_order = dto.sort_order;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;

    const rows = await this.db
      .update(orgUnits)
      .set(updateData)
      .where(
        isAdmin
          ? and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt))
          : and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt), eq(orgUnits.ownerId, userId!)),
      )
      .returning();


    return rows[0]!;
  }

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);


    await this.db
      .update(orgUnits)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt))
          : and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt), eq(orgUnits.ownerId, userId!)),
      );
  }

  async batchRemove(ids: string[], userId?: string, isAdmin: boolean = false): Promise<{ count: number }> {

    const rows = await this.db
      .update(orgUnits)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(inArray(orgUnits.id, ids), isNull(orgUnits.deletedAt))
          : and(inArray(orgUnits.id, ids), isNull(orgUnits.deletedAt), eq(orgUnits.ownerId, userId!)),
      )
      .returning({ id: orgUnits.id });

    return { count: rows.length };
  }

  async findTree(userId?: string, isAdmin: boolean = false): Promise<(OrgUnits & { children: any[] })[]> {
    const conditions: SQL[] = [isNull(orgUnits.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(orgUnits.ownerId, orgUnits.sharedWith, userId, isAdmin, 'public');
    if (_ownership) conditions.push(_ownership);
    const allRows = await this.db
      .select()
      .from(orgUnits)
      .where(and(...conditions))
      .orderBy(orgUnits.id);

    const map = new Map<string, OrgUnits & { parent_display: string | null; children: any[] }>();
    for (const row of allRows) map.set(row.id, { ...row, parent_display: null, children: [] });
    const roots: (OrgUnits & { parent_display: string | null; children: any[] })[] = [];
    for (const row of allRows) {
      const node = map.get(row.id)!;
      const pid = (row as any).parent;
      if (pid && map.has(pid)) {
        node.parent_display = map.get(pid)!.name;
        map.get(pid)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

}
