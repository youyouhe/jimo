import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { projectTasks, ProjectTasks } from '../../db/schema/project-tasks';
import { projects } from '../../db/schema/projects';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';
import { UpdateProjectTaskDto } from './dto/update-project-task.dto';
import { QueryProjectTaskDto } from './dto/query-project-task.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ProjectTaskService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryProjectTaskDto): Promise<PaginatedData<ProjectTasks>> {
    const { page, pageSize, project_id, task_name, assignee, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(projectTasks.deletedAt)];

    if (project_id) {
      conditions.push(eq(projectTasks.project_id, project_id));
    }
    if (task_name) {
      conditions.push(like(projectTasks.task_name, `%${task_name}%`));
    }
    if (assignee) {
      conditions.push(like(projectTasks.assignee, `%${assignee}%`));
    }
    if (status) {
      conditions.push(eq(projectTasks.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(projectTasks),
      project_id_display: projects.name,
        })
        .from(projectTasks)
        .leftJoin(projects, eq(projectTasks.project_id, projects.id))
        .where(whereClause)
        .orderBy(desc(projectTasks.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(projectTasks)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<ProjectTasks> {
    const rows = await this.db
      .select({
        ...getTableColumns(projectTasks),
      project_id_display: projects.name,
      })
      .from(projectTasks)
        .leftJoin(projects, eq(projectTasks.project_id, projects.id))
      .where(and(eq(projectTasks.id, id), isNull(projectTasks.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `ProjectTask with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateProjectTaskDto): Promise<ProjectTasks> {

    const rows = await this.db
      .insert(projectTasks)
      .values({
        project_id: dto.project_id,
        task_name: dto.task_name,
        assignee: dto.assignee,
        status: dto.status,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateProjectTaskDto): Promise<ProjectTasks> {
    const existing = await this.findOne(id);


    type ProjectTaskUpdateFields = {
      project_id?: string;
      task_name?: string;
      assignee?: string;
      status?: string;
      updatedAt?: Date;
    };

    const updateData: ProjectTaskUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.project_id !== undefined) updateData.project_id = dto.project_id ?? undefined;
    if (dto.task_name !== undefined) updateData.task_name = dto.task_name;
    if (dto.assignee !== undefined) updateData.assignee = dto.assignee;
    if (dto.status !== undefined) updateData.status = dto.status;

    const rows = await this.db
      .update(projectTasks)
      .set(updateData)
      .where(and(eq(projectTasks.id, id), isNull(projectTasks.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(projectTasks)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(projectTasks.id, id), isNull(projectTasks.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(projectTasks)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(projectTasks.id, ids), isNull(projectTasks.deletedAt)))
      .returning({ id: projectTasks.id });

    return { count: rows.length };
  }

}
