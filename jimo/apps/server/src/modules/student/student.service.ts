import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { students, Students } from '../../db/schema/students';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';
import { QueryStudentDto } from './dto/query-student.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class StudentService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryStudentDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<Students>> {
    const { page, pageSize, student_no, name, gender, class_name, enrollment_status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(students.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(students.ownerId, students.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);

    if (student_no) {
      conditions.push(like(students.student_no, `%${student_no}%`));
    }
    if (name) {
      conditions.push(like(students.name, `%${name}%`));
    }
    if (gender) {
      conditions.push(eq(students.gender, gender));
    }
    if (class_name) {
      conditions.push(like(students.class_name, `%${class_name}%`));
    }
    if (enrollment_status) {
      conditions.push(eq(students.enrollment_status, enrollment_status));
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

    return rows[0]!;
  }

  async create(dto: CreateStudentDto, userId?: string): Promise<Students> {
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

    const rows = await this.db
      .insert(students)
      .values({
        ownerId: userId,
        student_no: dto.student_no,
        name: dto.name,
        gender: dto.gender,
        birth_date: dto.birth_date ? new Date(dto.birth_date) : null,
        class_name: dto.class_name,
        phone: dto.phone,
        email: dto.email,
        enrollment_status: dto.enrollment_status,
        address: dto.address,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateStudentDto): Promise<Students> {
    const existing = await this.findOne(id);

    if (dto.student_no && dto.student_no !== existing.student_no) {
      const student_noConflict = await this.db
        .select()
        .from(students)
        .where(and(eq(students.student_no, dto.student_no), isNull(students.deletedAt)))
        .limit(1);

      if (student_noConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `StudentNo '${dto.student_no}' is already taken`,
        });
      }
    }

    type StudentUpdateFields = {
      student_no?: string;
      name?: string;
      gender?: string;
      birth_date?: Date;
      class_name?: string;
      phone?: string;
      email?: string;
      enrollment_status?: string;
      address?: string;
      updatedAt?: Date;
    };

    const updateData: StudentUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.student_no !== undefined) updateData.student_no = dto.student_no;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.gender !== undefined) updateData.gender = dto.gender;
    if (dto.birth_date !== undefined) updateData.birth_date = dto.birth_date ? new Date(dto.birth_date) : undefined;
    if (dto.class_name !== undefined) updateData.class_name = dto.class_name;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.enrollment_status !== undefined) updateData.enrollment_status = dto.enrollment_status;
    if (dto.address !== undefined) updateData.address = dto.address;

    const rows = await this.db
      .update(students)
      .set(updateData)
      .where(and(eq(students.id, id), isNull(students.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(students)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(students.id, id), isNull(students.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(students)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(students.id, ids), isNull(students.deletedAt)))
      .returning({ id: students.id });

    return { count: rows.length };
  }

}
