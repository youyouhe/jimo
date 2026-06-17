import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { companies, Companies } from '../../db/schema/companies';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class CompanyService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryCompanyDto): Promise<PaginatedData<Companies>> {
    const { page, pageSize, name, short_name, credit_code, status } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(companies.deletedAt)];

    if (name) {
      conditions.push(like(companies.name, `%${name}%`));
    }
    if (short_name) {
      conditions.push(like(companies.short_name, `%${short_name}%`));
    }
    if (credit_code) {
      conditions.push(like(companies.credit_code, `%${credit_code}%`));
    }
    if (status) {
      conditions.push(eq(companies.status, status));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(companies)
        .where(whereClause)
        .orderBy(desc(companies.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(companies)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Companies> {
    const rows = await this.db
      .select()
      .from(companies)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Company with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateCompanyDto): Promise<Companies> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(companies)
      .where(and(eq(companies.name, dto.name), isNull(companies.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }
    // Check unique: credit_code (only if value provided)
    if (dto.credit_code) {
      const existingByCreditCode = await this.db
        .select()
        .from(companies)
        .where(and(eq(companies.credit_code, dto.credit_code!), isNull(companies.deletedAt)))
        .limit(1);

      if (existingByCreditCode.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `CreditCode '${dto.credit_code}' is already taken`,
        });
      }
    }

    const rows = await this.db
      .insert(companies)
      .values({
        name: dto.name,
        short_name: dto.short_name,
        logo: dto.logo,
        credit_code: dto.credit_code,
        address: dto.address,
        phone: dto.phone,
        email: dto.email,
        website: dto.website,
        description: dto.description,
        established_date: dto.established_date ? new Date(dto.established_date) : null,
        status: dto.status,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Companies> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(companies)
        .where(and(eq(companies.name, dto.name), isNull(companies.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }
    if (dto.credit_code && dto.credit_code !== existing.credit_code) {
      const credit_codeConflict = await this.db
        .select()
        .from(companies)
        .where(and(eq(companies.credit_code, dto.credit_code), isNull(companies.deletedAt)))
        .limit(1);

      if (credit_codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `CreditCode '${dto.credit_code}' is already taken`,
        });
      }
    }

    type CompanyUpdateFields = {
      name?: string;
      short_name?: string;
      logo?: string;
      credit_code?: string;
      address?: string;
      phone?: string;
      email?: string;
      website?: string;
      description?: string;
      established_date?: Date;
      status?: string;
      updatedAt?: Date;
    };

    const updateData: CompanyUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.short_name !== undefined) updateData.short_name = dto.short_name;
    if (dto.logo !== undefined) updateData.logo = dto.logo;
    if (dto.credit_code !== undefined) updateData.credit_code = dto.credit_code;
    if (dto.address !== undefined) updateData.address = dto.address;
    if (dto.phone !== undefined) updateData.phone = dto.phone;
    if (dto.email !== undefined) updateData.email = dto.email;
    if (dto.website !== undefined) updateData.website = dto.website;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.established_date !== undefined) updateData.established_date = dto.established_date ? new Date(dto.established_date) : undefined;
    if (dto.status !== undefined) updateData.status = dto.status;

    const rows = await this.db
      .update(companies)
      .set(updateData)
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)))
      .returning();


    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);


    await this.db
      .update(companies)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(companies.id, id), isNull(companies.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {

    const rows = await this.db
      .update(companies)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(companies.id, ids), isNull(companies.deletedAt)))
      .returning({ id: companies.id });

    return { count: rows.length };
  }

}
