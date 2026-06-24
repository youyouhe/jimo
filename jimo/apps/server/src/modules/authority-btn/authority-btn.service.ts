import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, inArray, sql, like } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  sysAuthorityBtns,
  SysAuthorityBtn,
  NewSysAuthorityBtn,
} from '../../db/schema/authority-btns';
import { CreateAuthorityBtnDto } from './dto/create-authority-btn.dto';
import { SetAuthorityBtnsDto } from './dto/set-authority-btns.dto';
import { ApiErrorCode, RoleCode } from '@jimo/shared';
import { sysUserRoles } from '../../db/schema/user-roles';
import { sysMenus, BtnConfig } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysRoles } from '../../db/schema/roles';

@Injectable()
export class AuthorityBtnService {
  private readonly logger = new Logger(AuthorityBtnService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  /**
   * Return { component -> { systemBtns, customBtns } } for the current user.
   * super_admin gets all buttons. Others get only buttons assigned via sys_role_menus.
   * Buttons with btn_config = NULL are system buttons (edit/delete/add/query/agent/batchDelete).
   * Buttons with btn_config set are custom navigate buttons.
   */
  async getMyBtnPerms(userId: string, userRoles: string[]): Promise<Record<string, BtnPermsEntry>> {
    let btnMenuRows: { btnName: string; parentId: string | null; btnConfig: BtnConfig | null }[];

    if (userRoles.includes(RoleCode.SUPER_ADMIN)) {
      btnMenuRows = await this.db
        .select({ btnName: sysMenus.name, parentId: sysMenus.parentId, btnConfig: sysMenus.btnConfig })
        .from(sysMenus)
        .where(and(eq(sysMenus.menuType, 3), isNull(sysMenus.deletedAt)));
    } else {
      const userRoleRows = await this.db
        .select({ roleId: sysUserRoles.roleId })
        .from(sysUserRoles)
        .where(eq(sysUserRoles.userId, userId));

      const roleIds = userRoleRows.map((r) => r.roleId);
      if (roleIds.length === 0) return {};

      btnMenuRows = await this.db
        .select({
          btnName: sysMenus.name,
          parentId: sysMenus.parentId,
          btnConfig: sysMenus.btnConfig,
        })
        .from(sysRoleMenus)
        .innerJoin(
          sysMenus,
          and(
            eq(sysMenus.id, sysRoleMenus.menuId),
            eq(sysMenus.menuType, 3),
            isNull(sysMenus.deletedAt),
          ),
        )
        .where(inArray(sysRoleMenus.roleId, roleIds));
    }

    if (btnMenuRows.length === 0) return {};

    const parentIds = [...new Set(btnMenuRows.map((r) => r.parentId).filter(Boolean))] as string[];
    if (parentIds.length === 0) return {};

    const parentRows = await this.db
      .select({ id: sysMenus.id, component: sysMenus.component })
      .from(sysMenus)
      .where(and(inArray(sysMenus.id, parentIds), isNull(sysMenus.deletedAt)));

    const parentMap = new Map(parentRows.map((p) => [p.id, p.component ?? '']));
    const result: Record<string, BtnPermsEntry> = {};

    for (const btn of btnMenuRows) {
      const comp = parentMap.get(btn.parentId ?? '') ?? '';
      if (!comp) continue;
      if (!result[comp]) result[comp] = { systemBtns: [], customBtns: [] };

      if (btn.btnConfig) {
        const already = result[comp].customBtns.find((c) => c.name === btn.btnName);
        if (!already) {
          result[comp].customBtns.push({
            name: btn.btnName,
            label: btn.btnConfig.label,
            actionType: btn.btnConfig.actionType,
            targetTable: btn.btnConfig.targetTable,
            sourceField: btn.btnConfig.sourceField,
          });
        }
      } else {
        if (!result[comp].systemBtns.includes(btn.btnName)) {
          result[comp].systemBtns.push(btn.btnName);
        }
      }
    }
    return result;
  }

  /** Find the page menu (menu_type=2) component path for a given lc table name. */
  private async findPageMenuByTable(tableName: string): Promise<{ id: string; component: string }> {
    const componentPattern = `%lc/${tableName}%`;
    const rows = await this.db
      .select({ id: sysMenus.id, component: sysMenus.component })
      .from(sysMenus)
      .where(
        and(
          eq(sysMenus.menuType, 2),
          like(sysMenus.component, componentPattern),
          isNull(sysMenus.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0 || !rows[0].component) {
      throw new NotFoundException(`No page menu found for table '${tableName}'`);
    }
    return { id: rows[0].id, component: rows[0].component };
  }

  /** List all buttons (system + custom) for a table, with their assigned role ids. */
  async listBtnPerms(tableName: string): Promise<BtnPermsDetail[]> {
    const parent = await this.findPageMenuByTable(tableName);

    const btns = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name, btnConfig: sysMenus.btnConfig })
      .from(sysMenus)
      .where(
        and(
          eq(sysMenus.parentId, parent.id),
          eq(sysMenus.menuType, 3),
          isNull(sysMenus.deletedAt),
        ),
      );

    if (btns.length === 0) return [];

    const btnIds = btns.map((b) => b.id);
    const assignments = await this.db
      .select({ menuId: sysRoleMenus.menuId, roleId: sysRoleMenus.roleId })
      .from(sysRoleMenus)
      .where(inArray(sysRoleMenus.menuId, btnIds));

    const roleMap = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!roleMap.has(a.menuId)) roleMap.set(a.menuId, new Set());
      roleMap.get(a.menuId)!.add(a.roleId);
    }

