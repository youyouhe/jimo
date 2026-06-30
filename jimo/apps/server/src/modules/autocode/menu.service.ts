import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, and, isNull, sql, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DATABASE_CONNECTION, DrizzleDb } from '../../db/connection';
import { CASBIN_SERVICE_TOKEN, ICasbinService } from '../role/role.service';
import { sysMenus } from '../../db/schema/menus';
import { sysRoleMenus } from '../../db/schema/role-menus';
import { sysRoles } from '../../db/schema/roles';
import { sysAuthorityBtns } from '../../db/schema/authority-btns';
import { sysApis } from '../../db/schema/apis';
import { AutoCodeDto } from './dto/autocode.dto';
import {
  deriveNames,
  singularize,
  toKebabCase,
  buildCreateTableSql,
} from './autocode-field-utils';

function extractMenuName(description: string | undefined, fallback: string): string {
  if (!description) return fallback;
  const paren = description.indexOf('（');
  if (paren > 0) return description.slice(0, paren).trim();
  const parenAscii = description.indexOf('(');
  if (parenAscii > 0) return description.slice(0, parenAscii).trim();
  return description;
}

@Injectable()
export class MenuService {
  private readonly logger = new Logger(MenuService.name);

  private static readonly CRUD_DEFS: { name: string; desc: string; method: string; suffix: string }[] = [
    { name: 'query',       desc: '查询',     method: 'GET',    suffix: '' },
    { name: 'add',         desc: '新增',     method: 'POST',   suffix: '' },
    { name: 'edit',        desc: '编辑',     method: 'PATCH',  suffix: '/:id' },
    { name: 'delete',      desc: '删除',     method: 'DELETE', suffix: '/:id' },
    { name: 'batchDelete', desc: '批量删除', method: 'DELETE', suffix: '/batch' },
  ];

  constructor(
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    @Inject(CASBIN_SERVICE_TOKEN) private readonly casbin: ICasbinService,
  ) {}

  async syncTablesToDB(dto: AutoCodeDto): Promise<void> {
    const n = deriveNames(dto.tableName);
    const mainSql = buildCreateTableSql(n.tableName, dto.fields);
    await this.db.execute(sql.raw(mainSql));

    for (const f of dto.fields) {
      if (f.type === 'relation' && f.relationType === 'one-to-many' && f.detailFields?.length) {
        const singularMain = singularize(n.tableName.replace(/^lc_/, ''));
        const childTable = `lc_${singularMain}_${singularize(f.name)}`;
        const fkCol = `${singularMain}_id`;
        const childSql = buildCreateTableSql(childTable, f.detailFields, fkCol, n.tableName);
        await this.db.execute(sql.raw(childSql));

        for (const gf of f.detailFields) {
          if (gf.type === 'relation' && gf.relationType === 'one-to-many' && gf.detailFields?.length) {
            const singularChild = singularize(f.name);
            const singularGrand = singularize(gf.name);
            const grandTable = `lc_${singularMain}_${singularChild}_${singularGrand}`;
            const grandFkCol = `${singularMain}_${singularChild}_id`;
            const grandSql = buildCreateTableSql(grandTable, gf.detailFields, grandFkCol, childTable);
            await this.db.execute(sql.raw(grandSql));
          }
        }
      }
    }
  }

