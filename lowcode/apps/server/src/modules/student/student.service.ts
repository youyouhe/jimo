import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { student, Student } from '../../db/schema/student';
import { studentFamily } from '../../db/schema/student';
import { score } from '../../db/schema/score';
import { course } from '../../db/schema/course';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentDto } from './dto/query-student.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class StudentService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryStudentDto): Promise<PaginatedData<Student>> {
    const { page, pageSize, name, ageMin, ageMax } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(student.deletedAt)];

    if (name) {
      conditions.push(like(student.name, `%${name}%`));
    }
    if (ageMin) {
      conditions.push(gte(student.age, ageMin));
    }
    if (ageMax) {
      conditions.push(lte(student.age, ageMax));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(student)
        .where(whereClause)
        .orderBy(desc(student.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(student)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const familyRows = await this.db
        .select()
        .from(studentFamily)
        .where(and(inArray(studentFamily.student_id, masterIds), isNull(studentFamily.deletedAt)));
      const familyByMaster = new Map<string, any[]>();
      for (const row of familyRows) {
        if (row.student_id == null) continue;
        const arr = familyByMaster.get(row.student_id) || [];
        arr.push(row);
        familyByMaster.set(row.student_id, arr);
      }
      for (const row of rows) {
        (row as any).family = familyByMaster.get(row.id) || [];
      }
      const scoreRows = await this.db
        .select({
          id: score.id,
          student: score.student,
          course: score.course,
          myscore: score.myscore,
          memo: score.memo,
          course_display: course.course,
        })
        .from(score)
            .leftJoin(course, eq(score.course, course.id))
        .where(and(inArray(score.student, masterIds), isNull(score.deletedAt)));
      const scoreByMaster = new Map<string, any[]>();
      for (const row of scoreRows) {
        if (row.student == null) continue;
        const arr = scoreByMaster.get(row.student) || [];
        arr.push(row);
        scoreByMaster.set(row.student, arr);
      }
      for (const row of rows) {
        (row as any).score = scoreByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Student> {
    const rows = await this.db
      .select()
      .from(student)
      .where(and(eq(student.id, id), isNull(student.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Student with id ${id} not found`,
      });
    }
    (rows[0] as any).family = await this.getFamily(id);
    (rows[0] as any).score = await this.getScore(id);
    return rows[0]!;
  }

  async create(dto: CreateStudentDto): Promise<Student> {

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(student)
        .values({
          name: dto.name,
          age: dto.age,
        })
        .returning();
      const created = rows[0]!;
      if (dto.family && (dto.family as any[]).length > 0) {
        await tx.insert(studentFamily).values(
          (dto.family as any[]).map((d: any) => ({
            student_id: created.id,
            name: d.name,
            relation: d.relation,
          })),
        );
      }
      if (dto.score && (dto.score as any[]).length > 0) {
        await tx.insert(score).values(
          (dto.score as any[]).map((d: any) => ({
            student: created.id,
            course: d.course,
            myscore: String(d.myscore),
            memo: d.memo,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateStudentDto): Promise<Student> {
    const existing = await this.findOne(id);


    type StudentUpdateFields = {
      name?: string;
      age?: number;
      updatedAt?: Date;
    };

    const updateData: StudentUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.age !== undefined) updateData.age = dto.age;

    const rows = await this.db
      .update(student)
      .set(updateData)
      .where(and(eq(student.id, id), isNull(student.deletedAt)))
      .returning();

    if (dto.family !== undefined) {
      await this.updateFamily(id, dto.family as any[]);
    }
    if (dto.score !== undefined) {
      await this.updateScore(id, dto.score as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeFamily(id);
    await this.removeScore(id);

    await this.db
      .update(student)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(student.id, id), isNull(student.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeFamily(id);
        await this.removeScore(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(student)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(student.id, ids), isNull(student.deletedAt)))
      .returning({ id: student.id });

    return { count: rows.length };
  }

  async getFamily(student_id: string): Promise<any[]> {
    return this.db
      .select()
      .from(studentFamily)
      .where(and(eq(studentFamily.student_id, student_id), isNull(studentFamily.deletedAt)));
  }

  async createFamily(student_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      student_id,
      name: d.name,
      relation: d.relation,
    }));
    await this.db.insert(studentFamily).values(values);
  }

  async updateFamily(student_id: string, details: any[]): Promise<void> {
    const existing = await this.getFamily(student_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(studentFamily)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(studentFamily.id, toDelete.map((r) => r.id)), isNull(studentFamily.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(studentFamily)
        .set({
          name: d.name,
          relation: d.relation,
          updatedAt: sql`NOW()`,
        })
        .where(eq(studentFamily.id, d.id));
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createFamily(student_id, newRows);
    }
  }

  async removeFamily(student_id: string): Promise<void> {
    await this.db
      .update(studentFamily)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(studentFamily.student_id, student_id), isNull(studentFamily.deletedAt)));
  }

  async getScore(student: string): Promise<any[]> {
    return this.db
      .select({
      id: score.id,
      student: score.student,
      course: score.course,
      myscore: score.myscore,
      memo: score.memo,
      createdAt: score.createdAt,
      updatedAt: score.updatedAt,
      course_display: course.course,})
      .from(score)
        .leftJoin(course, eq(score.course, course.id))
      .where(and(eq(score.student, student), isNull(score.deletedAt)));
  }

  async createScore(student: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      student,
      course: d.course,
      myscore: String(d.myscore),
      memo: d.memo,
    }));
    await this.db.insert(score).values(values);
  }

  async updateScore(student: string, details: any[]): Promise<void> {
    const existing = await this.getScore(student);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(score)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(score.id, toDelete.map((r) => r.id)), isNull(score.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(score)
        .set({
          course: d.course,
          myscore: String(d.myscore),
          memo: d.memo,
          updatedAt: sql`NOW()`,
        })
        .where(eq(score.id, d.id));
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createScore(student, newRows);
    }
  }

  async removeScore(student: string): Promise<void> {
    await this.db
      .update(score)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(score.student, student), isNull(score.deletedAt)));
  }

}
