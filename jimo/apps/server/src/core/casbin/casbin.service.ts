import { Injectable, Inject, OnModuleInit, Logger } from '@nestjs/common';
import { newEnforcer, newModelFromString, Enforcer } from 'casbin';
import { eq, isNull, and, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { sysUserRoles } from '../../db/schema/user-roles';
import { sysRoles } from '../../db/schema/roles';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysMenus } from '../../db/schema/menus';
import { sysApis } from '../../db/schema/apis';
import { RoleCode } from '@jimo/shared';
import { ICasbinService } from '../../modules/role/role.service';

const MODEL_TEXT = `
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && keyMatch2(r.obj, p.obj) && keyMatch2(r.act, p.act)
`;

@Injectable()
export class CasbinService implements ICasbinService, OnModuleInit {
  private readonly logger = new Logger(CasbinService.name);
  private enforcer!: Enforcer;

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async onModuleInit(): Promise<void> {
    const model = newModelFromString(MODEL_TEXT.trim());
    // newEnforcer without adapter uses in-memory only (no loadPolicy call)
    this.enforcer = await newEnforcer(model);
    await this.loadPolicies();
    this.logger.log('CasbinService initialized with in-memory policies');
  }

  /**
   * Load all policies from DB into the in-memory enforcer.
   * Clears existing policies before loading.
   */
  async loadPolicies(): Promise<void> {
    await this.enforcer.clearPolicy();

    // Add default role-based permission policies
    await this.addDefaultPolicies();

    // Restore dynamic role→API policies from sys_apis + sys_role_menus
    await this.loadRoleApiPolicies();

    // Load user-role assignments from DB
    await this.loadUserRoleAssignments();

    this.logger.log('Casbin policies loaded');
  }

  /**
   * Reload role assignments for a single user (called after assignRoles).
   * Does not touch permission policies, only updates g (role-for-user) rules.
   */
  async reloadPoliciesForUser(userId: string): Promise<void> {
    await this.enforcer.deleteRolesForUser(userId);

    const rows = await this.db
      .select({ code: sysRoles.code })
      .from(sysUserRoles)
      .innerJoin(sysRoles, eq(sysUserRoles.roleId, sysRoles.id))
      .where(and(eq(sysUserRoles.userId, userId), isNull(sysRoles.deletedAt)));

    await Promise.all(
      rows.map(row => this.enforcer.addRoleForUser(userId, row.code)),
    );

    this.logger.debug(`Reloaded roles for user ${userId}`);
  }

  /**
   * Check if a user has a specific role (via role inheritance).
   */
  async hasRoleForUser(userId: string, roleCode: string): Promise<boolean> {
    return this.enforcer.hasRoleForUser(userId, roleCode);
  }

  /**
   * Add a policy rule to Casbin.
   */
  async addPolicy(sub: string, obj: string, act: string): Promise<void> {
    await this.enforcer.addPolicy(sub, obj, act);
  }

  /**
   * Remove policies matching the given field values.
   * fieldIndex: 0=sub, 1=obj, 2=act.
   */
  async removeFilteredPolicy(fieldIndex: number, ...values: string[]): Promise<void> {
    await this.enforcer.removeFilteredPolicy(fieldIndex, ...values);
  }

  /**
   * Check if a subject can perform an action on a resource.
   */
  async enforce(userId: string, resource: string, action: string): Promise<boolean> {
    return this.enforcer.enforce(userId, resource, action);
  }

