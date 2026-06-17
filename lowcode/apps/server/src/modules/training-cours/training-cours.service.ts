import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { trainingCourses, TrainingCourses } from '../../db/schema/training-courses';
import { trainingCoursModule } from '../../db/schema/training-courses';
import { trainingCoursModuleTask } from '../../db/schema/training-courses';
import { CreateTrainingCoursDto } from './dto/create-training-cours.dto';
import { UpdateTrainingCoursDto } from './dto/update-training-cours.dto';
import { QueryTrainingCoursDto } from './dto/query-training-cours.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class TrainingCoursService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryTrainingCoursDto): Promise<PaginatedData<TrainingCourses>> {
    const { page, pageSize, name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(trainingCourses.deletedAt)];

    if (name) {
      conditions.push(like(trainingCourses.name, `%${name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(trainingCourses)
        .where(whereClause)
        .orderBy(desc(trainingCourses.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(trainingCourses)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const modulesRows = await this.db
        .select()
        .from(trainingCoursModule)
        .where(and(inArray(trainingCoursModule.trainingCours_id, masterIds), isNull(trainingCoursModule.deletedAt)));
      if (modulesRows.length > 0) {
        const modulesChildIds = modulesRows.map((r: any) => r.id);
        const tasksRows2 = await this.db.select().from(trainingCoursModuleTask).where(and(inArray(trainingCoursModuleTask.trainingCoursModule_id, modulesChildIds), isNull(trainingCoursModuleTask.deletedAt)));
        const tasksByChild = new Map<string, any[]>();
        for (const r of tasksRows2) { if (r.trainingCoursModule_id == null) continue; const a = tasksByChild.get(r.trainingCoursModule_id) || []; a.push(r); tasksByChild.set(r.trainingCoursModule_id, a); }
        for (const r of modulesRows) { (r as any).tasks = tasksByChild.get(r.id) || []; }
      }
      const modulesByMaster = new Map<string, any[]>();
      for (const row of modulesRows) {
        if (row.trainingCours_id == null) continue;
        const arr = modulesByMaster.get(row.trainingCours_id) || [];
        arr.push(row);
        modulesByMaster.set(row.trainingCours_id, arr);
      }
      for (const row of rows) {
        (row as any).modules = modulesByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<TrainingCourses> {
    const rows = await this.db
      .select()
      .from(trainingCourses)
      .where(and(eq(trainingCourses.id, id), isNull(trainingCourses.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `TrainingCours with id ${id} not found`,
      });
    }
    (rows[0] as any).modules = await this.getModules(id);
    return rows[0]!;
  }

  async create(dto: CreateTrainingCoursDto): Promise<TrainingCourses> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(trainingCourses)
      .where(and(eq(trainingCourses.name, dto.name), isNull(trainingCourses.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(trainingCourses)
        .values({
          name: dto.name,
          description: dto.description,
          start_date: dto.start_date ? new Date(dto.start_date) : new Date(),
          end_date: dto.end_date ? new Date(dto.end_date) : new Date(),
          is_published: dto.is_published,
        })
        .returning();
      const created = rows[0]!;
      if (dto.modules && (dto.modules as any[]).length > 0) {
        await tx.insert(trainingCoursModule).values(
          (dto.modules as any[]).map((d: any) => ({
            trainingCours_id: created.id,
            module_name: d.module_name,
            module_desc: d.module_desc,
            sort_order: d.sort_order,
            tasks: d.tasks,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateTrainingCoursDto): Promise<TrainingCourses> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(trainingCourses)
        .where(and(eq(trainingCourses.name, dto.name), isNull(trainingCourses.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }

    type TrainingCoursUpdateFields = {
      name?: string;
      description?: string;
      start_date?: Date;
      end_date?: Date;
      is_published?: boolean;
      updatedAt?: Date;
    };

    const updateData: TrainingCoursUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.start_date !== undefined) updateData.start_date = dto.start_date ? new Date(dto.start_date) : undefined;
    if (dto.end_date !== undefined) updateData.end_date = dto.end_date ? new Date(dto.end_date) : undefined;
    if (dto.is_published !== undefined) updateData.is_published = dto.is_published;

    const rows = await this.db
      .update(trainingCourses)
      .set(updateData)
      .where(and(eq(trainingCourses.id, id), isNull(trainingCourses.deletedAt)))
      .returning();

    if (dto.modules !== undefined) {
      await this.updateModules(id, dto.modules as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeModules(id);

    await this.db
      .update(trainingCourses)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(trainingCourses.id, id), isNull(trainingCourses.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeModules(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(trainingCourses)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(trainingCourses.id, ids), isNull(trainingCourses.deletedAt)))
      .returning({ id: trainingCourses.id });

    return { count: rows.length };
  }

  async getModules(trainingCours_id: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(trainingCoursModule)
      .where(and(eq(trainingCoursModule.trainingCours_id, trainingCours_id), isNull(trainingCoursModule.deletedAt)));

    if (rows.length > 0) {
      const childIds = rows.map((r) => r.id);
      const tasksRows = await this.db.select().from(trainingCoursModuleTask).where(and(inArray(trainingCoursModuleTask.trainingCoursModule_id, childIds), isNull(trainingCoursModuleTask.deletedAt)));
      const tasksByChild = new Map<string, any[]>();
      for (const r of tasksRows) { if (r.trainingCoursModule_id == null) continue; const a = tasksByChild.get(r.trainingCoursModule_id) || []; a.push(r); tasksByChild.set(r.trainingCoursModule_id, a); }
      for (const r of rows) { (r as any).tasks = tasksByChild.get(r.id) || []; }
    }
    return rows;
  }

  async createModules(trainingCours_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      trainingCours_id,
      module_name: d.module_name,
      module_desc: d.module_desc,
      sort_order: d.sort_order,
    }));
    const inserted = await this.db.insert(trainingCoursModule).values(values).returning();
    for (let i = 0; i < inserted.length; i++) {
      const d = details[i];
      const childId = inserted[i].id;
      if (d.tasks && (d.tasks as any[]).length > 0) {
        await this.createModulesTasks(childId, d.tasks as any[]);
      }
    }
  }

  async updateModules(trainingCours_id: string, details: any[]): Promise<void> {
    const existing = await this.getModules(trainingCours_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      for (const del of toDelete) {
        await this.removeModulesTasks(del.id);
      }
      await this.db
        .update(trainingCoursModule)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(trainingCoursModule.id, toDelete.map((r) => r.id)), isNull(trainingCoursModule.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(trainingCoursModule)
        .set({
          module_name: d.module_name,
          module_desc: d.module_desc,
          sort_order: d.sort_order,
          updatedAt: sql`NOW()`,
        })
        .where(eq(trainingCoursModule.id, d.id));
      if (d.tasks !== undefined) {
        await this.updateModulesTasks(d.id, d.tasks as any[]);
      }
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createModules(trainingCours_id, newRows);
    }
  }

  async removeModules(trainingCours_id: string): Promise<void> {
    const childRows = await this.db.select({ id: trainingCoursModule.id }).from(trainingCoursModule).where(and(eq(trainingCoursModule.trainingCours_id, trainingCours_id), isNull(trainingCoursModule.deletedAt)));
    for (const cr of childRows) {
      await this.removeModulesTasks(cr.id);
    }
    await this.db
      .update(trainingCoursModule)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(trainingCoursModule.trainingCours_id, trainingCours_id), isNull(trainingCoursModule.deletedAt)));
  }

  async getModulesTasks(trainingCoursModule_id: string): Promise<any[]> {
    return this.db
      .select()
      .from(trainingCoursModuleTask)
      .where(and(eq(trainingCoursModuleTask.trainingCoursModule_id, trainingCoursModule_id), isNull(trainingCoursModuleTask.deletedAt)));
  }

  async createModulesTasks(trainingCoursModule_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      trainingCoursModule_id,
      task_name: d.task_name,
      task_desc: d.task_desc,
      due_hours: d.due_hours,
      sort_order: d.sort_order,
    }));
    await this.db.insert(trainingCoursModuleTask).values(values);
  }

  async updateModulesTasks(trainingCoursModule_id: string, details: any[]): Promise<void> {
    const existing = await this.getModulesTasks(trainingCoursModule_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(trainingCoursModuleTask)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(trainingCoursModuleTask.id, toDelete.map((r) => r.id)), isNull(trainingCoursModuleTask.deletedAt)));
    }

    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(trainingCoursModuleTask)
        .set({
          task_name: d.task_name,
          task_desc: d.task_desc,
          due_hours: d.due_hours,
          sort_order: d.sort_order,
          updatedAt: sql`NOW()`,
        })
        .where(eq(trainingCoursModuleTask.id, d.id));
    }

    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createModulesTasks(trainingCoursModule_id, newRows);
    }
  }

  async removeModulesTasks(trainingCoursModule_id: string): Promise<void> {
    await this.db
      .update(trainingCoursModuleTask)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(trainingCoursModuleTask.trainingCoursModule_id, trainingCoursModule_id), isNull(trainingCoursModuleTask.deletedAt)));
  }

}
