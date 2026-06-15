import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { eq, and, or, isNull, like, sql, inArray } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import * as fs from 'fs/promises';
import { existsSync } from 'fs';
import * as path from 'path';
import { sysMenus, SysMenu } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysUserRoles } from '../../db/schema/user-roles';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { QueryMenuDto } from './dto/query-menu.dto';
import { ApiErrorCode, RoleCode } from '@lowcode/shared';
import { SQL } from 'drizzle-orm';

export interface MenuTreeNode extends SysMenu {
  children: MenuTreeNode[];
}

@Injectable()
export class MenuService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
  ) {}

  async findAll(query: QueryMenuDto): Promise<SysMenu[]> {
    const conditions: SQL[] = [isNull(sysMenus.deletedAt)];

    if (query.name) {
      conditions.push(like(sysMenus.name, `%${query.name}%`));
    }
    if (query.menu_type !== undefined) {
      conditions.push(eq(sysMenus.menuType, query.menu_type as 1 | 2 | 3));
    }

    const rows = await this.db
      .select()
      .from(sysMenus)
      .where(and(...conditions))
      .orderBy(sysMenus.sort, sysMenus.createdAt);

    return rows;
  }

  async findTree(): Promise<MenuTreeNode[]> {
    const allMenus = await this.db
      .select()
      .from(sysMenus)
      .where(isNull(sysMenus.deletedAt))
      .orderBy(sysMenus.sort, sysMenus.createdAt);

    return this.buildTree(allMenus, null);
  }

  async findAccessible(userId: string, userRole: string): Promise<MenuTreeNode[]> {
    // Include visible menus (isVisible=1) OR button-type menus (menuType=3)
    // Button menus have isVisible=0 to stay out of the sidebar, but they must
    // appear in the menu tree so frontend pages can check btn-level permissions.
    const conditions: SQL[] = [
      isNull(sysMenus.deletedAt),
      or(eq(sysMenus.isVisible, 1), eq(sysMenus.menuType, 3))!,
    ];

    // SUPER_ADMIN sees all visible menus
    if (userRole === RoleCode.SUPER_ADMIN) {
      const rows = await this.db
        .select()
        .from(sysMenus)
        .where(and(...conditions))
        .orderBy(sysMenus.sort, sysMenus.createdAt);
      return this.buildTree(rows, null);
    }

    // For other roles: filter by role-menu assignments
    // Get all role IDs for this user
    const userRoleRows = await this.db
      .select({ roleId: sysUserRoles.roleId })
      .from(sysUserRoles)
      .where(eq(sysUserRoles.userId, userId));

    const roleIds = userRoleRows.map((r) => r.roleId);

    if (roleIds.length === 0) {
      // No roles assigned — return empty tree
      return [];
    }

    // Get all menu IDs assigned to any of the user's roles
    const roleMenuRows = await this.db
      .selectDistinct({ menuId: sysRoleMenus.menuId })
      .from(sysRoleMenus)
      .where(inArray(sysRoleMenus.roleId, roleIds));

    const allowedMenuIds = roleMenuRows.map((r) => r.menuId);

    if (allowedMenuIds.length === 0) {
      // Roles have no menus assigned — return empty tree
      return [];
    }

    // Get all assigned menus PLUS their ancestors (to build proper tree paths)
    // We fetch all assigned menus and then walk up the tree
    const allAssignedMenus = await this.db
      .select()
      .from(sysMenus)
      .where(
        and(
          isNull(sysMenus.deletedAt),
          or(eq(sysMenus.isVisible, 1), eq(sysMenus.menuType, 3))!,
          inArray(sysMenus.id, allowedMenuIds),
        ),
      )
      .orderBy(sysMenus.sort, sysMenus.createdAt);

    // Collect all ancestor IDs that aren't already in the set
    const menuMap = new Map<string, SysMenu>();
    let ancestorIds = new Set<string>();

    // First pass: get all assigned menus, find their parentIds
    for (const menu of allAssignedMenus) {
      menuMap.set(menu.id, menu);
      if (menu.parentId && !allowedMenuIds.includes(menu.parentId)) {
        ancestorIds.add(menu.parentId);
      }
    }

    // Second pass: recursively fetch ancestors
    while (ancestorIds.size > 0) {
      const batchIds = [...ancestorIds];
      ancestorIds = new Set();

      const ancestors = await this.db
        .select()
        .from(sysMenus)
        .where(
          and(
            isNull(sysMenus.deletedAt),
            inArray(sysMenus.id, batchIds),
          ),
        );

      for (const ancestor of ancestors) {
        menuMap.set(ancestor.id, ancestor);
        if (ancestor.parentId && !menuMap.has(ancestor.parentId)) {
          ancestorIds.add(ancestor.parentId);
        }
      }
    }

    return this.buildTree([...menuMap.values()], null);
  }

  async findOne(id: string): Promise<SysMenu> {
    const rows = await this.db
      .select()
      .from(sysMenus)
      .where(and(eq(sysMenus.id, id), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException({
        code: ApiErrorCode.RESOURCE_NOT_FOUND,
        message: `Menu with id ${id} not found`,
      });
    }

    return rows[0]!;
  }

  async create(dto: CreateMenuDto): Promise<SysMenu> {
    // Validate parent_id if provided
    if (dto.parent_id) {
      await this.findOne(dto.parent_id);
    }

    const rows = await this.db
      .insert(sysMenus)
      .values({
        name: dto.name,
        path: dto.path,
        component: dto.component,
        icon: dto.icon,
        parentId: dto.parent_id ?? null,
        sort: dto.sort !== undefined ? (dto.sort as 0) : 0,
        isVisible: dto.is_visible !== undefined ? (dto.is_visible as 1 | 2) : 1,
        permission: dto.permission,
        menuType: dto.menu_type !== undefined ? (dto.menu_type as 1 | 2 | 3) : 1,
      })
      .returning();

    return rows[0]!;
  }

  async update(id: string, dto: UpdateMenuDto): Promise<SysMenu> {
    await this.findOne(id);

    // Validate parent_id if provided and not self-referencing
    if (dto.parent_id !== undefined && dto.parent_id !== null) {
      if (dto.parent_id === id) {
        throw new BadRequestException({
          code: ApiErrorCode.PARAM_ERROR,
          message: 'A menu cannot be its own parent',
        });
      }
      await this.findOne(dto.parent_id);
    }

    type MenuUpdateFields = {
      name?: string;
      path?: string | null;
      component?: string | null;
      icon?: string | null;
      parentId?: string | null;
      sort?: number;
      isVisible?: 1 | 2;
      permission?: string | null;
      menuType?: 1 | 2 | 3;
      updatedAt?: Date;
    };

    const updateData: MenuUpdateFields = {
      updatedAt: new Date(),
    };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.path !== undefined) updateData.path = dto.path;
    if (dto.component !== undefined) updateData.component = dto.component;
    if (dto.icon !== undefined) updateData.icon = dto.icon;
    if (dto.parent_id !== undefined) updateData.parentId = dto.parent_id ?? null;
    if (dto.sort !== undefined) updateData.sort = dto.sort;
    if (dto.is_visible !== undefined) updateData.isVisible = dto.is_visible as 1 | 2;
    if (dto.permission !== undefined) updateData.permission = dto.permission;
    if (dto.menu_type !== undefined) updateData.menuType = dto.menu_type as 1 | 2 | 3;

    const rows = await this.db
      .update(sysMenus)
      .set(updateData)
      .where(and(eq(sysMenus.id, id), isNull(sysMenus.deletedAt)))
      .returning();

    return rows[0]!;
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);

    // Check for children before soft-deleting
    const children = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.parentId, id), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (children.length > 0) {
      throw new BadRequestException({
        code: ApiErrorCode.PARAM_ERROR,
        message: 'Cannot delete a menu that has child menus. Remove children first.',
      });
    }

    await this.db
      .update(sysMenus)
      .set({ deletedAt: sql`NOW()` })
      .where(and(eq(sysMenus.id, id), isNull(sysMenus.deletedAt)));
  }

  async syncRoutesToUmirc(): Promise<{ updated: number }> {
    const projectRoot = this.resolveProjectRoot();
    const umircPath = path.join(projectRoot, 'apps/web/.umirc.ts');

    const menus = await this.db
      .select()
      .from(sysMenus)
      .where(and(isNull(sysMenus.deletedAt), eq(sysMenus.isVisible, 1)));

    let content = await fs.readFile(umircPath, 'utf-8');
    let updated = 0;

    for (const menu of menus) {
      if (!menu.path) continue;

      const escapedPath = menu.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // Match: path: '/some/path', ... name: 'OldName'
      // We update only the name field of the matching route entry
      const nameRegex = new RegExp(
        `(path:\\s*'${escapedPath}'[^}]*?name:\\s*)'[^']*'`,
        's',
      );

      if (nameRegex.test(content)) {
        const newContent = content.replace(nameRegex, `$1'${menu.name}'`);
        if (newContent !== content) {
          content = newContent;
          updated++;
        }
      }
    }

    await fs.writeFile(umircPath, content, 'utf-8');
    return { updated };
  }

  private resolveProjectRoot(): string {
    const cwd = process.cwd();
    if (existsSync(path.join(cwd, 'apps', 'server', 'src'))) {
      return cwd;
    }
    return path.resolve(cwd, '..', '..');
  }

  private buildTree(menus: SysMenu[], parentId: string | null = null): MenuTreeNode[] {
    // Build lookup map once — O(n)
    const childrenMap = new Map<string | null, SysMenu[]>();
    for (const menu of menus) {
      const key = menu.parentId ?? null;
      if (!childrenMap.has(key)) childrenMap.set(key, []);
      childrenMap.get(key)!.push(menu);
    }

    // Recursive build using map — O(n) total, with cycle detection
    const buildNodes = (pid: string | null, visited = new Set<string | null>()): MenuTreeNode[] => {
      if (visited.has(pid)) return [];
      const nextVisited = new Set(visited).add(pid);
      const children = childrenMap.get(pid) ?? [];
      return children
        .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
        .map(menu => ({
          ...menu,
          children: buildNodes(menu.id, nextVisited),
        }));
    };

    return buildNodes(parentId);
  }
}
