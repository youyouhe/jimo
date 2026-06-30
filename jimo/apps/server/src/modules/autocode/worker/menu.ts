/**
 * Worker-side reimplementation of MenuService.autoCreateMenu / autoCreateMapMenu.
 * Pure functions: postgres `sql` + plain AutoCodeDto + optional parent id.
 * No NestJS DI, no Drizzle.
 *
 * CASBIN addPolicy is intentionally OMITTED — the in-memory enforcer lives in
 * the NestJS server process, which this worker cannot reach. Authorization for
 * generated endpoints is covered by the addDefaultPolicies wildcard for
 * /api/v1/lc/*. If that wildcard is ever removed, the server must add per-path
 * policies (casbinService.reloadFromDb()) for the rows inserted here.
 */
import type { Sql } from 'postgres';
import type { AutoCodeDto } from '../dto/autocode.dto';
import { deriveNames } from '../autocode-field-utils';

function extractMenuName(description: string | undefined, fallback: string): string {
  if (!description) return fallback;
  const paren = description.indexOf('（');
  if (paren > 0) return description.slice(0, paren).trim();
  const parenAscii = description.indexOf('(');
  if (parenAscii > 0) return description.slice(0, parenAscii).trim();
  return description;
}

const CRUD_DEFS: { name: string; desc: string; method: string; suffix: string }[] = [
  { name: 'query', desc: '查询', method: 'GET', suffix: '' },
  { name: 'add', desc: '新增', method: 'POST', suffix: '' },
  { name: 'edit', desc: '编辑', method: 'PATCH', suffix: '/:id' },
  { name: 'delete', desc: '删除', method: 'DELETE', suffix: '/:id' },
  { name: 'batchDelete', desc: '批量删除', method: 'DELETE', suffix: '/batch' },
];

export async function autoCreateMenu(
  sql: Sql,
  dto: AutoCodeDto,
  menuParentId?: string | null,
): Promise<string> {
  const n = deriveNames(dto.tableName);
  const componentName = n.pageComponentPath;
  const menuPath = n.routePath;

  // 1. Find or create the page menu (menu_type=2)
  const existing = await sql`
    SELECT id FROM sys_menus WHERE path = ${menuPath} AND deleted_at IS NULL LIMIT 1
  `;
  let menuId: string;
  if (existing.length > 0) {
    menuId = existing[0].id;
  } else {
    const maxSortRows = menuParentId
      ? await sql`SELECT COALESCE(MAX(sort), -1) AS max_sort FROM sys_menus WHERE parent_id = ${menuParentId}`
      : await sql`SELECT COALESCE(MAX(sort), -1) AS max_sort FROM sys_menus WHERE parent_id IS NULL`;
    const nextSort = (maxSortRows[0]?.max_sort ?? -1) + 1;
    const menuName = extractMenuName(dto.description, n.pascalName);
    const inserted = await sql`
      INSERT INTO sys_menus (name, path, component, icon, parent_id, sort, is_visible, menu_type)
      VALUES (${menuName}, ${menuPath}, ${componentName}, 'Tableoutlined', ${menuParentId ?? null}, ${nextSort}, 1, 2)
      RETURNING id
    `;
    menuId = inserted[0].id;
  }

  // 2. Resolve admin roles
  const adminRoles = await sql`
    SELECT id, code FROM sys_roles WHERE code IN ('super_admin', 'admin', 'editor') AND deleted_at IS NULL
  `;
  if (adminRoles.length > 0) {
    const roleIdList = adminRoles.map((r: any) => r.id);
    await sql`
      INSERT INTO sys_role_menus (role_id, menu_id)
      SELECT role_id, ${menuId} FROM unnest(${roleIdList}::uuid[]) AS role_id
      ON CONFLICT DO NOTHING
    `;
  }

  // 3. Clean up old button children (menu_type=3)
  const oldBtnChildren = await sql`
    SELECT id FROM sys_menus WHERE parent_id = ${menuId} AND menu_type = 3 AND deleted_at IS NULL
  `;
  if (oldBtnChildren.length > 0) {
    const oldIds = oldBtnChildren.map((r: any) => r.id);
    const allIds = [menuId, ...oldIds];
    await sql`DELETE FROM sys_authority_btns WHERE menu_id = ANY(${allIds}::uuid[])`;
    await sql`DELETE FROM sys_role_menus WHERE menu_id = ANY(${oldIds}::uuid[])`;
    await sql`DELETE FROM sys_menus WHERE id = ANY(${oldIds}::uuid[])`;
  }

  const apiPrefix = '/api/v1/lc';
  const apiGroup = `lc/${n.kebabName}`;
  const menuName = extractMenuName(dto.description, n.pascalName);

  // 4. CRUD buttons + sys_apis
  for (let sort = 0; sort < CRUD_DEFS.length; sort++) {
    const def = CRUD_DEFS[sort]!;
    const permission = `lc:${n.kebabName}:${def.name}`;
    const apiPath = `${apiPrefix}/${n.kebabName}${def.suffix}`;

    const existingSub = await sql`
      SELECT id FROM sys_menus WHERE parent_id = ${menuId} AND name = ${def.name} AND menu_type = 3 AND deleted_at IS NULL LIMIT 1
    `;
    if (existingSub.length > 0) continue;

    const subRows = await sql`
      INSERT INTO sys_menus (name, path, component, icon, parent_id, sort, is_visible, permission, menu_type)
      VALUES (${def.name}, NULL, NULL, NULL, ${menuId}, ${sort}, 1, ${permission}, 3)
      RETURNING id
    `;
    const subMenuId = subRows[0].id;

    const apiPaths = def.suffix === '' ? [apiPath, `${apiPath}/:id`] : [apiPath];
    for (const p of apiPaths) {
      const existingApi = await sql`
        SELECT id FROM sys_apis WHERE method = ${def.method} AND path = ${p} AND deleted_at IS NULL LIMIT 1
      `;
      if (existingApi.length === 0) {
        await sql`
          INSERT INTO sys_apis (method, path, permission, description, api_group)
          VALUES (${def.method}, ${p}, ${permission}, ${`${def.desc}${menuName}`}, ${apiGroup})
        `;
      }
    }

    if (adminRoles.length > 0) {
      const roleIdList = adminRoles.map((r: any) => r.id);
      await sql`
        INSERT INTO sys_role_menus (role_id, menu_id)
        SELECT role_id, ${subMenuId} FROM unnest(${roleIdList}::uuid[]) AS role_id
        ON CONFLICT DO NOTHING
      `;
    }
  }

  // 5. Tree endpoint for self-referential tables
  const hasSelfRef = dto.fields.some(
    (f) => f.type === 'relation' && f.relationType === 'many-to-one' && f.relationTable === dto.tableName,
  );
  if (hasSelfRef) {
    const treePath = `${apiPrefix}/${n.kebabName}/tree`;
    const existingTreeApi = await sql`
      SELECT id FROM sys_apis WHERE method = 'GET' AND path = ${treePath} AND deleted_at IS NULL LIMIT 1
    `;
    if (existingTreeApi.length === 0) {
      await sql`
        INSERT INTO sys_apis (method, path, permission, description, api_group)
        VALUES ('GET', ${treePath}, ${`lc:${n.kebabName}:query`}, ${`查询${menuName}树形结构`}, ${apiGroup})
      `;
    }
  }

  // 6. Agent button + ai-chat / ai-test sys_apis
  if (dto.agentConfig?.enabled) {
    const AGENT_PERMISSION = 'autocode:ai-chat';
    const existingAgentBtn = await sql`
      SELECT id FROM sys_menus WHERE parent_id = ${menuId} AND name = 'agent' AND menu_type = 3 AND deleted_at IS NULL LIMIT 1
    `;
    if (existingAgentBtn.length === 0) {
      const agentBtnRows = await sql`
        INSERT INTO sys_menus (name, path, component, icon, parent_id, sort, is_visible, permission, menu_type)
        VALUES ('agent', NULL, NULL, NULL, ${menuId}, ${CRUD_DEFS.length}, 1, ${AGENT_PERMISSION}, 3)
        RETURNING id
      `;
      const agentBtnId = agentBtnRows[0].id;
      if (adminRoles.length > 0) {
        const roleIdList = adminRoles.map((r: any) => r.id);
        await sql`
          INSERT INTO sys_role_menus (role_id, menu_id)
          SELECT role_id, ${agentBtnId} FROM unnest(${roleIdList}::uuid[]) AS role_id
          ON CONFLICT DO NOTHING
        `;
      }
    }
    for (const [pth, desc] of [
      ['/api/v1/autocode/ai-chat', '实体伴随Agent对话(SSE)'],
      ['/api/v1/autocode/ai-test', 'AI配置连通性测试'],
    ] as const) {
      const exists = await sql`SELECT id FROM sys_apis WHERE path = ${pth} AND method = 'POST' AND deleted_at IS NULL LIMIT 1`;
      if (exists.length === 0) {
        await sql`
          INSERT INTO sys_apis (method, path, permission, description, api_group)
          VALUES ('POST', ${pth}, ${AGENT_PERMISSION}, ${desc}, 'autocode')
        `;
      }
    }
  }

  return menuId;
}

