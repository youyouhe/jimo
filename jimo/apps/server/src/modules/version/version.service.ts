import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, like, count, inArray, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysVersions, SysVersion, NewSysVersion } from '../../db/schema/versions';
import { CreateVersionDto } from './dto/create-version.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { QueryVersionDto } from './dto/query-version.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class VersionService {
  private readonly logger = new Logger(VersionService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryVersionDto): Promise<PaginatedData<SysVersion>> {
    const { page, pageSize, versionName, versionNumber } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysVersions.deletedAt)];

    if (versionName) {
      conditions.push(like(sysVersions.versionName, `%${versionName}%`));
    }
    if (versionNumber) {
      conditions.push(like(sysVersions.versionNumber, `%${versionNumber}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysVersions)
        .where(whereClause)
        .orderBy(sysVersions.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysVersions)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysVersion> {
    const rows = await this.db
      .select()
      .from(sysVersions)
      .where(and(eq(sysVersions.id, id), isNull(sysVersions.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Version with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateVersionDto): Promise<SysVersion> {
    // Check versionNumber uniqueness
    const existing = await this.db
      .select()
      .from(sysVersions)
      .where(
        and(
          eq(sysVersions.versionNumber, dto.versionNumber),
          isNull(sysVersions.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Version number '${dto.versionNumber}' already exists`,
      });
    }

    const rows = await this.db
      .insert(sysVersions)
      .values({
        versionName: dto.versionName,
        versionNumber: dto.versionNumber,
        description: dto.description ?? null,
        data: dto.data ?? null,
      } satisfies NewSysVersion)
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateVersionDto): Promise<SysVersion> {
    const existing = await this.findOne(id);

    // If versionNumber is changing, check uniqueness
    if (dto.versionNumber !== undefined && dto.versionNumber !== existing.versionNumber) {
      const conflict = await this.db
        .select()
        .from(sysVersions)
        .where(
          and(
            eq(sysVersions.versionNumber, dto.versionNumber),
            isNull(sysVersions.deletedAt),
          ),
        )
        .limit(1);

      if (conflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Version number '${dto.versionNumber}' already exists`,
        });
      }
    }

    type UpdateFields = {
      versionName?: string;
      versionNumber?: string;
      description?: string | null;
      data?: Record<string, any> | null;
      updatedAt?: Date;
    };

    const updateData: UpdateFields = { updatedAt: new Date() };
    if (dto.versionName !== undefined) updateData.versionName = dto.versionName;
    if (dto.versionNumber !== undefined) updateData.versionNumber = dto.versionNumber;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.data !== undefined) updateData.data = dto.data;

    const rows = await this.db
      .update(sysVersions)
      .set(updateData)
      .where(and(eq(sysVersions.id, id), isNull(sysVersions.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysVersions)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysVersions.id, id), isNull(sysVersions.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const rows = await this.db
      .update(sysVersions)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysVersions.id, ids), isNull(sysVersions.deletedAt)))
      .returning({ id: sysVersions.id });

    return { count: rows.length };
  }

  async exportVersion(id: string): Promise<Record<string, any>> {
    const version = await this.findOne(id);
    return {
      versionName: version.versionName,
      versionNumber: version.versionNumber,
      description: version.description,
      data: version.data,
      exportedAt: new Date().toISOString(),
    };
  }

  async importVersion(data: Record<string, any>): Promise<SysVersion> {
    const versionNumber = data.versionNumber || `imported-${Date.now()}`;
    const versionName = data.versionName || 'Imported Version';
    const description = data.description || 'Imported from file';
    const versionData = data.data || {};

    // Check if version number already exists
    const existing = await this.db
      .select()
      .from(sysVersions)
      .where(
        and(
          eq(sysVersions.versionNumber, versionNumber),
          isNull(sysVersions.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Version number '${versionNumber}' already exists`,
      });
    }

    const rows = await this.db
      .insert(sysVersions)
      .values({
        versionName,
        versionNumber,
        description,
        data: versionData,
      } satisfies NewSysVersion)
      .returning();

    return rows[0]!;
  }
}
