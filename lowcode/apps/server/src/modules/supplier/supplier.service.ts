import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { suppliers, Suppliers } from '../../db/schema/suppliers';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class SupplierService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QuerySupplierDto): Promise<PaginatedData<Suppliers>> {
    const { page, pageSize, name, contact_person, phone } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(suppliers.deletedAt)];

    if (name) {
      conditions.push(like(suppliers.name, `%${name}%`));
    }
    if (contact_person) {
      conditions.push(like(suppliers.contact_person, `%${contact_person}%`));
    }
    if (phone) {
      conditions.push(like(suppliers.phone, `%${phone}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(suppliers)
        .where(whereClause)
        .orderBy(desc(suppliers.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(suppliers)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Suppliers> {
    const rows = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Supplier with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateSupplierDto): Promise<Suppliers> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.name, dto.name), isNull(suppliers.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(suppliers)
      .values({
        name: dto.name,
        contact_person: dto.contact_person,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        is_active: dto.is_active,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateSupplierDto): Promise<Suppliers> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(suppliers)
        .where(and(eq(suppliers.name, dto.name), isNull(suppliers.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }

    type SupplierUpdateFields = {
      name?: string;
      contact_person?: string;
      phone?: string;
      email?: string;
      address?: string;
      is_active?: boolean;
      updatedAt?: Date;
    };

    const updateData: SupplierUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.contact_person !== undefined) updateData.contact_person = dto.contact_person;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;

    const rows = await this.db
      .update(suppliers)
      .set(updateData)
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(suppliers)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(suppliers.id, id), isNull(suppliers.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(suppliers)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(suppliers.id, ids), isNull(suppliers.deletedAt)))
      .returning({ id: suppliers.id });

    return { count: rows.length };
  }

}
