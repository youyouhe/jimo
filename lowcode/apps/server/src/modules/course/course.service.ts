import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { course, Course } from '../../db/schema/course';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { QueryCourseDto } from './dto/query-course.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class CourseService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryCourseDto): Promise<PaginatedData<Course>> {
    const { page, pageSize, course: courseFilter, teacher } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(course.deletedAt)];

    if (courseFilter) {
      conditions.push(eq(course.course, courseFilter));
    }
    if (teacher) {
      conditions.push(like(course.teacher, `%${teacher}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(course)
        .where(whereClause)
        .orderBy(desc(course.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(course)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Course> {
    const rows = await this.db
      .select()
      .from(course)
      .where(and(eq(course.id, id), isNull(course.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Course with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateCourseDto): Promise<Course> {

    const rows = await this.db
      .insert(course)
      .values({
        course: dto.course,
        teacher: dto.teacher,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateCourseDto): Promise<Course> {
    const existing = await this.findOne(id);


    type CourseUpdateFields = {
      course?: string;
      teacher?: string;
      updatedAt?: Date;
    };

    const updateData: CourseUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.course !== undefined) updateData.course = dto.course;
    if (dto.teacher !== undefined) updateData.teacher = dto.teacher;

    const rows = await this.db
      .update(course)
      .set(updateData)
      .where(and(eq(course.id, id), isNull(course.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(course)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(course.id, id), isNull(course.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(course)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(course.id, ids), isNull(course.deletedAt)))
      .returning({ id: course.id });

    return { count: rows.length };
  }

}
