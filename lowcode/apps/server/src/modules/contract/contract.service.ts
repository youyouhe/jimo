import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { contract, Contract } from '../../db/schema/contract';
import { contractDetail } from '../../db/schema/contract';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { QueryContractDto } from './dto/query-contract.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class ContractService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryContractDto): Promise<PaginatedData<Contract>> {
    const { page, pageSize, name } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(contract.deletedAt)];

    if (name) {
      conditions.push(like(contract.name, `%${name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(contract)
        .where(whereClause)
        .orderBy(desc(contract.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(contract)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const detailRows = await this.db
        .select()
        .from(contractDetail)
        .where(and(inArray(contractDetail.contract_id, masterIds), isNull(contractDetail.deletedAt)));
      const detailByMaster = new Map<string, any[]>();
      for (const row of detailRows) {
        if (row.contract_id == null) continue;
        const arr = detailByMaster.get(row.contract_id) || [];
        arr.push(row);
        detailByMaster.set(row.contract_id, arr);
      }
      for (const row of rows) {
        (row as any).detail = detailByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Contract> {
    const rows = await this.db
      .select()
      .from(contract)
      .where(and(eq(contract.id, id), isNull(contract.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Contract with id ${id} not found`,
      });
    }
    (rows[0] as any).detail = await this.getDetail(id);
    return rows[0]!;
  }

  async create(dto: CreateContractDto): Promise<Contract> {

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(contract)
        .values({
          name: dto.name,
        })
        .returning();
      const created = rows[0]!;
      if (dto.detail && (dto.detail as any[]).length > 0) {
        await tx.insert(contractDetail).values(
          (dto.detail as any[]).map((d: any) => ({
            contract_id: created.id,
            name: d.name,
            price: String(d.price),
            memo: d.memo,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdateContractDto): Promise<Contract> {
    const existing = await this.findOne(id);


    type ContractUpdateFields = {
      name?: string;
      updatedAt?: Date;
    };

    const updateData: ContractUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;

    const rows = await this.db
      .update(contract)
      .set(updateData)
      .where(and(eq(contract.id, id), isNull(contract.deletedAt)))
      .returning();

    if (dto.detail !== undefined) {
      await this.updateDetail(id, dto.detail as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removeDetail(id);

    await this.db
      .update(contract)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(contract.id, id), isNull(contract.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removeDetail(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(contract)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(contract.id, ids), isNull(contract.deletedAt)))
      .returning({ id: contract.id });

    return { count: rows.length };
  }

  async getDetail(contract_id: string): Promise<any[]> {
    return this.db
      .select()
      .from(contractDetail)
      .where(and(eq(contractDetail.contract_id, contract_id), isNull(contractDetail.deletedAt)));
  }

  async createDetail(contract_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      contract_id,
      name: d.name,
      price: String(d.price),
      memo: d.memo,
    }));
    await this.db.insert(contractDetail).values(values);
  }

  async updateDetail(contract_id: string, details: any[]): Promise<void> {
    const existing = await this.getDetail(contract_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {
      await this.db
        .update(contractDetail)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(contractDetail.id, toDelete.map((r) => r.id)), isNull(contractDetail.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(contractDetail)
        .set({
          name: d.name,
          price: String(d.price),
          memo: d.memo,
          updatedAt: sql`NOW()`,
        })
        .where(eq(contractDetail.id, d.id));
    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createDetail(contract_id, newRows);
    }
  }

  async removeDetail(contract_id: string): Promise<void> {
    await this.db
      .update(contractDetail)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(contractDetail.contract_id, contract_id), isNull(contractDetail.deletedAt)));
  }

}
