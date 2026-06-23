import {
  Injectable,
  Inject,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { eq, and, isNull, inArray, sql } from 'drizzle-orm';
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
import { sysMenus } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';

@Injectable()
export class AuthorityBtnService {
  private readonly logger = new Logger(AuthorityBtnService.name);

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  /**
   * Return { component -> Set<btnName> } for the current user.
   * super_admin gets all buttons for all menus.
   * Others get only the btns in sys_authority_btns for their roles.
   */
  async getMyBtnPerms(userId: string, userRoles: string[]): Promise<Record<string, string[]>> {
    // super_admin bypasses sys_role_menus and always gets all button menus.
    if (userRoles.includes(RoleCode.SUPER_ADMIN)) {
      const rows = await this.db
        .select({ btnName: sysMenus.name, parentId: sysMenus.parentId })
        .from(sysMenus)
        .where(and(eq(sysMenus.menuType, 3), isNull(sysMenus.deletedAt)));

      const parentIds = [...new Set(rows.map((r) => r.parentId).filter(Boolean))] as string[];
      if (parentIds.length === 0) return {};

      const parents = await this.db
        .select({ id: sysMenus.id, component: sysMenus.component })
        .from(sysMenus)
        .where(and(inArray(sysMenus.id, parentIds), isNull(sysMenus.deletedAt)));

      const parentMap = new Map(parents.map((p) => [p.id, p.component]));
      const result: Record<string, string[]> = {};
      for (const row of rows) {
        const comp = parentMap.get(row.parentId ?? '') ?? '';
        if (!comp) continue;
        if (!result[comp]) result[comp] = [];
        result[comp].push(row.btnName);
      }
      return result;
    }

    // Regular user: look up their role IDs
    const userRoleRows = await this.db
      .select({ roleId: sysUserRoles.roleId })
      .from(sysUserRoles)
      .where(eq(sysUserRoles.userId, userId));

    const roleIds = userRoleRows.map((r) => r.roleId);
    if (roleIds.length === 0) return {};

    // Get menuType=3 (button) menus assigned to any of the user's roles via sys_role_menus
    const btnMenuRows = await this.db
      .select({
        btnId: sysMenus.id,
        btnName: sysMenus.name,
        parentId: sysMenus.parentId,
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

    if (btnMenuRows.length === 0) return {};

    // Resolve parentId -> component for each button menu
    const parentIds = [...new Set(
      btnMenuRows.map((r) => r.parentId).filter(Boolean),
    )] as string[];

    if (parentIds.length === 0) return {};

    const parentRows = await this.db
      .select({ id: sysMenus.id, component: sysMenus.component })
      .from(sysMenus)
      .where(and(inArray(sysMenus.id, parentIds), isNull(sysMenus.deletedAt)));

    const parentMap = new Map(parentRows.map((p) => [p.id, p.component ?? '']));
    const result: Record<string, string[]> = {};
    for (const btn of btnMenuRows) {
      const comp = parentMap.get(btn.parentId ?? '') ?? '';
      if (!comp) continue;
      if (!result[comp]) result[comp] = [];
      if (!result[comp].includes(btn.btnName)) result[comp].push(btn.btnName);
    }
    return result;
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
