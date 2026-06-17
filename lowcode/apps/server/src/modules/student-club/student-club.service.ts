import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { studentClubs, StudentClubs } from '../../db/schema/student-clubs';
import { students } from '../../db/schema/students';
import { clubs } from '../../db/schema/clubs';
import { CreateStudentClubDto } from './dto/create-student-club.dto';
import { UpdateStudentClubDto } from './dto/update-student-club.dto';
import { QueryStudentClubDto } from './dto/query-student-club.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class StudentClubService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryStudentClubDto): Promise<PaginatedData<StudentClubs>> {
    const { page, pageSize, student_id, club_id } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(studentClubs.deletedAt)];

    if (student_id) {
      conditions.push(eq(studentClubs.student_id, student_id));
    }
    if (club_id) {
      conditions.push(eq(studentClubs.club_id, club_id));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(studentClubs),
      student_id_display: students.name,
      club_id_display: clubs.name,
        })
        .from(studentClubs)
        .leftJoin(students, eq(studentClubs.student_id, students.id))
        .leftJoin(clubs, eq(studentClubs.club_id, clubs.id))
        .where(whereClause)
        .orderBy(desc(studentClubs.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(studentClubs)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<StudentClubs> {
    const rows = await this.db
      .select({
        ...getTableColumns(studentClubs),
      student_id_display: students.name,
      club_id_display: clubs.name,
      })
      .from(studentClubs)
        .leftJoin(students, eq(studentClubs.student_id, students.id))
        .leftJoin(clubs, eq(studentClubs.club_id, clubs.id))
      .where(and(eq(studentClubs.id, id), isNull(studentClubs.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `StudentClub with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateStudentClubDto): Promise<StudentClubs> {

    const rows = await this.db
      .insert(studentClubs)
      .values({
        student_id: dto.student_id,
        club_id: dto.club_id,
        join_date: dto.join_date ? new Date(dto.join_date) : new Date(),
        role: dto.role,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateStudentClubDto): Promise<StudentClubs> {
    const existing = await this.findOne(id);


    type StudentClubUpdateFields = {
      student_id?: string;
      club_id?: string;
      join_date?: Date;
      role?: string;
      updatedAt?: Date;
    };

    const updateData: StudentClubUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.student_id !== undefined) updateData.student_id = dto.student_id ?? undefined;
    if (dto.club_id !== undefined) updateData.club_id = dto.club_id ?? undefined;
    if (dto.join_date !== undefined) updateData.join_date = dto.join_date ? new Date(dto.join_date) : undefined;
    if (dto.role !== undefined) updateData.role = dto.role;

    const rows = await this.db
      .update(studentClubs)
      .set(updateData)
      .where(and(eq(studentClubs.id, id), isNull(studentClubs.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(studentClubs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(studentClubs.id, id), isNull(studentClubs.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(studentClubs)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(studentClubs.id, ids), isNull(studentClubs.deletedAt)))
      .returning({ id: studentClubs.id });

    return { count: rows.length };
  }

}
