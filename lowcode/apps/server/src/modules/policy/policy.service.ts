import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray, gte, lte, desc, getTableColumns } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { policies, Policies } from '../../db/schema/policies';
import { departments } from '../../db/schema/departments';
import { policyPolicyDetail } from '../../db/schema/policies';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { QueryPolicyDto } from './dto/query-policy.dto';
import { ApiErrorCode, PaginatedData } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

@Injectable()
export class PolicyService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryPolicyDto): Promise<PaginatedData<Policies>> {
    const { page, pageSize, name, policy_code, policy_type, status, department_id } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(policies.deletedAt)];

    if (name) {
      conditions.push(like(policies.name, `%${name}%`));
    }
    if (policy_code) {
      conditions.push(like(policies.policy_code, `%${policy_code}%`));
    }
    if (policy_type) {
      conditions.push(eq(policies.policy_type, policy_type));
    }
    if (status) {
      conditions.push(eq(policies.status, status));
    }
    if (department_id) {
      conditions.push(eq(policies.department_id, department_id));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          ...getTableColumns(policies),
      department_id_display: departments.name,
        })
        .from(policies)
        .leftJoin(departments, eq(policies.department_id, departments.id))
        .where(whereClause)
        .orderBy(desc(policies.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(policies)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    // Batch-attach child detail rows
    if (rows.length > 0) {
      const masterIds = rows.map((r) => r.id);
      const policy_detailsRows = await this.db
        .select()
        .from(policyPolicyDetail)
        .where(and(inArray(policyPolicyDetail.policy_id, masterIds), isNull(policyPolicyDetail.deletedAt)));
      const policy_detailsByMaster = new Map<string, any[]>();
      for (const row of policy_detailsRows) {
        if (row.policy_id == null) continue;
        const arr = policy_detailsByMaster.get(row.policy_id) || [];
        arr.push(row);
        policy_detailsByMaster.set(row.policy_id, arr);
      }
      for (const row of rows) {
        (row as any).policy_details = policy_detailsByMaster.get(row.id) || [];
      }
    }

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<Policies> {
    const rows = await this.db
      .select({
        ...getTableColumns(policies),
      department_id_display: departments.name,
      })
      .from(policies)
        .leftJoin(departments, eq(policies.department_id, departments.id))
      .where(and(eq(policies.id, id), isNull(policies.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Policy with id ${id} not found`,
      });
    }
    (rows[0] as any).policy_details = await this.getPolicyDetails(id);
    return rows[0]!;
  }

  async create(dto: CreatePolicyDto): Promise<Policies> {
    // Check unique: name
    const existingByName = await this.db
      .select()
      .from(policies)
      .where(and(eq(policies.name, dto.name), isNull(policies.deletedAt)))
      .limit(1);

    if (existingByName.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Name '${dto.name}' is already taken`,
      });
    }
    // Check unique: policy_code (only if value provided)
    if (dto.policy_code) {
      const existingByPolicyCode = await this.db
        .select()
        .from(policies)
        .where(and(eq(policies.policy_code, dto.policy_code!), isNull(policies.deletedAt)))
        .limit(1);

      if (existingByPolicyCode.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `PolicyCode '${dto.policy_code}' is already taken`,
        });
      }
    }

    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(policies)
        .values({
          name: dto.name,
          policy_code: dto.policy_code,
          policy_type: dto.policy_type,
          version: dto.version,
          status: dto.status,
          department_id: dto.department_id,
          effective_date: dto.effective_date ? new Date(dto.effective_date) : null,
          expiration_date: dto.expiration_date ? new Date(dto.expiration_date) : null,
          description: dto.description,
        })
        .returning();
      const created = rows[0]!;
      if (dto.policy_details && (dto.policy_details as any[]).length > 0) {
        await tx.insert(policyPolicyDetail).values(
          (dto.policy_details as any[]).map((d: any) => ({
            policy_id: created.id,
            chapter_number: d.chapter_number,
            title: d.title,
            content: d.content,
            sort_order: d.sort_order,
          })),
        );
      }

      return created;
    });
  }

  async update(id: string, dto: UpdatePolicyDto): Promise<Policies> {
    const existing = await this.findOne(id);

    if (dto.name && dto.name !== existing.name) {
      const nameConflict = await this.db
        .select()
        .from(policies)
        .where(and(eq(policies.name, dto.name), isNull(policies.deletedAt)))
        .limit(1);

      if (nameConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Name '${dto.name}' is already taken`,
        });
      }
    }
    if (dto.policy_code && dto.policy_code !== existing.policy_code) {
      const policy_codeConflict = await this.db
        .select()
        .from(policies)
        .where(and(eq(policies.policy_code, dto.policy_code), isNull(policies.deletedAt)))
        .limit(1);

      if (policy_codeConflict.length > 0) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `PolicyCode '${dto.policy_code}' is already taken`,
        });
      }
    }

    type PolicyUpdateFields = {
      name?: string;
      policy_code?: string;
      policy_type?: string;
      version?: string;
      status?: string;
      department_id?: string;
      effective_date?: Date;
      expiration_date?: Date;
      description?: string;
      updatedAt?: Date;
    };

    const updateData: PolicyUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.policy_code !== undefined) updateData.policy_code = dto.policy_code;
    if (dto.policy_type !== undefined) updateData.policy_type = dto.policy_type;
    if (dto.version !== undefined) updateData.version = dto.version;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.department_id !== undefined) updateData.department_id = dto.department_id ?? undefined;
    if (dto.effective_date !== undefined) updateData.effective_date = dto.effective_date ? new Date(dto.effective_date) : undefined;
    if (dto.expiration_date !== undefined) updateData.expiration_date = dto.expiration_date ? new Date(dto.expiration_date) : undefined;
    if (dto.description !== undefined) updateData.description = dto.description;

    const rows = await this.db
      .update(policies)
      .set(updateData)
      .where(and(eq(policies.id, id), isNull(policies.deletedAt)))
      .returning();

    if (dto.policy_details !== undefined) {
      await this.updatePolicyDetails(id, dto.policy_details as any[]);
    }
    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.removePolicyDetails(id);

    await this.db
      .update(policies)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(policies.id, id), isNull(policies.deletedAt)));
  }

  async batchRemove(ids: string[]): Promise<{ count: number }> {
    // Remove child detail rows for each id
    for (const id of ids) {
      try {
        await this.removePolicyDetails(id);
      } catch {
        // Record may not exist, ignore
      }
    }

    const rows = await this.db
      .update(policies)
      .set({ deletedAt: sql`NOW()` })
      .where(and(inArray(policies.id, ids), isNull(policies.deletedAt)))
      .returning({ id: policies.id });

    return { count: rows.length };
  }

  async getPolicyDetails(policy_id: string): Promise<any[]> {
    const rows = await this.db
      .select()
      .from(policyPolicyDetail)
      .where(and(eq(policyPolicyDetail.policy_id, policy_id), isNull(policyPolicyDetail.deletedAt)));

    return rows;
  }

  async createPolicyDetails(policy_id: string, details: any[]): Promise<void> {
    if (details.length === 0) return;
    const values = details.map((d) => ({
      policy_id,
      chapter_number: d.chapter_number,
      title: d.title,
      content: d.content,
      sort_order: d.sort_order,
    }));
    const inserted = await this.db.insert(policyPolicyDetail).values(values).returning();

  }

  async updatePolicyDetails(policy_id: string, details: any[]): Promise<void> {
    const existing = await this.getPolicyDetails(policy_id);
    const existingIds = new Set(existing.map((r) => r.id));
    const incomingIds = new Set(details.filter((d) => d.id).map((d) => d.id));

    // Soft-delete rows no longer present
    const toDelete = existing.filter((r) => !incomingIds.has(r.id));
    if (toDelete.length > 0) {

      await this.db
        .update(policyPolicyDetail)
        .set({ deletedAt: sql`NOW()` })
        .where(and(inArray(policyPolicyDetail.id, toDelete.map((r) => r.id)), isNull(policyPolicyDetail.deletedAt)));
    }

    // Update existing rows
    for (const d of details.filter((d) => d.id && existingIds.has(d.id))) {
      await this.db
        .update(policyPolicyDetail)
        .set({
          chapter_number: d.chapter_number,
          title: d.title,
          content: d.content,
          sort_order: d.sort_order,
          updatedAt: sql`NOW()`,
        })
        .where(eq(policyPolicyDetail.id, d.id));

    }

    // Insert new rows (no id or temp id)
    const newRows = details.filter((d) => !d.id);
    if (newRows.length > 0) {
      await this.createPolicyDetails(policy_id, newRows);
    }
  }

  async removePolicyDetails(policy_id: string): Promise<void> {

    await this.db
      .update(policyPolicyDetail)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(policyPolicyDetail.policy_id, policy_id), isNull(policyPolicyDetail.deletedAt)));
  }

}
