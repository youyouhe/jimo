import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { projects, Projects } from '../../db/schema/projects';
import { projectTasks } from '../../db/schema/project-tasks';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectDto } from './dto/query-project.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryProjectDto): Promise<PaginatedData<Projects>> {
    const { page, pageSize, name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(projects.deletedAt)];

    if (name) {
      conditions.push(like(projects.name, `%${name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(projects)
        .where(whereClause)
        .orderBy(desc(projects.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(projects)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const tasksRows = await this.db
        .select()
        .from(projectTasks)
        .where(and(inArray(projectTasks.project_id, masterIds), isNull(projectTasks.deletedAt)));
      const tasksByMaster = new Map<string, any[]>();
      for (const row of tasksRows) {
        if (row.project_id == null) continue;
        const arr = tasksByMaster.get(row.project_id) || [];
        arr.push(row);
        tasksByMaster.set(row.project_id, arr);
      }
      for (const row of rows) {
        (row as any).tasks = tasksByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Projects> {
    const rows = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Project with id ${id} not found`,
      });
    }
    (rows[0] as any).tasks = await this.getTasks(id);
    return rows[0]!;
  }

  async create(dto: CreateProjectDto): Promise<Projects> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(projects)
      .where(and(eq(projects.name, dto.name), isNull(projects.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(projects)
        .values({
          name: dto.name,
          description: dto.description,
          start_date: dto.start_date ? new Date(dto.start_date) : new Date(),
          end_date: dto.end_date ? new Date(dto.end_date) : null,
          is_active: dto.is_active,
        })
        .returning();
      const created = rows[0]!;
      if (dto.tasks && (dto.tasks as any[]).length > 0) {
        await tx.insert(projectTasks).values(
          (dto.tasks as any[]).map((d: any) => ({
            project_id: created.id,
            task_name: d.task_name,
            assignee: d.assignee,
            status: d.status,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateProjectDto): Promise<Projects> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(projects)
        .where(and(eq(projects.name, dto.name), isNull(projects.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }

    type ProjectUpdateFields = {
      name?: string;
      description?: string;
      start_date?: Date;
      end_date?: Date;
      is_active?: boolean;
      updatedAt?: Date;
    };

    const updateData: ProjectUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.start_date !== undefined) updateData.start_date = dto.start_date ? new Date(dto.start_date) : undefined;
    if (dto.end_date !== undefined) updateData.end_date = dto.end_date ? new Date(dto.end_date) : undefined;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;

    const rows = await this.db
      .update(projects)
      .set(updateData)
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)))
      .returning();

    if (dto.tasks !== undefined) {
      await this.updateTasks(id, dto.tasks as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeTasks(id);

    await this.db
      .update(projects)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(projects.id, id), isNull(projects.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeTasks(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(projects)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(projects.id, ids), isNull(projects.deletedAt)))
      .returning({ id: projects.id });

    return { count: rows.length };
  }

  async getTasks(project_id: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(projectTasks)
      .where(and(eq(projectTasks.project_id, project_id), isNull(projectTasks.deletedAt)));

    return rows;
  }

  async createTasks(project_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      project_id,
      task_name: d.task_name,
      assignee: d.assignee,
      status: d.status,
    }));
    const inserted = await this.db.insert(projectTasks).values(values).returning();

  }

  async updateTasks(project_id: string, details: any[]): Promise<void> {
    const existing = await this.getTasks(project_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(projectTasks)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(projectTasks.id, toDelete.map((r) => r.id)), isNull(projectTasks.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(projectTasks)
        .set({
          task_name: d.task_name,
          assignee: d.assignee,
          status: d.status,
          updatedAt: sql`NOW()`,
        })
        .where(eq(projectTasks.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createTasks(project_id, newRows);
    }
  }

  async removeTasks(project_id: string): Promise<void> {

    await this.db
      .update(projectTasks)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(projectTasks.project_id, project_id), isNull(projectTasks.deletedAt)));
  }

}
