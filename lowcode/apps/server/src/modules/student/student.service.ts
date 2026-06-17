import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { students, Students } from '../../db/schema/students';
import { studentClubs } from '../../db/schema/student-clubs';
import { clubs } from '../../db/schema/clubs';
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

  async findAll(query: QueryStudentDto): Promise<PaginatedData<Students>> {
    const { page, pageSize, name, student_no, gender, enrollment_yearMin, enrollment_yearMax } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(students.deletedAt)];

    if (name) {
      conditions.push(like(students.name, `%${name}%`));
    }
    if (student_no) {
      conditions.push(like(students.student_no, `%${student_no}%`));
    }
    if (gender) {
      conditions.push(eq(students.gender, gender));
    }
    if (enrollment_yearMin) {
      conditions.push(gte(students.enrollment_year, enrollment_yearMin));
    }
    if (enrollment_yearMax) {
      conditions.push(lte(students.enrollment_year, enrollment_yearMax));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(students)
        .where(whereClause)
        .orderBy(desc(students.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(students)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const club_recordsRows = await this.db
        .select({
          id: studentClubs.id,
          student_id: studentClubs.student_id,
          club_id: studentClubs.club_id,
          join_date: studentClubs.join_date,
          role: studentClubs.role,
          club_id_display: clubs.name,
        })
        .from(studentClubs)
            .leftJoin(clubs, eq(studentClubs.club_id, clubs.id))
        .where(and(inArray(studentClubs.student_id, masterIds), isNull(studentClubs.deletedAt)));
      const club_recordsByMaster = new Map<string, any[]>();
      for (const row of club_recordsRows) {
        if (row.student_id == null) continue;
        const arr = club_recordsByMaster.get(row.student_id) || [];
        arr.push(row);
        club_recordsByMaster.set(row.student_id, arr);
      }
      for (const row of rows) {
        (row as any).club_records = club_recordsByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Students> {
    const rows = await this.db
      .select()
      .from(students)
      .where(and(eq(students.id, id), isNull(students.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Student with id ${id} not found`,
      });
    }
    (rows[0] as any).club_records = await this.getClubRecords(id);
    return rows[0]!;
  }

  async create(dto: CreateStudentDto): Promise<Students> {
    // Check unique: student_no
    const existingByStudentNo = await this.db
      .select()
      .from(students)
      .where(and(eq(students.student_no, dto.student_no), isNull(students.deletedAt)))
      .limit(1);

    if (existingByStudentNo.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `StudentNo '${dto.student_no}' is already taken`,
      });
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(students)
        .values({
          name: dto.name,
          student_no: dto.student_no,
          gender: dto.gender,
          enrollment_year: dto.enrollment_year,
        })
        .returning();
      const created = rows[0]!;
      if (dto.club_records && (dto.club_records as any[]).length > 0) {
        await tx.insert(studentClubs).values(
          (dto.club_records as any[]).map((d: any) => ({
            student_id: created.id,
            club_id: d.club_id,
            join_date: d.join_date ? new Date(d.join_date) : new Date(),
            role: d.role,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateStudentDto): Promise<Students> {
    const existing = await this.findOne(id);


    type StudentUpdateFields = {
      name?: string;
      gender?: string;
      enrollment_year?: number;
      updatedAt?: Date;
    };

    const updateData: StudentUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.enrollment_year !== undefined) updateData.enrollment_year = dto.enrollment_year;

    const rows = await this.db
      .update(students)
      .set(updateData)
      .where(and(eq(students.id, id), isNull(students.deletedAt)))
      .returning();

    if (dto.club_records !== undefined) {
      await this.updateClubRecords(id, dto.club_records as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeClubRecords(id);

    await this.db
      .update(students)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(students.id, id), isNull(students.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeClubRecords(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(students)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(students.id, ids), isNull(students.deletedAt)))
      .returning({ id: students.id });

    return { count: rows.length };
  }

  async getClubRecords(student_id: string): Promise<any[]> {
    const rows = await this.db
      .select({
      club_id: studentClubs.club_id,
      join_date: studentClubs.join_date,
      role: studentClubs.role,
      
      club_id_display: clubs.name,
    })
      .from(studentClubs)
        .leftJoin(clubs, eq(studentClubs.club_id, clubs.id))
      .where(and(eq(studentClubs.student_id, student_id), isNull(studentClubs.deletedAt)));

    return rows;
  }

  async createClubRecords(student_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      student_id,
      club_id: d.club_id,
      join_date: d.join_date ? new Date(d.join_date) : new Date(),
      role: d.role,
    }));
    const inserted = await this.db.insert(studentClubs).values(values).returning();

  }

  async updateClubRecords(student_id: string, details: any[]): Promise<void> {
    const existing = await this.getClubRecords(student_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(studentClubs)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(studentClubs.id, toDelete.map((r) => r.id)), isNull(studentClubs.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(studentClubs)
        .set({
          club_id: d.club_id,
          join_date: d.join_date ? new Date(d.join_date) : new Date(),
          role: d.role,
          updatedAt: sql`NOW()`,
        })
        .where(eq(studentClubs.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createClubRecords(student_id, newRows);
    }
  }

  async removeClubRecords(student_id: string): Promise<void> {

    await this.db
      .update(studentClubs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(studentClubs.student_id, student_id), isNull(studentClubs.deletedAt)));
  }

}