  private async addDefaultPolicies(): Promise<void> {
    // super_admin: full access to everything via wildcard
    await this.enforcer.addPolicy(RoleCode.SUPER_ADMIN, '*', '*');

    // admin: full access to system modules (full API paths for AuthzGuard)
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/users', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/users/:id', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/roles', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/roles/:id', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/menus', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/menus/:id', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/dictionary', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/dictionary/:id', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/dictionary/detail', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/apis', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/authority-btns', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/files', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/autocode', '*');

    // admin: encoding rules full access
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/encoding-rules', '*');
    await this.enforcer.addPolicy(RoleCode.ADMIN, '/api/v1/encoding-rules/:id', '*');

    // editor: read users and menus
    await this.enforcer.addPolicy(RoleCode.EDITOR, '/api/v1/users', 'GET');
    await this.enforcer.addPolicy(RoleCode.EDITOR, '/api/v1/menus', 'GET');
    // editor: read encoding rules
    await this.enforcer.addPolicy(RoleCode.EDITOR, '/api/v1/encoding-rules', 'GET');
    await this.enforcer.addPolicy(RoleCode.EDITOR, '/api/v1/encoding-rules/:id', 'GET');

    // viewer: read menus only
    await this.enforcer.addPolicy(RoleCode.VIEWER, '/api/v1/menus', 'GET');
    // viewer: read encoding rules
    await this.enforcer.addPolicy(RoleCode.VIEWER, '/api/v1/encoding-rules', 'GET');
    await this.enforcer.addPolicy(RoleCode.VIEWER, '/api/v1/encoding-rules/:id', 'GET');

    // All authenticated roles: system endpoints needed for UI rendering
    for (const role of [RoleCode.ADMIN, RoleCode.EDITOR, RoleCode.VIEWER]) {
      await this.enforcer.addPolicy(role, '/api/v1/authority-btns/my', 'GET');
      await this.enforcer.addPolicy(role, '/api/v1/menus/accessible', 'GET');
      await this.enforcer.addPolicy(role, '/api/v1/menus/:id', 'GET');
      // Profile & password — every authenticated user needs these
      await this.enforcer.addPolicy(role, '/api/v1/users/profile', 'GET');
      await this.enforcer.addPolicy(role, '/api/v1/users/profile', 'PATCH');
      await this.enforcer.addPolicy(role, '/api/v1/users/change-password', 'POST');
    }

    // Generated business tables + approval/ownership APIs: all authenticated roles.
    // Row-level ownership (OwnershipHelper) still applies — API access ≠ data access.
    for (const role of [RoleCode.ADMIN, RoleCode.EDITOR, RoleCode.VIEWER]) {
      await this.enforcer.addPolicy(role, '/api/v1/lc/*', '*');
      await this.enforcer.addPolicy(role, '/api/v1/approvals/*', '*');
      await this.enforcer.addPolicy(role, '/api/v1/ownership/*', '*');
      await this.enforcer.addPolicy(role, '/api/v1/departments/*', '*');
    }

    // Role inheritance: super_admin inherits all admin policies
    await this.enforcer.addRoleForUser(RoleCode.SUPER_ADMIN, RoleCode.ADMIN);
  }

  /** Restore dynamic role-API policies from DB on startup */
  async loadRoleApiPolicies(): Promise<void> {
    const [allRoles, allApis] = await Promise.all([
      this.db
        .select({ code: sysRoles.code, id: sysRoles.id })
        .from(sysRoles)
        .where(isNull(sysRoles.deletedAt)),
      this.db
        .select()
        .from(sysApis)
        .where(isNull(sysApis.deletedAt)),
    ]);

    if (allApis.length === 0) return;

    for (const role of allRoles) {
      // super_admin has wildcard, skip
      if (role.code === RoleCode.SUPER_ADMIN) continue;

      // Get permission keys from this role's menus
      const roleMenuRows = await this.db
        .select({ permission: sysMenus.permission })
        .from(sysRoleMenus)
        .innerJoin(sysMenus, eq(sysRoleMenus.menuId, sysMenus.id))
        .where(
          and(
            eq(sysRoleMenus.roleId, role.id),
            isNull(sysMenus.deletedAt),
          ),
        );

      const permissionKeys = roleMenuRows
        .map((r) => r.permission)
        .filter((p): p is string => !!p);

      if (permissionKeys.length === 0) continue;

      const added = new Set<string>();
      for (const api of allApis) {
        const matched = permissionKeys.some((key) => {
          if (api.permission === key) return true;
          if (api.permission && api.permission.startsWith(key + ':')) return true;
          if (key.endsWith(':*') && api.permission && api.permission.startsWith(key.slice(0, -2))) return true;
          return false;
        });

        if (matched) {
          const dedup = `${role.code}|${api.path}|${api.method}`;
          if (!added.has(dedup)) {
            added.add(dedup);
            await this.enforcer.addPolicy(role.code, api.path, api.method);
          }
        }
      }
    }

    this.logger.log(`Restored dynamic policies for ${allRoles.length} roles`);
  }

  private async loadUserRoleAssignments(): Promise<void> {
    const rows = await this.db
      .select({
        userId: sysUserRoles.userId,
        code: sysRoles.code,
      })
      .from(sysUserRoles)
      .innerJoin(sysRoles, eq(sysUserRoles.roleId, sysRoles.id))
      .where(isNull(sysRoles.deletedAt));

    await Promise.all(
      rows.map(row => this.enforcer.addRoleForUser(row.userId, row.code)),
    );
  }
}