export async function autoCreateMapMenu(
  sql: Sql,
  dto: AutoCodeDto,
  menuParentId: string | null,
): Promise<void> {
  const n = deriveNames(dto.tableName);
  const mapRoutePath = `${n.routePath}-map`;

  const existing = await sql`
    SELECT id FROM sys_menus WHERE path = ${mapRoutePath} AND deleted_at IS NULL LIMIT 1
  `;
  if (existing.length > 0) return;

  const maxSortRows = menuParentId
    ? await sql`SELECT COALESCE(MAX(sort), -1) AS max_sort FROM sys_menus WHERE parent_id = ${menuParentId}`
    : await sql`SELECT COALESCE(MAX(sort), -1) AS max_sort FROM sys_menus WHERE parent_id IS NULL`;
  const nextSort = (maxSortRows[0]?.max_sort ?? -1) + 1;

  const menuName = `${extractMenuName(dto.description, n.pascalName)}地图`;
  const inserted = await sql`
    INSERT INTO sys_menus (name, path, component, icon, parent_id, sort, is_visible, menu_type)
    VALUES (${menuName}, ${mapRoutePath}, ${n.pageMapComponentPath}, 'EnvironmentOutlined', ${menuParentId ?? null}, ${nextSort}, 1, 2)
    RETURNING id
  `;
  const mapMenuId = inserted[0].id;

  const adminRoles = await sql`
    SELECT id FROM sys_roles WHERE code IN ('super_admin', 'admin') AND deleted_at IS NULL
  `;
  if (adminRoles.length > 0) {
    const roleIdList = adminRoles.map((r: any) => r.id);
    await sql`
      INSERT INTO sys_role_menus (role_id, menu_id)
      SELECT role_id, ${mapMenuId} FROM unnest(${roleIdList}::uuid[]) AS role_id
      ON CONFLICT DO NOTHING
    `;
  }
}
