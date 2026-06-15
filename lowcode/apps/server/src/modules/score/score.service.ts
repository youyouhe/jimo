import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { score, Score } from '../../db/schema/score';
import { student } from '../../db/schema/student';
import { course } from '../../db/schema/course';
import { CreateScoreDto } from './dto/create-score.dto';
import { UpdateScoreDto } from './dto/update-score.dto';
import { QueryScoreDto } from './dto/query-score.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ScoreService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryScoreDto): Promise<PaginatedData<Score>> {
    const { page, pageSize, student: studentFilter, course: courseFilter, myscoreMin, myscoreMax, memo } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(score.deletedAt)];

    if (studentFilter) {
      conditions.push(eq(score.student, studentFilter));
    }
    if (courseFilter) {
      conditions.push(eq(score.course, courseFilter));
    }
    if (myscoreMin) {
      conditions.push(gte(score.myscore, String(myscoreMin)));
    }
    if (myscoreMax) {
      conditions.push(lte(score.myscore, String(myscoreMax)));
    }
    if (memo) {
      conditions.push(like(score.memo, `%${memo}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(score),
      student_display: student.name,
      course_display: course.course,
        })
        .from(score)
        .leftJoin(student, eq(score.student, student.id))
        .leftJoin(course, eq(score.course, course.id))
        .where(whereClause)
        .orderBy(desc(score.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(score)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Score> {
    const rows = await this.db
      .select({
        ...getTableColumns(score),
      student_display: student.name,
      course_display: course.course,
      })
      .from(score)
        .leftJoin(student, eq(score.student, student.id))
        .leftJoin(course, eq(score.course, course.id))
      .where(and(eq(score.id, id), isNull(score.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Score with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateScoreDto): Promise<Score> {

    const rows = await this.db
      .insert(score)
      .values({
        student: dto.student,
        course: dto.course,
        myscore: String(dto.myscore),
        memo: dto.memo,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateScoreDto): Promise<Score> {
    const existing = await this.findOne(id);


    type ScoreUpdateFields = {
      student?: string;
      course?: string;
      myscore?: string;
      memo?: string;
      updatedAt?: Date;
    };

    const updateData: ScoreUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.student !== undefined) updateData.student = dto.student;
    if (dto.course !== undefined) updateData.course = dto.course;
    if (dto.myscore !== undefined) updateData.myscore = String(dto.myscore);
    if (dto.memo !== undefined) updateData.memo = dto.memo;

    const rows = await this.db
      .update(score)
      .set(updateData)
      .where(and(eq(score.id, id), isNull(score.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(score)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(score.id, id), isNull(score.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(score)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(score.id, ids), isNull(score.deletedAt)))
      .returning({ id: score.id });

    return { count: rows.length };
  }

}
