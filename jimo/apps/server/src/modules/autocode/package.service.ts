import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq, and, isNull, desc, sql, count, inArray, ilike } from 'drizzle-orm';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import {
  sysAutoCodePackages,
  type SysAutoCodePackage,
} from '../../db/schema/auto-code-packages';
import { sysAutoCodeHistories } from '../../db/schema/auto-code-histories';
import { sysMenus } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysRoles } from '../../db/schema/roles';
import { sysAuthorityBtns } from '../../db/schema/authority-btns';
import { CreatePackageDto, UpdatePackageDto } from './dto/package.dto';
import { MenuService } from './menu.service';
import { deriveNames } from './autocode-field-utils';

@Injectable()
export class PackageService {
  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly menuService: MenuService,
  ) {}

  async findAllPackages(params: { page?: number; pageSize?: number; name?: string; includeDeleted?: boolean }): Promise<{ list: SysAutoCodePackage[]; total: number; page: number; pageSize: number }> {
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const offset = (page - 1) * pageSize;

    const conditions = params.includeDeleted ? [] : [isNull(sysAutoCodePackages.deletedAt)];
    if (params.name) {
      conditions.push(ilike(sysAutoCodePackages.name, `%${params.name}%`));
    }

    const whereClause = and(...conditions);

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(sysAutoCodePackages)
        .where(whereClause)
        .orderBy(desc(sysAutoCodePackages.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(sysAutoCodePackages)
        .where(whereClause),
    ]);

    const total = totalRows[0]?.count ?? 0;

    return { list: rows, total, page, pageSize };
  }

  async createPackage(dto: CreatePackageDto): Promise<SysAutoCodePackage> {
    const menuId = await this.menuService.ensureDirectoryMenu(dto.name);

    const rows = await this.db
      .insert(sysAutoCodePackages)
      .values({
        name: dto.name,
        description: dto.description ?? '',
        templates: dto.templates ?? {},
        tableName: dto.tableName ?? '',
        fields: dto.fields ?? null,
        generateWeb: dto.generateWeb ?? true,
        menuId,
      })
      .returning();

    return rows[0]!;
  }

  async findOnePackage(id: string): Promise<SysAutoCodePackage> {
    const rows = await this.db
      .select()
      .from(sysAutoCodePackages)
      .where(and(eq(sysAutoCodePackages.id, id), isNull(sysAutoCodePackages.deletedAt)))
      .limit(1);

    if (rows.length === 0) {
      throw new NotFoundException('Package not found');
    }

    return rows[0]!;
  }

  async updatePackage(id: string, dto: UpdatePackageDto): Promise<SysAutoCodePackage> {
    await this.findOnePackage(id);

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.templates !== undefined) updateData.templates = dto.templates;
    if (dto.tableName !== undefined) updateData.tableName = dto.tableName;
    if (dto.fields !== undefined) updateData.fields = dto.fields;
    if (dto.generateWeb !== undefined) updateData.generateWeb = dto.generateWeb;

    const rows = await this.db
      .update(sysAutoCodePackages)
      .set(updateData)
      .where(and(eq(sysAutoCodePackages.id, id), isNull(sysAutoCodePackages.deletedAt)))
      .returning();

    if (rows.length === 0) {
      throw new NotFoundException('Package not found');
    }

    return rows[0]!;
  }

  async deletePackage(id: string): Promise<void> {
    const pkg = await this.findOnePackage(id);

    if (pkg.menuId) {
      const children = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(eq(sysMenus.parentId, pkg.menuId));

      const childIds = children.map((c) => c.id);

      let btnIds: string[] = [];
      if (childIds.length > 0) {
        const btnRows = await this.db
          .select({ id: sysMenus.id })
          .from(sysMenus)
          .where(
            and(
              inArray(sysMenus.parentId, childIds),
              eq(sysMenus.menuType, 3),
              isNull(sysMenus.deletedAt),
            ),
          );
        btnIds = btnRows.map((b) => b.id);
      }

      const allMenuIds = [pkg.menuId, ...childIds, ...btnIds];

      await this.db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, allMenuIds));
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, allMenuIds));
      if (btnIds.length > 0) {
        await this.db.delete(sysMenus).where(inArray(sysMenus.id, btnIds));
      }
      if (childIds.length > 0) {
        await this.db.delete(sysMenus).where(inArray(sysMenus.id, childIds));
      }
      await this.db.delete(sysMenus).where(eq(sysMenus.id, pkg.menuId));
    }

    await this.db
      .update(sysAutoCodePackages)
      .set({ deletedAt: sql<Date>`NOW()` })
      .where(and(eq(sysAutoCodePackages.id, id), isNull(sysAutoCodePackages.deletedAt)));
  }

  async listMenusByPackage(): Promise<{ id: string; name: string; tables: string[] }[]> {
    const pkgs = await this.db
      .select({ id: sysAutoCodePackages.id, name: sysAutoCodePackages.name })
      .from(sysAutoCodePackages)
      .where(isNull(sysAutoCodePackages.deletedAt));

    const rawRows = await this.db.execute<{ table_name: string; package_name: string }>(
      sql`SELECT DISTINCT ON (table_name) table_name, package_name
          FROM sys_auto_code_histories
          ORDER BY table_name, created_at DESC`,
    );
    const histories = Array.isArray(rawRows) ? rawRows : (rawRows as any).rows ?? [];

    const result = pkgs.map((pkg) => ({
      id: pkg.id,
      name: pkg.name,
      tables: histories
        .filter((h: any) => h.package_name === pkg.name)
        .map((h: any) => h.table_name as string),
    }));

    const unassigned = histories
      .filter((h: any) => !h.package_name)
      .map((h: any) => h.table_name as string);
    if (unassigned.length > 0) {
      result.push({ id: '', name: '(未分类)', tables: unassigned });
    }

    return result;
  }

  async assignToPackage(tableName: string, packageId: string): Promise<{ ok: boolean; movedMenu: boolean }> {
    let pkg = await this.findOnePackage(packageId);

    let targetMenuId = pkg.menuId;
    if (!targetMenuId) {
      targetMenuId = await this.menuService.ensureDirectoryMenu(pkg.name);
      await this.db
        .update(sysAutoCodePackages)
        .set({ menuId: targetMenuId, updatedAt: new Date() })
        .where(eq(sysAutoCodePackages.id, packageId));
    } else {
      const dirMenu = await this.db
        .select({ path: sysMenus.path })
        .from(sysMenus)
        .where(eq(sysMenus.id, targetMenuId))
        .limit(1);
      if (dirMenu.length > 0 && dirMenu[0]!.path === '/pkg/untitled') {
        targetMenuId = await this.menuService.ensureDirectoryMenu(pkg.name);
        await this.db
          .update(sysAutoCodePackages)
          .set({ menuId: targetMenuId, updatedAt: new Date() })
          .where(eq(sysAutoCodePackages.id, packageId));
      }
    }

    const n = deriveNames(tableName);
    const componentPath = `${n.pageComponentPath}`;

    let movedMenu = false;
    const menuRows = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.component, componentPath), isNull(sysMenus.deletedAt)))
      .limit(1);

    if (menuRows.length > 0) {
      await this.db
        .update(sysMenus)
        .set({ parentId: targetMenuId })
        .where(eq(sysMenus.id, menuRows[0]!.id));
      const adminRoles = await this.db
        .select({ id: sysRoles.id })
        .from(sysRoles)
        .where(inArray(sysRoles.code, ['super_admin', 'admin']));
      if (adminRoles.length > 0) {
        await this.db
          .insert(sysRoleMenus)
          .values(adminRoles.map((role) => ({ roleId: role.id, menuId: menuRows[0]!.id })))
          .onConflictDoNothing();
        await this.db
          .insert(sysRoleMenus)
          .values(adminRoles.map((role) => ({ roleId: role.id, menuId: targetMenuId! })))
          .onConflictDoNothing();
      }
      movedMenu = true;
    }

    await this.db
      .update(sysAutoCodeHistories)
      .set({ packageName: pkg.name })
      .where(eq(sysAutoCodeHistories.tableName, tableName));

    return { ok: true, movedMenu };
  }

  async getPackageName(packageId: string): Promise<string> {
    const rows = await this.db
      .select({ name: sysAutoCodePackages.name })
      .from(sysAutoCodePackages)
      .where(and(eq(sysAutoCodePackages.id, packageId), isNull(sysAutoCodePackages.deletedAt)))
      .limit(1);
    return rows[0]?.name ?? '';
  }

  async getPackageConfig(id: string): Promise<{
    tableName: string;
    description: string;
    fields: any[];
    generateWeb: boolean;
    name: string;
    menuId: string | null;
  }> {
    const pkg = await this.findOnePackage(id);
    return {
      tableName: pkg.tableName ?? '',
      description: pkg.description ?? '',
      fields: (pkg.fields as any[]) ?? [],
      generateWeb: pkg.generateWeb ?? true,
      name: pkg.name,
      menuId: pkg.menuId ?? null,
    };
  }

  async listAllPackages(): Promise<Array<{ id: string; name: string; tableName: string; description: string }>> {
    const rows = await this.db
      .select({
        id: sysAutoCodePackages.id,
        name: sysAutoCodePackages.name,
        tableName: sysAutoCodePackages.tableName,
        description: sysAutoCodePackages.description,
      })
      .from(sysAutoCodePackages)
      .where(isNull(sysAutoCodePackages.deletedAt))
      .orderBy(desc(sysAutoCodePackages.createdAt));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      tableName: r.tableName ?? '',
      description: r.description ?? '',
    }));
  }
}
