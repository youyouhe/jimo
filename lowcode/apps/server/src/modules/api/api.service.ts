import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysApis, SysApi } from '../../db/schema/apis';
import { CreateApiDto } from './dto/create-api.dto';
import { UpdateApiDto } from './dto/update-api.dto';
import { QueryApiDto } from './dto/query-api.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';
import { CasbinService } from '../../core/casbin/casbin.service';

@Injectable()
export class ApiService {
  private readonly logger = new Logger(ApiService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly casbinService: CasbinService,
  ) {}

  async findAll(query: QueryApiDto): Promise<PaginatedData<SysApi>> {
    const { page, pageSize, method, path, apiGroup } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysApis.deletedAt)];

    if (method) {
      conditions.push(eq(sysApis.method, method.toUpperCase()));
    }
    if (path) {
      conditions.push(like(sysApis.path, `%${path}%`));
    }
    if (apiGroup) {
      conditions.push(like(sysApis.apiGroup, `%${apiGroup}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysApis)
        .where(whereClause)
        .orderBy(sysApis.apiGroup, sysApis.method, sysApis.path)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysApis)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysApi> {
    const rows = await this.db
      .select()
      .from(sysApis)
      .where(and(eq(sysApis.id, id), isNull(sysApis.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `API with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateApiDto): Promise<SysApi> {
    // Check method+path uniqueness within active records
    const existing = await this.db
      .select()
      .from(sysApis)
      .where(
        and(
          eq(sysApis.method, dto.method.toUpperCase()),
          eq(sysApis.path, dto.path),
          isNull(sysApis.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `API ${dto.method.toUpperCase()} ${dto.path} already exists`,
      });
    }

    const rows = await this.db
      .insert(sysApis)
      .values({
        method: dto.method.toUpperCase(),
        path: dto.path,
        description: dto.description ?? '',
        apiGroup: dto.apiGroup ?? 'default',
        permission: dto.permission ?? null,
      })
      .returning();

    const created = rows[0]!;

    // Sync to Casbin: grant wildcard subject access to this API
    try {
      await this.casbinService.addPolicy('*', created.path, created.method);
      this.logger.debug(`Casbin policy added: * ${created.path} ${created.method}`);
    } catch (err) {
      this.logger.error(`Failed to add Casbin policy for ${created.method} ${created.path}: ${err}`);
    }

    return created;
  }

  async update(id: string, dto: UpdateApiDto): Promise<SysApi> {
    const existing = await this.findOne(id);

    const newMethod = dto.method ? dto.method.toUpperCase() : existing.method;
    const newPath = dto.path ?? existing.path;
    const methodChanged = dto.method !== undefined && dto.method.toUpperCase() !== existing.method;
    const pathChanged = dto.path !== undefined && dto.path !== existing.path;

    // If method or path is changing, check for conflicts
    if (methodChanged || pathChanged) {
      const conflict = await this.db
        .select()
        .from(sysApis)
        .where(
          and(
            eq(sysApis.method, newMethod),
            eq(sysApis.path, newPath),
            isNull(sysApis.deletedAt),
          ),
        )
        .limit(1);

      if (conflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `API ${newMethod} ${newPath} already exists`,
        });
      }
    }

    type ApiUpdateFields = {
      method?: string;
      path?: string;
      description?: string;
      apiGroup?: string;
      permission?: string;
      updatedAt?: Date;
    };

    const updateData: ApiUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.method !== undefined) updateData.method = newMethod;
    if (dto.path !== undefined) updateData.path = dto.path;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.apiGroup !== undefined) updateData.apiGroup = dto.apiGroup;
    if (dto.permission !== undefined) updateData.permission = dto.permission;

    const rows = await this.db
      .update(sysApis)
      .set(updateData)
      .where(and(eq(sysApis.id, id), isNull(sysApis.deletedAt)))
      .returning();

    const updated = rows[0]!;

    // Sync Casbin policies if method or path changed
    if (methodChanged || pathChanged) {
      try {
        await this.casbinService.removeFilteredPolicy(0, existing.path, existing.method);
        this.logger.debug(`Casbin policy removed: * ${existing.path} ${existing.method}`);
        await this.casbinService.addPolicy('*', updated.path, updated.method);
        this.logger.debug(`Casbin policy added: * ${updated.path} ${updated.method}`);
      } catch (err) {
        this.logger.error(`Failed to sync Casbin policy for API update: ${err}`);
      }
    }

    // Rebuild dynamic role→API policies if permission changed
    if (dto.permission !== undefined && dto.permission !== existing.permission) {
      try {
        await this.casbinService.loadRoleApiPolicies();
        this.logger.debug(`Casbin role-API policies reloaded after permission change`);
      } catch (err) {
        this.logger.error(`Failed to reload Casbin role-API policies: ${err}`);
      }
    }

    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.findOne(id);

    await this.db
      .update(sysApis)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysApis.id, id), isNull(sysApis.deletedAt)));

    // Remove Casbin policy for this API
    try {
      await this.casbinService.removeFilteredPolicy(0, existing.path, existing.method);
      this.logger.debug(`Casbin policy removed: * ${existing.path} ${existing.method}`);
    } catch (err) {
      this.logger.error(`Failed to remove Casbin policy for ${existing.method} ${existing.path}: ${err}`);
    }
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Find all APIs that will be removed so we can clean up Casbin policies
    const apisToRemove = await this.db
      .select()
      .from(sysApis)
      .where(and(inArray(sysApis.id, ids), isNull(sysApis.deletedAt)));

    const rows = await this.db
      .update(sysApis)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysApis.id, ids), isNull(sysApis.deletedAt)))
      .returning({ id: sysApis.id });

    // Clean up Casbin policies for each removed API
    for (const api of apisToRemove) {
      try {
        await this.casbinService.removeFilteredPolicy(0, api.path, api.method);
        this.logger.debug(`Casbin policy removed (batch): * ${api.path} ${api.method}`);
      } catch (err) {
        this.logger.error(`Failed to remove Casbin policy for ${api.method} ${api.path}: ${err}`);
      }
    }

    return { count: rows.length };
  }

  async getApiGroups(withCount?: boolean): Promise<string[] | { group: string; count: number }[]> {
    if (withCount) {
      const rows = await this.db
        .select({ group: sysApis.apiGroup, count: sql<number>`count(*)::int` })
        .from(sysApis)
        .where(isNull(sysApis.deletedAt))
        .groupBy(sysApis.apiGroup)
        .orderBy(sysApis.apiGroup);
      return rows.map((r) => ({ group: r.group!, count: r.count }));
    }

    const rows = await this.db
      .selectDistinct({ apiGroup: sysApis.apiGroup })
      .from(sysApis)
      .where(isNull(sysApis.deletedAt))
      .orderBy(sysApis.apiGroup);

    return rows.map((r) => r.apiGroup!);
  }
}