    return btns.map((b) => ({
      id: b.id,
      name: b.name,
      isCustom: b.btnConfig !== null,
      btnConfig: b.btnConfig ?? undefined,
      assignedRoleIds: [...(roleMap.get(b.id) ?? [])],
    }));
  }

  /** Create a custom navigate button for a table and assign it to the specified roles. */
  async createCustomBtn(dto: {
    tableName: string;
    btnName: string;
    label: string;
    targetTable: string;
    sourceField: string;
    roles: string[];
  }): Promise<{ id: string; name: string }> {
    const parent = await this.findPageMenuByTable(dto.tableName);

    // Check for name collision
    const existing = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(
        and(
          eq(sysMenus.parentId, parent.id),
          eq(sysMenus.menuType, 3),
          eq(sysMenus.name, dto.btnName),
          isNull(sysMenus.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException(`Button '${dto.btnName}' already exists on table '${dto.tableName}'`);
    }

    const btnConfig: BtnConfig = {
      label: dto.label,
      actionType: 'navigate',
      targetTable: dto.targetTable,
      sourceField: dto.sourceField,
    };

    const inserted = await this.db
      .insert(sysMenus)
      .values({
        name: dto.btnName,
        parentId: parent.id,
        menuType: 3,
        isVisible: 0,
        sort: 99,
        btnConfig,
      })
      .returning({ id: sysMenus.id, name: sysMenus.name });

    const newMenuId = inserted[0].id;

    // Resolve role codes to IDs
    if (dto.roles.length > 0) {
      const roleRows = await this.db
        .select({ id: sysRoles.id })
        .from(sysRoles)
        .where(inArray(sysRoles.code, dto.roles));

      for (const role of roleRows) {
        await this.db
          .insert(sysRoleMenus)
          .values({ roleId: role.id, menuId: newMenuId })
          .onConflictDoNothing();
      }
    }

    return inserted[0];
  }

  /** Soft-delete a custom button (btn_config IS NOT NULL guard prevents removing system buttons). */
  async removeCustomBtn(tableName: string, btnName: string): Promise<void> {
    const parent = await this.findPageMenuByTable(tableName);

    const rows = await this.db
      .select({ id: sysMenus.id, btnConfig: sysMenus.btnConfig })
      .from(sysMenus)
      .where(
        and(
          eq(sysMenus.parentId, parent.id),
          eq(sysMenus.menuType, 3),
          eq(sysMenus.name, btnName),
          isNull(sysMenus.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException(`Button '${btnName}' not found on table '${tableName}'`);
    }
    if (!rows[0].btnConfig) {
      throw new BadRequestException(`'${btnName}' is a system button and cannot be removed via this API`);
    }

    const btnMenuId = rows[0].id;
    await this.db.delete(sysRoleMenus).where(eq(sysRoleMenus.menuId, btnMenuId));
    await this.db
      .update(sysMenus)
      .set({ deletedAt: sql`NOW()` })
      .where(eq(sysMenus.id, btnMenuId));
  }

  async findByAuthority(query: { authorityId?: string; menuId?: string }): Promise<SysAuthorityBtn[]> {
    const conditions = [isNull(sysAuthorityBtns.deletedAt)];

    if (query.authorityId) {
      conditions.push(eq(sysAuthorityBtns.authorityId, query.authorityId));
    }
    if (query.menuId) {
      conditions.push(eq(sysAuthorityBtns.menuId, query.menuId));
    }

    const rows = await this.db
      .select()
      .from(sysAuthorityBtns)
      .where(and(...conditions))
      .orderBy(sysAuthorityBtns.btnName);

    return rows;
  }

  async findOne(id: string): Promise<SysAuthorityBtn> {
    const rows = await this.db
      .select()
      .from(sysAuthorityBtns)
      .where(and(eq(sysAuthorityBtns.id, id), isNull(sysAuthorityBtns.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Authority button with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateAuthorityBtnDto): Promise<SysAuthorityBtn> {
    // Check uniqueness (authorityId + menuId + btnName)
    const existing = await this.db
      .select()
      .from(sysAuthorityBtns)
      .where(
        and(
          eq(sysAuthorityBtns.authorityId, dto.authorityId),
          eq(sysAuthorityBtns.menuId, dto.menuId),
          eq(sysAuthorityBtns.btnName, dto.btnName),
          isNull(sysAuthorityBtns.deletedAt),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ConflictException({
        code: ApiErrorCode.PARAM_ERROR,
        message: `Button '${dto.btnName}' already exists for this role and menu`,
      });
    }

    const rows = await this.db
      .insert(sysAuthorityBtns)
      .values({
        authorityId: dto.authorityId,
        menuId: dto.menuId,
        btnName: dto.btnName,
      } satisfies NewSysAuthorityBtn)
      .returning();

    return rows[0]!;
  }

  async set(dto: SetAuthorityBtnsDto): Promise<SysAuthorityBtn[]> {
    // Soft-delete all existing buttons for this authority+menu pair
    await this.db
      .update(sysAuthorityBtns)
      .set({ deletedAt: sql`NOW()` })
      .where(
        and(
          eq(sysAuthorityBtns.authorityId, dto.authorityId),
          eq(sysAuthorityBtns.menuId, dto.menuId),
          isNull(sysAuthorityBtns.deletedAt),
        ),
      );

    // Create new button entries
    const results: SysAuthorityBtn[] = [];
    for (const btnName of dto.btnNames) {
      const rows = await this.db
        .insert(sysAuthorityBtns)
        .values({
          authorityId: dto.authorityId,
          menuId: dto.menuId,
          btnName,
        } satisfies NewSysAuthorityBtn)
        .returning();
      results.push(rows[0]!);
    }

    return results;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    await this.db
      .update(sysAuthorityBtns)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysAuthorityBtns.id, id), isNull(sysAuthorityBtns.deletedAt)));
  }

  // =========================================================================
  // Button-permission matrix (the REAL runtime system)
  // getMyBtnPerms reads button sub-menus (sysMenus menu_type=3) via sys_role_menus,
  // NOT the legacy sys_authority_btns table. These power the management UI.
  // =========================================================================

  /**
   * Return the button-permission matrix grouped by page menu:
   * each group = a page menu + its button sub-menus, each button carrying the
   * list of role ids currently granted. Roles are resolved to names client-side.
   */
  async getMatrix(): Promise<BtnMatrixGroup[]> {
    const btnMenus = await this.db
      .select({ id: sysMenus.id, name: sysMenus.name, parentId: sysMenus.parentId })
      .from(sysMenus)
      .where(and(eq(sysMenus.menuType, 3), isNull(sysMenus.deletedAt)));
    if (btnMenus.length === 0) return [];

    const parentIds = [...new Set(btnMenus.map((b) => b.parentId).filter(Boolean))] as string[];
    const parents = parentIds.length
      ? await this.db
          .select({
            id: sysMenus.id,
            name: sysMenus.name,
            path: sysMenus.path,
            component: sysMenus.component,
          })
          .from(sysMenus)
          .where(and(inArray(sysMenus.id, parentIds), isNull(sysMenus.deletedAt)))
      : [];
    const parentMap = new Map(parents.map((p) => [p.id, p]));

    const btnMenuIds = btnMenus.map((b) => b.id);
    const assignments = await this.db
      .select({ menuId: sysRoleMenus.menuId, roleId: sysRoleMenus.roleId })
      .from(sysRoleMenus)
      .where(inArray(sysRoleMenus.menuId, btnMenuIds));
    const assignedRoles = new Map<string, Set<string>>();
    for (const a of assignments) {
      if (!assignedRoles.has(a.menuId)) assignedRoles.set(a.menuId, new Set());
      assignedRoles.get(a.menuId)!.add(a.roleId);
    }

    const groupMap = new Map<string, BtnMatrixGroup>();
    for (const b of btnMenus) {
      const pid = b.parentId;
      if (!pid) continue;
      const parent = parentMap.get(pid);
      if (!parent) continue;
      if (!groupMap.has(pid)) {
        groupMap.set(pid, {
          menu: {
            id: parent.id,
            name: parent.name ?? '',
            path: parent.path ?? '',
            component: parent.component ?? '',
          },
          buttons: [],
        });
      }
      groupMap.get(pid)!.buttons.push({
        id: b.id,
        name: b.name ?? '',
        assignedRoleIds: [...(assignedRoles.get(b.id) ?? [])],
      });
    }
    return [...groupMap.values()];
  }

  /** Grant or revoke a single (role × button-sub-menu) entry in sys_role_menus. */
  async toggleBtn(roleId: string, buttonMenuId: string, assigned: boolean): Promise<void> {
    if (assigned) {
      await this.db
        .insert(sysRoleMenus)
        .values({ roleId, menuId: buttonMenuId })
        .onConflictDoNothing();
    } else {
      await this.db
        .delete(sysRoleMenus)
        .where(and(eq(sysRoleMenus.roleId, roleId), eq(sysRoleMenus.menuId, buttonMenuId)));
    }
  }
}

export interface BtnMatrixButton {
  id: string;
  name: string;
  assignedRoleIds: string[];
}

export interface BtnMatrixGroup {
  menu: { id: string; name: string; path: string; component: string };
  buttons: BtnMatrixButton[];
}

export interface CustomBtnEntry {
  name: string;
  label: string;
  actionType: 'navigate';
  targetTable: string;
  sourceField: string;
}

export interface BtnPermsEntry {
  systemBtns: string[];
  customBtns: CustomBtnEntry[];
}

export interface BtnPermsDetail {
  id: string;
  name: string;
  isCustom: boolean;
  btnConfig?: BtnConfig;
  assignedRoleIds: string[];
}
