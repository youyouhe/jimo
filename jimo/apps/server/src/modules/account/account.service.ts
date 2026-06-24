import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { OwnershipHelper } from '../../common/ownership/ownership.helper';
import { accounts, Accounts } from '../../db/schema/accounts';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { ApiErrorCode, PaginatedData } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class AccountService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly ownershipHelper: OwnershipHelper,
  ) {}

  async findAll(query: QueryAccountDto, userId?: string, isAdmin: boolean = false): Promise<PaginatedData<Accounts>> {
    const { page, pageSize, code, name, account_type } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(accounts.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(accounts.ownerId, accounts.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);

    if (code) {
      conditions.push(like(accounts.code, `%${code}%`));
    }
    if (name) {
      conditions.push(like(accounts.name, `%${name}%`));
    }
    if (account_type) {
      conditions.push(eq(accounts.account_type, account_type));
    }

    const whereClause = and(...conditions);
    const parent_alias = alias(accounts, 'parent_alias');

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(accounts),
      parent_account_display: parent_alias.name,
        })
        .from(accounts)
        .leftJoin(parent_alias, eq(accounts.parent_account, parent_alias.id))
        .where(whereClause)
        .orderBy(desc(accounts.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(accounts)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string, userId?: string, isAdmin: boolean = false): Promise<Accounts> {
    const conditions = [eq(accounts.id, id), isNull(accounts.deletedAt)];
    const _ownership = this.ownershipHelper.visibleCondition(accounts.ownerId, accounts.sharedWith, userId, isAdmin, 'private');
    if (_ownership) conditions.push(_ownership);
    const parent_alias = alias(accounts, 'parent_alias');
    const rows = await this.db
      .select({
        ...getTableColumns(accounts),
      parent_account_display: parent_alias.name,
      })
      .from(accounts)
        .leftJoin(parent_alias, eq(accounts.parent_account, parent_alias.id))
      .where(and(...conditions))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Account with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateAccountDto, userId?: string): Promise<Accounts> {
    // Check unique: code
    const existingByCode = await this.db
      .select()
      .from(accounts)
      .where(and(eq(accounts.code, dto.code), isNull(accounts.deletedAt)))
      .limit(1);

    if (existingByCode.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Code '${dto.code}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(accounts)
      .values({
        ownerId: userId,
        code: dto.code,
        name: dto.name,
        account_type: dto.account_type,
        balance_direction: dto.balance_direction,
        parent_account: dto.parent_account,
        is_active: dto.is_active,
        remark: dto.remark,
      })
      .returning();
    return rows[0]!;

  }

  async update(id: string, dto: UpdateAccountDto, userId?: string, isAdmin: boolean = false): Promise<Accounts> {
    const existing = await this.findOne(id, userId, isAdmin);

    if (dto.code && dto.code !== existing.code) {
      const codeConflict = await this.db
        .select()
        .from(accounts)
        .where(and(eq(accounts.code, dto.code), isNull(accounts.deletedAt)))
        .limit(1);

      if (codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Code '${dto.code}' is already taken`,
        });
      }
    }

    type AccountUpdateFields = {
      code?: string;
      name?: string;
      account_type?: string;
      balance_direction?: string;
      parent_account?: string;
      is_active?: boolean;
      remark?: string;
      updatedAt?: Date;
    };

    const updateData: AccountUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.account_type !== undefined) updateData.account_type = dto.account_type;
    if (dto.balance_direction !== undefined) updateData.balance_direction = dto.balance_direction;
    if (dto.parent_account !== undefined) updateData.parent_account = dto.parent_account ?? undefined;
    if (dto.is_active !== undefined) updateData.is_active = dto.is_active;
    if (dto.remark !== undefined) updateData.remark = dto.remark;

    const rows = await this.db
      .update(accounts)
      .set(updateData)
      .where(
        isAdmin
          ? and(eq(accounts.id, id), isNull(accounts.deletedAt))
          : and(eq(accounts.id, id), isNull(accounts.deletedAt), eq(accounts.ownerId, userId!)),
      )
      .returning();


    return rows[0]!;
  }

  async remove(id: string, userId?: string, isAdmin: boolean = false): Promise<void> {
    await this.findOne(id, userId, isAdmin);


    await this.db
      .update(accounts)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(eq(accounts.id, id), isNull(accounts.deletedAt))
          : and(eq(accounts.id, id), isNull(accounts.deletedAt), eq(accounts.ownerId, userId!)),
      );
  }

  async batchRemove(ids: string[], userId?: string, isAdmin: boolean = false): Promise<{ count: number }> {

    const rows = await this.db
      .update(accounts)
      .set({ deletedAt: sql`NOW()` })
      .where(
        isAdmin
          ? and(inArray(accounts.id, ids), isNull(accounts.deletedAt))
          : and(inArray(accounts.id, ids), isNull(accounts.deletedAt), eq(accounts.ownerId, userId!)),
      )
      .returning({ id: accounts.id });

    return { count: rows.length };
  }

}
