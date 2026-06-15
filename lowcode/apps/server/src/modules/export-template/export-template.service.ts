import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, like, count, inArray, sql } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysExportTemplates, SysExportTemplate, NewSysExportTemplate } from '../../db/schema/export-templates';
import { CreateExportTemplateDto } from './dto/create-export-template.dto';
import { UpdateExportTemplateDto } from './dto/update-export-template.dto';
import { QueryExportTemplateDto } from './dto/query-export-template.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ExportTemplateService {
  private readonly logger = new Logger(ExportTemplateService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryExportTemplateDto): Promise<PaginatedData<SysExportTemplate>> {
    const { page, pageSize, name, tableName, templateType } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysExportTemplates.deletedAt)];

    if (name) {
      conditions.push(like(sysExportTemplates.name, `%${name}%`));
    }
    if (tableName) {
      conditions.push(like(sysExportTemplates.tableName, `%${tableName}%`));
    }
    if (templateType) {
      conditions.push(eq(sysExportTemplates.templateType, templateType));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysExportTemplates)
        .where(whereClause)
        .orderBy(sysExportTemplates.createdAt)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysExportTemplates)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysExportTemplate> {
    const rows = await this.db
      .select()
      .from(sysExportTemplates)
      .where(and(eq(sysExportTemplates.id, id), isNull(sysExportTemplates.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Export template with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateExportTemplateDto): Promise<SysExportTemplate> {
    // Check name uniqueness
    const existing = await this.db
      .select()
      .from(sysExportTemplates)
      .where(
        and(
          eq(sysExportTemplates.name, dto.name),
          isNull(sysExportTemplates.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Export template '${dto.name}' already exists`,
      });
    }

    const rows = await this.db
      .insert(sysExportTemplates)
      .values({
        name: dto.name,
        tableName: dto.tableName,
        templateType: dto.templateType,
        config: dto.config ?? {},
      } satisfies NewSysExportTemplate)
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateExportTemplateDto): Promise<SysExportTemplate> {
    const existing = await this.findOne(id);

    // If name is changing, check uniqueness
    if (dto.name !== undefined && dto.name !== existing.name) {
      const conflict = await this.db
        .select()
        .from(sysExportTemplates)
        .where(
          and(
            eq(sysExportTemplates.name, dto.name),
            isNull(sysExportTemplates.deletedAt),
          ),
        )
        .limit(1);

      if (conflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Export template '${dto.name}' already exists`,
        });
      }
    }

    type UpdateFields = {
      name?: string;
      tableName?: string;
      templateType?: string;
      config?: Record<string, any>;
      updatedAt?: Date;
    };

    const updateData: UpdateFields = { updatedAt: new Date() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.tableName !== undefined) updateData.tableName = dto.tableName;
    if (dto.templateType !== undefined) updateData.templateType = dto.templateType;
    if (dto.config !== undefined) updateData.config = dto.config;

    const rows = await this.db
      .update(sysExportTemplates)
      .set(updateData)
      .where(and(eq(sysExportTemplates.id, id), isNull(sysExportTemplates.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysExportTemplates)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysExportTemplates.id, id), isNull(sysExportTemplates.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    const rows = await this.db
      .update(sysExportTemplates)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(sysExportTemplates.id, ids), isNull(sysExportTemplates.deletedAt)))
      .returning({ id: sysExportTemplates.id });

    return { count: rows.length };
  }

  async previewSql(id: string): Promise<{ sql: string; tableName: string }> {
    const template = await this.findOne(id);
    const columns = template.config && typeof template.config === 'object'
      ? (template.config as Record<string, any>).columns as string[] | undefined
      : undefined;

    const columnList = columns && columns.length > 0
      ? columns.map((c) => `"${c}"`).join(', ')
      : '*';

    const generatedSql = `SELECT ${columnList} FROM "${template.tableName}" WHERE "deleted_at" IS NULL`;

    return {
      sql: generatedSql,
      tableName: template.tableName,
    };
  }

  async exportData(id: string): Promise<{ data: any[]; format: string; templateName: string }> {
    const template = await this.findOne(id);
    const columns = template.config && typeof template.config === 'object'
      ? (template.config as Record<string, any>).columns as string[] | undefined
      : undefined;

    // Query data from the target table using raw SQL
    const columnList = columns && columns.length > 0
      ? columns.map((c) => `"${c}"`).join(', ')
      : '*';

    const query = `SELECT ${columnList} FROM "${template.tableName}" WHERE "deleted_at" IS NULL`;
    let rows: any[] = [];
    try {
      rows = await this.db.execute(sql.raw(query));
    } catch (err) {
      this.logger.error(`Failed to query table ${template.tableName}: ${err}`);
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Failed to query table '${template.tableName}': table may not exist`,
      });
    }

    return {
      data: rows,
      format: template.templateType,
      templateName: template.name,
    };
  }

  async importData(
    file: Express.Multer.File,
    templateId?: string,
  ): Promise<{ imported: number; tableName: string }> {
    // Parse the uploaded file as JSON
    let records: any[] = [];
    try {
      const content = file.buffer.toString('utf-8');
      records = JSON.parse(content);
      if (!Array.isArray(records)) {
        records = [records];
      }
    } catch {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: 'Invalid JSON file format',
      });
    }

    if (records.length === 0) {
      return { imported: 0, tableName: templateId || 'unknown' };
    }

    // Determine target table
    let tableName: string;
    if (templateId) {
      const template = await this.findOne(templateId);
      tableName = template.tableName;
    } else {
      tableName = 'unknown';
    }

    // Insert records using raw SQL with values inlined
    const keys = Object.keys(records[0]);
    const quotedKeys = keys.map((k) => `"${k}"`).join(', ');

    let imported = 0;
    for (const record of records) {
      try {
        const valueList = keys
          .map((k) => {
            const v = record[k];
            if (v === null || v === undefined) return 'NULL';
            if (typeof v === 'number') return String(v);
            // Escape single quotes for string values
            return `'${String(v).replace(/'/g, "''")}'`;
          })
          .join(', ');
        const insertSql = `INSERT INTO "${tableName}" (${quotedKeys}) VALUES (${valueList})`;
        await this.db.execute(sql.raw(insertSql));
        imported++;
      } catch (err) {
        this.logger.error(`Failed to import record into ${tableName}: ${err}`);
      }
    }

    return { imported, tableName };
  }
}
