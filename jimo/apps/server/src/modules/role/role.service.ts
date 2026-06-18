import {
  Injectable,
  Inject,
  Optional,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { eq, and, isNull, like, sql, count, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysRoles, SysRole } from '../../db/schema/roles';
import { sysMenus } from '../../db/schema/menus';
import { sysUserRoles } from '../../db/schema/user-roles';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysApis } from '../../db/schema/apis';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { ApiErrorCode, PaginatedData, RoleCode } from '@jimo/shared';
import { SQL } from 'drizzle-orm';

export const CASBIN_SERVICE_TOKEN = 'CASBIN_SERVICE';

export interface ICasbinService {
  reloadPoliciesForUser(userId: string): Promise<void>;
  hasRoleForUser(userId: string, roleCode: string): Promise<boolean>;
  addPolicy(sub: string, obj: string, act: string): Promise<void>;
  removeFilteredPolicy(fieldIndex: number, ...values: string[]): Promise<void>;
  enforce(userId: string, resource: string, action: string): Promise<boolean>;
  loadRoleApiPolicies(): Promise<void>;
}

@Injectable()
export class RoleService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Optional() @Inject(CASBIN_SERVICE_TOKEN) private readonly casbinService: ICasbinService | null,
  ) {}

  async findAll(query: QueryRoleDto): Promise<PaginatedData<SysRole>> {
    const { page, pageSize, name, code } = query;
    const offset = (page - 1) * pageSize;

    const conditions: SQL[] = [isNull(sysRoles.deletedAt)];

    if (name) {
      conditions.push(like(sysRoles.name, `%${name}%`));
    }
    if (code) {
      conditions.push(like(sysRoles.code, `%${code}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysRoles)
        .where(whereClause)
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysRoles)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async findOne(id: string): Promise<SysRole> {
    const rows = await this.db
      .select()
      .from(sysRoles)
      .where(and(eq(sysRoles.id, id), isNull(sysRoles.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Role with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async findByCode(code: string): Promise<SysRole | null> {
    const rows = await this.db
      .select()
      .from(sysRoles)
      .where(and(eq(sysRoles.code, code), isNull(sysRoles.deletedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  async create(dto: CreateRoleDto): Promise<SysRole> {
    const existing = await this.findByCode(dto.code);
    if (existing) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Role code '${dto.code}' is already taken`,
      });
    }

    const rows = await this.db
      .insert(sysRoles)
      .values({
        name: dto.name,
        code: dto.code,
        description: dto.description,
        isDefault: dto.is_default !== undefined ? (dto.is_default as 0 | 1) : 0,
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateRoleDto): Promise<SysRole> {
    const existing = await this.findOne(id);

    if (dto.code && dto.code !== existing.code) {
      const codeConflict = await this.findByCode(dto.code);
      if (codeConflict) {
        throw new ConflictException({
          code: ApiErrorCode.PARAM_ERROR,
          message: `Role code '${dto.code}' is already taken`,
        });
      }
    }

    type RoleUpdateFields = {
      name?: string;
      code?: string;
      description?: string | null;
      isDefault?: 0 | 1;
      updatedAt?: Date;
    };

    const updateData: RoleUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.code !== undefined) updateData.code = dto.code;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.is_default !== undefined) updateData.isDefault = dto.is_default as 0 | 1;

    const rows = await this.db
      .update(sysRoles)
      .set(updateData)
      .where(and(eq(sysRoles.id, id), isNull(sysRoles.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysRoles)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysRoles.id, id), isNull(sysRoles.deletedAt)));
  }

  async assignRoles(dto: AssignRolesDto, callerRole: string): Promise<void> {
    const { userId, roleIds } = dto;

    // Validate all roleIds exist and are not soft-deleted
    if (roleIds.length > 0) {
      const resolvedRoles = await this.db
        .select({ id: sysRoles.id, code: sysRoles.code })
        .from(sysRoles)
        .where(and(inArray(sysRoles.id, roleIds), isNull(sysRoles.deletedAt)));

      if (resolvedRoles.length !== roleIds.length) {
        throw new BadRequestException({
          code: ApiErrorCode.PARAM_ERROR,
          message: 'One or more roleIds are invalid or have been deleted',
        });
      }

      // Privilege check: only super_admin may assign the super_admin role
      if (callerRole !== RoleCode.SUPER_ADMIN) {
        const attemptsSuperAdmin = resolvedRoles.some(
          (r) => r.code === RoleCode.SUPER_ADMIN,
        );
        if (attemptsSuperAdmin) {
          throw new ForbiddenException({
            code: ApiErrorCode.PERMISSION_DENIED,
            message: 'Only super_admin can assign the super_admin role',
          });
        }
      }
    }

    // Atomic delete + insert in a single transaction
    await this.db.transaction(async (tx) => {
      await tx
        .delete(sysUserRoles)
        .where(eq(sysUserRoles.userId, userId));

      if (roleIds.length > 0) {
        await tx
          .insert(sysUserRoles)
          .values(roleIds.map((roleId) => ({ userId, roleId })));
      }
    });

    // Reload Casbin AFTER transaction commits so it reads committed rows
    if (this.casbinService) {
      await this.casbinService.reloadPoliciesForUser(userId);
    }
  }

  /**
   * Get all menu IDs assigned to a role.
   */
  async getRoleMenuIds(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ menuId: sysRoleMenus.menuId })
      .from(sysRoleMenus)
      .where(eq(sysRoleMenus.roleId, roleId));

    return rows.map((r) => r.menuId);
  }

  /**
   * Full replacement: set the menus assigned to a role and sync Casbin policies.
   */
  async setRoleMenus(roleId: string, menuIds: string[]): Promise<void> {
    // Validate role exists
    await this.findOne(roleId);

    await this.db.transaction(async (tx) => {
      // Delete existing role-menu associations
      await tx
        .delete(sysRoleMenus)
        .where(eq(sysRoleMenus.roleId, roleId));

      // Insert new associations (deduped)
      if (menuIds.length > 0) {
        const uniqueIds = [...new Set(menuIds)];
        await tx
          .insert(sysRoleMenus)
          .values(uniqueIds.map((menuId) => ({ roleId, menuId })));
      }
    });

    // Sync Casbin policies for this role based on its menus
    try {
      await this.syncCasbinForRole(roleId);
    } catch (err: any) {
      // Log but don't fail the request — DB state is already correct
      console.error('[setRoleMenus] Casbin sync failed:', err.message);
    }
  }

  /**
   * Build a list of Casbin policies for a role based on its assigned menus
   * and registered APIs, then replace all existing policies for that role.
   */
  private async syncCasbinForRole(roleId: string): Promise<void> {
    if (!this.casbinService) return;

    // Get the role
    const role = await this.findOne(roleId);

    // 1) Remove all existing policies for this role (by roleId as subject)
    await this.casbinService.removeFilteredPolicy(0, role.code);

    // 2) Collect menu permission keys assigned to this role
    const roleMenuRows = await this.db
      .select({
        menuId: sysRoleMenus.menuId,
        permission: sysMenus.permission,
      })
      .from(sysRoleMenus)
      .innerJoin(sysMenus, eq(sysRoleMenus.menuId, sysMenus.id))
      .where(
        and(
          eq(sysRoleMenus.roleId, roleId),
          isNull(sysMenus.deletedAt),
        ),
      );

    const permissionKeys = roleMenuRows
      .map((r) => r.permission)
      .filter((p): p is string => !!p);

    // 3) Map permission keys to API paths in sys_apis
    // A permission key like "system:user:list" matches APIs whose permission matches.
    // Also grant wildcard for directories: any permission prefix grants all child APIs.
    const apiRows = await this.db
      .select()
      .from(sysApis)
      .where(isNull(sysApis.deletedAt));

    const policies: Array<{ sub: string; obj: string; act: string }> = [];

    for (const api of apiRows) {
      const apiPermission = api.permission;

      // Grant access if the API's permission matches (or is a child of) any assigned menu permission
      const hasAccess = permissionKeys.some((key) => {
        // Exact match
        if (apiPermission === key) return true;
        // Prefix match: "system:user" grants access to "system:user:*"
        if (apiPermission && apiPermission.startsWith(key + ':')) return true;
        // Wildcard match: if role has "system:*" it covers all "system:*" APIs
        if (key.endsWith(':*') && apiPermission && apiPermission.startsWith(key.slice(0, -2))) return true;
        return false;
      });

      if (hasAccess) {
        policies.push({
          sub: role.code,
          obj: api.path,
          act: api.method.toUpperCase(),
        });
      }
    }

    // 4) Always grant access to essential endpoints
    const essentialPolicies = [
      { sub: role.code, obj: '/api/v1/auth/login', act: 'POST' },
      { sub: role.code, obj: '/api/v1/auth/logout', act: 'POST' },
      { sub: role.code, obj: '/api/v1/auth/refresh', act: 'POST' },
      { sub: role.code, obj: '/api/v1/auth/me', act: 'GET' },
      { sub: role.code, obj: '/api/v1/menus/accessible', act: 'GET' },
    ];
    for (const ep of essentialPolicies) {
      policies.push(ep);
    }

    // 5) Add all policies
    const added = new Set<string>();
    for (const p of policies) {
      const key = `${p.sub}|${p.obj}|${p.act}`;
      if (!added.has(key)) {
        added.add(key);
        await this.casbinService.addPolicy(p.sub, p.obj, p.act);
      }
    }
  }

  /**
   * Get all role-menu IDs for users sync.
   */
  async getAllRoleMenuIds(): Promise<Map<string, Set<string>>> {
    const rows = await this.db
      .select()
      .from(sysRoleMenus);

    const map = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!map.has(row.roleId)) map.set(row.roleId, new Set());
      map.get(row.roleId)!.add(row.menuId);
    }
    return map;
  }

  async getRolesForUser(userId: string): Promise<SysRole[]> {
    const userRoleRows = await this.db
      .select({ roleId: sysUserRoles.roleId })
      .from(sysUserRoles)
      .where(eq(sysUserRoles.userId, userId));

    if (userRoleRows.length === 0) {
      return [];
    }

    const roleIds = userRoleRows.map((r) => r.roleId);

    const roles = await this.db
      .select()
      .from(sysRoles)
      .where(and(inArray(sysRoles.id, roleIds), isNull(sysRoles.deletedAt)));

    return roles;
  }
}