  async autoCreateMenu(dto: AutoCodeDto, parentMenuId?: string | null): Promise<string> {
    const n = deriveNames(dto.tableName);
    const componentName = `${n.pageComponentPath}`;
    const menuPath = n.routePath;

    const existing = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.path, menuPath), isNull(sysMenus.deletedAt)))
      .limit(1);

    let menuId: string;

    if (existing.length > 0) {
      menuId = existing[0].id;
    } else {
      const sortWhere = parentMenuId
        ? eq(sysMenus.parentId, parentMenuId)
        : isNull(sysMenus.parentId);
      const maxSortRows = await this.db
        .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
        .from(sysMenus)
        .where(sortWhere);
      const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

      const menuRows = await this.db
        .insert(sysMenus)
        .values({
          name: extractMenuName(dto.description, n.pascalName),
          path: menuPath,
          component: componentName,
          icon: 'TableOutlined',
          parentId: parentMenuId ?? null,
          sort: nextSort,
          isVisible: 1,
          menuType: 2,
        })
        .returning();

      menuId = menuRows[0]!.id;
    }

    const adminRoles = await this.db
      .select({ id: sysRoles.id, code: sysRoles.code })
      .from(sysRoles)
      .where(inArray(sysRoles.code, ['super_admin', 'admin', 'editor']));

    if (adminRoles.length > 0) {
      await this.db
        .insert(sysRoleMenus)
        .values(adminRoles.map((role) => ({ roleId: role.id, menuId })))
        .onConflictDoNothing();
    }

    // Clean up old button-style entries first
    const oldBtnChildren = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(
        and(
          eq(sysMenus.parentId, menuId),
          eq(sysMenus.menuType, 3),
          isNull(sysMenus.deletedAt),
        ),
      );
    if (oldBtnChildren.length > 0) {
      const oldIds = oldBtnChildren.map((r) => r.id);
      await this.db.delete(sysAuthorityBtns).where(inArray(sysAuthorityBtns.menuId, [menuId, ...oldIds]));
      await this.db.delete(sysRoleMenus).where(inArray(sysRoleMenus.menuId, oldIds));
      await this.db.delete(sysMenus).where(inArray(sysMenus.id, oldIds));
    }

    const apiPrefix = '/api/v1/lc';
    const apiGroup = `lc/${n.kebabName}`;

    let crudCount = 0;
    for (let sort = 0; sort < MenuService.CRUD_DEFS.length; sort++) {
      const def = MenuService.CRUD_DEFS[sort]!;
      const permission = `lc:${n.kebabName}:${def.name}`;
      const apiPath = `${apiPrefix}/${n.kebabName}${def.suffix}`;

      const existingSub = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(
          and(
            eq(sysMenus.parentId, menuId),
            eq(sysMenus.name, def.name),
            eq(sysMenus.menuType, 3),
            isNull(sysMenus.deletedAt),
          ),
        )
        .limit(1);

      if (existingSub.length > 0) {
        crudCount++;
        continue;
      }

      const subRows = await this.db
        .insert(sysMenus)
        .values({
          name: def.name,
          path: null,
          component: null,
          icon: null,
          parentId: menuId,
          sort,
          isVisible: 1,
          permission,
          menuType: 3,
        })
        .returning();

      const subMenuId = subRows[0]!.id;
      crudCount++;

      const apiPaths = def.suffix === ''
        ? [apiPath, `${apiPath}/:id`]
        : [apiPath];

      for (const p of apiPaths) {
        const existingApi = await this.db
          .select({ id: sysApis.id })
          .from(sysApis)
          .where(
            and(
              eq(sysApis.method, def.method),
              eq(sysApis.path, p),
              isNull(sysApis.deletedAt),
            ),
          )
          .limit(1);

        if (existingApi.length === 0) {
          await this.db.insert(sysApis).values({
            method: def.method,
            path: p,
            permission,
            description: `${def.desc}${extractMenuName(dto.description, n.pascalName)}`,
            apiGroup,
          });
        }
      }

      if (adminRoles.length > 0) {
        await this.db
          .insert(sysRoleMenus)
          .values(adminRoles.map((role) => ({ roleId: role.id, menuId: subMenuId })))
          .onConflictDoNothing();

        for (const role of adminRoles) {
          for (const p of apiPaths) {
            await this.casbin.addPolicy(role.code, p, def.method);
          }
        }
      }
    }

    // Tree endpoint permission for self-referential tables
    const hasSelfRef = dto.fields.some(
      (f) => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName,
    );
    if (hasSelfRef) {
      const treePath = `${apiPrefix}/${n.kebabName}/tree`;
      const treePermission = `lc:${n.kebabName}:query`;
      const existingTreeApi = await this.db
        .select({ id: sysApis.id })
        .from(sysApis)
        .where(and(eq(sysApis.method, 'GET'), eq(sysApis.path, treePath), isNull(sysApis.deletedAt)))
        .limit(1);
      if (existingTreeApi.length === 0) {
        await this.db.insert(sysApis).values({
          method: 'GET',
          path: treePath,
          permission: treePermission,
          description: `查询${extractMenuName(dto.description, n.pascalName)}树形结构`,
          apiGroup,
        });
      }
      for (const role of adminRoles) {
        await this.casbin.addPolicy(role.code, treePath, 'GET');
      }
    }

    // Agent button permission
    if (dto.agentConfig?.enabled) {
      const AGENT_PERMISSION = 'autocode:ai-chat';
      const existingAgentBtn = await this.db
        .select({ id: sysMenus.id })
        .from(sysMenus)
        .where(
          and(
            eq(sysMenus.parentId, menuId),
            eq(sysMenus.name, 'agent'),
            eq(sysMenus.menuType, 3),
            isNull(sysMenus.deletedAt),
          ),
        )
        .limit(1);

      if (existingAgentBtn.length === 0) {
        const agentBtnRows = await this.db
          .insert(sysMenus)
          .values({
            name: 'agent',
            path: null,
            component: null,
            icon: null,
            parentId: menuId,
            sort: MenuService.CRUD_DEFS.length,
            isVisible: 1,
            permission: AGENT_PERMISSION,
            menuType: 3,
          })
          .returning();
        const agentBtnId = agentBtnRows[0]!.id;

        if (adminRoles.length > 0) {
          await this.db
            .insert(sysRoleMenus)
            .values(adminRoles.map((role) => ({ roleId: role.id, menuId: agentBtnId })))
            .onConflictDoNothing();
        }
      }

      // Ensure sys_apis entry for ai-chat
      const apiExists = await this.db
        .select({ id: sysApis.id })
        .from(sysApis)
        .where(and(eq(sysApis.path, '/api/v1/autocode/ai-chat'), eq(sysApis.method, 'POST'), isNull(sysApis.deletedAt)))
        .limit(1);
      if (apiExists.length === 0) {
        await this.db.insert(sysApis).values({
          method: 'POST',
          path: '/api/v1/autocode/ai-chat',
          permission: AGENT_PERMISSION,
          description: '实体伴随Agent对话(SSE)',
          apiGroup: 'autocode',
        });
      }

      const testApiExists = await this.db
        .select({ id: sysApis.id })
        .from(sysApis)
        .where(and(eq(sysApis.path, '/api/v1/autocode/ai-test'), eq(sysApis.method, 'POST'), isNull(sysApis.deletedAt)))
        .limit(1);
      if (testApiExists.length === 0) {
        await this.db.insert(sysApis).values({
          method: 'POST',
          path: '/api/v1/autocode/ai-test',
          permission: AGENT_PERMISSION,
          description: 'AI配置连通性测试',
          apiGroup: 'autocode',
        });
      }
    }

    this.logger.log(
      `[MenuService] Auto-created menu '${extractMenuName(dto.description, n.pascalName)}' (${menuPath}), ` +
      `parent=${parentMenuId ?? 'root'}, assigned to ${adminRoles.length} roles, ` +
      `${crudCount} CRUD permissions`,
    );
    return menuId;
  }

  async autoCreateMapMenu(dto: AutoCodeDto, parentMenuId: string | null): Promise<void> {
    const n = deriveNames(dto.tableName);
    const mapRoutePath = `${n.routePath}-map`;
    const existing = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(eq(sysMenus.path, mapRoutePath), isNull(sysMenus.deletedAt)))
      .limit(1);
    if (existing.length > 0) return;

    const sortWhere = parentMenuId
      ? eq(sysMenus.parentId, parentMenuId)
      : isNull(sysMenus.parentId);
    const maxSortRows = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
      .from(sysMenus)
      .where(sortWhere);
    const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

    const menuRows = await this.db
      .insert(sysMenus)
      .values({
        name: `${extractMenuName(dto.description, n.pascalName)}地图`,
        path: mapRoutePath,
        component: `${n.pageMapComponentPath}`,
        icon: 'EnvironmentOutlined',
        parentId: parentMenuId ?? null,
        sort: nextSort,
        isVisible: 1,
        menuType: 2,
      })
      .returning();

    const mapMenuId = menuRows[0]!.id;
    const adminRoles = await this.db
      .select({ id: sysRoles.id })
      .from(sysRoles)
      .where(inArray(sysRoles.code, ['super_admin', 'admin']));
    if (adminRoles.length > 0) {
      await this.db
        .insert(sysRoleMenus)
        .values(adminRoles.map((role) => ({ roleId: role.id, menuId: mapMenuId })))
        .onConflictDoNothing();
    }
  }

  async ensureDirectoryMenu(packageName: string): Promise<string> {
    const existingByName = await this.db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(and(
        eq(sysMenus.name, packageName),
        eq(sysMenus.menuType, 1),
        isNull(sysMenus.parentId),
        isNull(sysMenus.deletedAt),
      ))
      .limit(1);

    if (existingByName.length > 0) {
      return existingByName[0]!.id;
    }

    const kebabPart = toKebabCase(packageName).replace(/[^a-z0-9-]/g, '') || 'pkg';
    const shortId = randomUUID().slice(0, 8);
    const dirPath = `/pkg/${kebabPart}-${shortId}`;

    const maxSortRows = await this.db
      .select({ maxSort: sql<number>`COALESCE(MAX(${sysMenus.sort}), -1)` })
      .from(sysMenus)
      .where(isNull(sysMenus.parentId));
    const nextSort = (maxSortRows[0]?.maxSort ?? -1) + 1;

    const menuRows = await this.db
      .insert(sysMenus)
      .values({
        name: packageName,
        path: dirPath,
        component: null,
        icon: 'AppstoreOutlined',
        parentId: null,
        sort: nextSort,
        isVisible: 1,
        menuType: 1,
      })
      .returning();

    const menuId = menuRows[0]!.id;

    const adminRoles = await this.db
      .select({ id: sysRoles.id })
      .from(sysRoles)
      .where(inArray(sysRoles.code, ['super_admin', 'admin']));

    if (adminRoles.length > 0) {
      await this.db
        .insert(sysRoleMenus)
        .values(adminRoles.map((role) => ({ roleId: role.id, menuId })))
        .onConflictDoNothing();
    }

    this.logger.log(` Created directory menu '${packageName}' at ${dirPath}`);
    return menuId;
  }
}
