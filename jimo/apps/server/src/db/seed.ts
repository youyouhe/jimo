import { hash } from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { RoleCode } from '@jimo/shared';
import { createDb } from './connection.js';
import { sysUsers, sysRoles, sysMenus, sysUserRoles, sysRoleMenus, sysEncodingRules } from './schema/index.js';

/**
 * Idempotent safety-net for tables added after the initial schema. `drizzle-kit
 * push` is the canonical way to create tables, but existing dev databases that
 * were pushed before these tables existed won't pick them up without a re-push
 * (and push can be interactive). CREATE IF NOT EXISTS here means `db:seed`
 * guarantees they exist. Keep the columns in sync with db/schema/*.ts.
 */
async function ensureTables(db: ReturnType<typeof createDb>): Promise<void> {
  // sys_candidate_rules — approval candidate-resolution rules (see CONTEXT.md).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "sys_candidate_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "name" varchar(100) NOT NULL,
      "filter" jsonb NOT NULL,
      "enabled" boolean DEFAULT true NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "deleted_at" timestamp with time zone
    )`);
  console.log('[seed] ensured sys_candidate_rules exists');
}

async function seedAdmin(db: ReturnType<typeof createDb>): Promise<void> {
  const existing = await db
    .select({ id: sysUsers.id })
    .from(sysUsers)
    .where(eq(sysUsers.username, 'admin'))
    .limit(1);

  if (existing.length > 0) {
    console.log('[seed] admin user already exists, skipping');
    return;
  }

  const adminPassword = process.env['SEED_ADMIN_PASSWORD'] ?? 'admin123';
  const passwordHash = await hash(adminPassword, 12);
  await db.insert(sysUsers).values({
    username: 'admin',
    passwordHash,
    nickname: '超级管理员',
    email: 'admin@example.com',
    status: 1,
  });

  console.log('[seed] admin user created successfully');
}

async function seedRoles(db: ReturnType<typeof createDb>): Promise<void> {
  await db
    .insert(sysRoles)
    .values([
      {
        name: '超级管理员',
        code: RoleCode.SUPER_ADMIN,
        description: '拥有所有权限',
        isDefault: 0,
      },
      {
        name: '管理员',
        code: RoleCode.ADMIN,
        description: '拥有管理权限',
        isDefault: 0,
      },
      {
        name: '编辑',
        code: RoleCode.EDITOR,
        description: '拥有编辑权限',
        isDefault: 0,
      },
      {
        name: '访客',
        code: RoleCode.VIEWER,
        description: '只读权限',
        isDefault: 1,
      },
    ])
    .onConflictDoNothing();

  console.log('[seed] roles seeded');
}

async function seedMenus(db: ReturnType<typeof createDb>): Promise<void> {
  // Build hierarchical menu tree matching GVA structure
  const menuTree: (typeof sysMenus.$inferInsert)[] = [
    // ── Dashboard (root menu) ──
    {
      name: '仪表盘',
      path: '/dashboard',
      component: './dashboard/index',
      icon: 'DashboardOutlined',
      parentId: null,
      sort: 0,
      isVisible: 1,
      menuType: 2,
      permission: null,
    },
    // ── System Management (directory) ──
    {
      name: '系统管理',
      path: '/system',
      component: null,
      icon: 'SettingOutlined',
      parentId: null,
      sort: 1,
      isVisible: 1,
      menuType: 1, // Directory
      permission: null,
    },
    // ── System > User Management ──
    {
      name: '用户管理',
      path: '/system/users',
      component: './users/index',
      icon: 'TeamOutlined',
      parentId: null, // Will be set after first insert
      sort: 10,
      isVisible: 1,
      menuType: 2,
      permission: 'system:user:list',
    },
    // System > User > buttons
    {
      name: '创建用户',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 11,
      isVisible: 1,
      menuType: 3,
      permission: 'system:user:create',
    },
    {
      name: '编辑用户',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 12,
      isVisible: 1,
      menuType: 3,
      permission: 'system:user:update',
    },
    {
      name: '删除用户',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 13,
      isVisible: 1,
      menuType: 3,
      permission: 'system:user:delete',
    },
    // ── System > Role Management ──
    {
      name: '角色管理',
      path: '/system/roles',
      component: './roles/index',
      icon: 'SafetyCertificateOutlined',
      parentId: null,
      sort: 20,
      isVisible: 1,
      menuType: 2,
      permission: 'system:role:list',
    },
    {
      name: '创建角色',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 21,
      isVisible: 1,
      menuType: 3,
      permission: 'system:role:create',
    },
    {
      name: '编辑角色',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 22,
      isVisible: 1,
      menuType: 3,
      permission: 'system:role:update',
    },
    {
      name: '删除角色',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 23,
      isVisible: 1,
      menuType: 3,
      permission: 'system:role:delete',
    },
    // ── System > Menu Management ──
    {
      name: '菜单管理',
      path: '/system/menus',
      component: './menus/index',
      icon: 'MenuOutlined',
      parentId: null,
      sort: 30,
      isVisible: 1,
      menuType: 2,
      permission: 'system:menu:list',
    },
    {
      name: '创建菜单',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 31,
      isVisible: 1,
      menuType: 3,
      permission: 'system:menu:create',
    },
    {
      name: '编辑菜单',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 32,
      isVisible: 1,
      menuType: 3,
      permission: 'system:menu:update',
    },
    {
      name: '删除菜单',
      path: null,
      component: null,
      icon: null,
      parentId: null,
      sort: 33,
      isVisible: 1,
      menuType: 3,
      permission: 'system:menu:delete',
    },
    // ── System > API Management ──
    {
      name: 'API管理',
      path: '/system/apis',
      component: './apis/index',
      icon: 'ApiOutlined',
      parentId: null,
      sort: 40,
      isVisible: 1,
      menuType: 2,
      permission: 'system:api:list',
    },
    // ── System > Parameters ──
    {
      name: '系统参数',
      path: '/system/parameters',
      component: './parameters/index',
      icon: 'SlidersOutlined',
      parentId: null,
      sort: 50,
      isVisible: 1,
      menuType: 2,
      permission: 'system:parameter:list',
    },
    // ── System > Dictionary ──
    {
      name: '字典管理',
      path: '/system/dictionary',
      component: './dictionary/index',
      icon: 'BookOutlined',
      parentId: null,
      sort: 60,
      isVisible: 1,
      menuType: 2,
      permission: 'system:dictionary:list',
    },
    // ── System > JWT Blacklist ──
    {
      name: 'JWT黑名单',
      path: '/system/jwt-blacklist',
      component: './jwt-blacklist/index',
      icon: 'StopOutlined',
      parentId: null,
      sort: 70,
      isVisible: 1,
      menuType: 2,
      permission: 'system:jwt:list',
    },
    // ── System > System Config ──
    {
      name: '系统配置',
      path: '/system/config',
      component: './system/index',
      icon: 'ControlOutlined',
      parentId: null,
      sort: 80,
      isVisible: 1,
      menuType: 2,
      permission: 'system:config:list',
    },
    // ── System > Init ──
    {
      name: '系统初始化',
      path: '/system/init',
      component: './init/index',
      icon: 'ThunderboltOutlined',
      parentId: null,
      sort: 90,
      isVisible: 1,
      menuType: 2,
      permission: 'system:init',
    },
    // ── System > Department (org) Management ──
    {
      name: '组织管理',
      path: '/system/departments',
      component: './departments/index',
      icon: 'ApartmentOutlined',
      parentId: null,
      sort: 14,
      isVisible: 1,
      menuType: 2,
      permission: 'system:department:list',
    },
    // ── System > Employee Management ──
    {
      name: '员工管理',
      path: '/system/employees',
      component: './employees/index',
      icon: 'IdcardOutlined',
      parentId: null,
      sort: 15,
      isVisible: 1,
      menuType: 2,
      permission: 'system:employee:list',
    },
    // ── System Tools (directory) ──
    {
      name: '系统工具',
      path: '/tools',
      component: null,
      icon: 'ToolOutlined',
      parentId: null,
      sort: 2,
      isVisible: 1,
      menuType: 1, // Directory
      permission: null,
    },
    // ── Tools > File Management ──
    {
      name: '文件管理',
      path: '/tools/files',
      component: './files/index',
      icon: 'FileOutlined',
      parentId: null,
      sort: 10,
      isVisible: 1,
      menuType: 2,
      permission: 'system:file:list',
    },
    // ── Tools > Code Generator ──
    {
      name: '代码生成器',
      path: '/tools/autocode',
      component: './autocode/index',
      icon: 'CodeOutlined',
      parentId: null,
      sort: 20,
      isVisible: 1,
      menuType: 2,
      permission: 'system:autocode:list',
    },
    // ── Tools > AutoCode History ──
    {
      name: '生成历史',
      path: '/tools/autocode-history',
      component: './autocode/history',
      icon: 'HistoryOutlined',
      parentId: null,
      sort: 25,
      isVisible: 1,
      menuType: 2,
      permission: 'system:autocode:history',
    },
    // ── Tools > AutoCode Packages ──
    {
      name: '模板包',
      path: '/tools/autocode-packages',
      component: './autocode/packages',
      icon: 'AppstoreOutlined',
      parentId: null,
      sort: 28,
      isVisible: 1,
      menuType: 2,
      permission: 'system:autocode:packages',
    },
    // ── Tools > Export Templates ──
    {
      name: '导出模板',
      path: '/tools/export-templates',
      component: './export-templates/index',
      icon: 'ExportOutlined',
      parentId: null,
      sort: 30,
      isVisible: 1,
      menuType: 2,
      permission: 'system:export-template:list',
    },
    // ── Tools > BPM Designer ──
    {
      name: 'BPM设计器',
      path: '/tools/bpm-designer',
      component: './bpm/designer/index',
      icon: 'ApartmentOutlined',
      parentId: null,
      sort: 35,
      isVisible: 1,
      menuType: 2,
      permission: 'bpm:designer:list',
    },
    // ── Tools > BPM Manager ──
    {
      name: 'BPM流程管理',
      path: '/tools/bpm-manager',
      component: './bpm/manager/index',
      icon: 'BranchesOutlined',
      parentId: null,
      sort: 38,
      isVisible: 1,
      menuType: 2,
      permission: 'bpm:manager:list',
    },
    // ── Tools > BPM Resolution Rules ──
    {
      name: 'BPM审批规则',
      path: '/tools/bpm-rules',
      component: './bpm/rules/index',
      icon: 'RuleOutlined',
      parentId: null,
      sort: 41,
      isVisible: 1,
      menuType: 2,
      permission: 'bpm:rules:list',
    },
    // ── Tools > Versions ──
    {
      name: '版本管理',
      path: '/tools/versions',
      component: './versions/index',
      icon: 'BranchesOutlined',
      parentId: null,
      sort: 40,
      isVisible: 1,
      menuType: 2,
      permission: 'system:version:list',
    },
    // ── Tools > Authority Buttons ──
    {
      name: '按钮权限',
      path: '/tools/authority-btns',
      component: './authority-btns/index',
      icon: 'BlockOutlined',
      parentId: null,
      sort: 50,
      isVisible: 1,
      menuType: 2,
      permission: 'system:authority-btn:list',
    },
    // ── Tools > API Tokens ──
    {
      name: 'API令牌',
      path: '/tools/api-tokens',
      component: './api-tokens/index',
      icon: 'KeyOutlined',
      parentId: null,
      sort: 60,
      isVisible: 1,
      menuType: 2,
      permission: 'system:api-token:list',
    },
    // ── Tools > Encoding Rules ──
    {
      name: '编码规则管理',
      path: '/tools/encoding-rules',
      component: './encoding-rules/index',
      icon: 'BarcodeOutlined',
      parentId: null,
      sort: 70,
      isVisible: 1,
      menuType: 2,
      permission: 'tools:encoding-rule:list',
    },
    // ── Tools > Reserved Names ──
    {
      name: '保留名管理',
      path: '/tools/reserved-names',
      component: './autocode/reserved-names',
      icon: 'SafetyOutlined',
      parentId: null,
      sort: 80,
      isVisible: 1,
      menuType: 2,
      permission: 'tools:reserved-names:list',
    },
    // ── Monitoring (directory) ──
    {
      name: '系统监控',
      path: '/monitor',
      component: null,
      icon: 'MonitorOutlined',
      parentId: null,
      sort: 3,
      isVisible: 1,
      menuType: 1, // Directory
      permission: null,
    },
    // ── Monitor > Operation Logs ──
    {
      name: '操作日志',
      path: '/monitor/operation-records',
      component: './operation-records/index',
      icon: 'FileTextOutlined',
      parentId: null,
      sort: 10,
      isVisible: 1,
      menuType: 2,
      permission: 'system:operation-log:list',
    },
    // ── Monitor > Login Logs ──
    {
      name: '登录日志',
      path: '/monitor/login-logs',
      component: './login-logs/index',
      icon: 'SecurityScanOutlined',
      parentId: null,
      sort: 20,
      isVisible: 1,
      menuType: 2,
      permission: 'system:login-log:list',
    },
    // ── Monitor > Error Logs ──
    {
      name: '错误日志',
      path: '/monitor/errors',
      component: './errors/index',
      icon: 'WarningOutlined',
      parentId: null,
      sort: 30,
      isVisible: 1,
      menuType: 2,
      permission: 'system:error:list',
    },
    // ── Profile (avatar dropdown / sidebar) ──
    {
      name: '个人中心',
      path: '/profile',
      component: './profile/index',
      icon: 'IdcardOutlined',
      parentId: null,
      sort: 99,
      isVisible: 1,
      menuType: 2,
      permission: null,
    },
    // ── About ──
    {
      name: '关于',
      path: '/about',
      component: './about/index',
      icon: 'InfoCircleOutlined',
      parentId: null,
      sort: 100,
      isVisible: 1,
      menuType: 2,
      permission: null,
    },
  ];

  // Insert parent menus first (directories and menus), track their IDs
  const parentMap = new Map<string, string>(); // name -> id

  for (const menu of menuTree) {
    // Check existence first — onConflictDoNothing() targets the PK (uuid) which is
    // always new, so it never fires. Use path (or name for buttons) as the real key.
    const lookupCond = menu.path
      ? and(eq(sysMenus.path, menu.path), isNull(sysMenus.deletedAt))
      : and(eq(sysMenus.name, menu.name!), isNull(sysMenus.deletedAt));
    const existing = await db
      .select({ id: sysMenus.id })
      .from(sysMenus)
      .where(lookupCond)
      .limit(1);

    if (existing.length > 0) {
      parentMap.set(menu.name!, existing[0]!.id);
    } else {
      const result = await db
        .insert(sysMenus)
        .values(menu)
        .returning({ id: sysMenus.id });
      if (result.length > 0) {
        parentMap.set(menu.name!, result[0]!.id);
      }
    }
  }

  // Now update parentId relationships
  const parentRelations: Record<string, string> = {
    // System Management children
    '用户管理': '系统管理',
    '创建用户': '用户管理',
    '编辑用户': '用户管理',
    '删除用户': '用户管理',
    '组织管理': '系统管理',
    '员工管理': '系统管理',
    '角色管理': '系统管理',
    '创建角色': '角色管理',
    '编辑角色': '角色管理',
    '删除角色': '角色管理',
    '菜单管理': '系统管理',
    '创建菜单': '菜单管理',
    '编辑菜单': '菜单管理',
    '删除菜单': '菜单管理',
    'API管理': '系统管理',
    '系统参数': '系统管理',
    '字典管理': '系统管理',
    'JWT黑名单': '系统管理',
    '系统配置': '系统管理',
    '系统初始化': '系统管理',
    // System Tools children
    '文件管理': '系统工具',
    '代码生成器': '系统工具',
    '生成历史': '系统工具',
    '模板包': '系统工具',
    '导出模板': '系统工具',
    'BPM设计器': '系统工具',
    'BPM流程管理': '系统工具',
    'BPM审批规则': '系统工具',
    '版本管理': '系统工具',
    '按钮权限': '系统工具',
    'API令牌': '系统工具',
    '编码规则管理': '系统工具',
    '保留名管理': '系统工具',
    // Monitoring children
    '操作日志': '系统监控',
    '登录日志': '系统监控',
    '错误日志': '系统监控',
  };

  for (const [childName, parentName] of Object.entries(parentRelations)) {
    const childId = parentMap.get(childName);
    const parentId = parentMap.get(parentName);
    if (childId && parentId) {
      await db
        .update(sysMenus)
        .set({ parentId })
        .where(eq(sysMenus.id, childId));
    }
  }

  console.log('[seed] menus seeded with hierarchy');
}

async function seedRoleMenus(db: ReturnType<typeof createDb>): Promise<void> {
  // Assign all visible menus to super_admin role
  const superAdminRole = await db
    .select({ id: sysRoles.id })
    .from(sysRoles)
    .where(eq(sysRoles.code, RoleCode.SUPER_ADMIN))
    .limit(1);

  if (superAdminRole.length === 0) {
    console.log('[seed] super_admin role not found, skipping role-menus seed');
    return;
  }

  const allMenus = await db
    .select({ id: sysMenus.id })
    .from(sysMenus)
    .where(isNull(sysMenus.deletedAt));

  if (allMenus.length === 0) {
    console.log('[seed] no menus found, skipping role-menus seed');
    return;
  }

  const roleId = superAdminRole[0].id;

  // Insert role-menu associations (skip if already exist)
  for (const menu of allMenus) {
    await db
      .insert(sysRoleMenus)
      .values({ roleId, menuId: menu.id })
      .onConflictDoNothing();
  }

  console.log(`[seed] role-menus: assigned ${allMenus.length} menus to super_admin`);
}

async function seedAdminUserRoles(db: ReturnType<typeof createDb>): Promise<void> {
  const adminUsers = await db
    .select({ id: sysUsers.id })
    .from(sysUsers)
    .where(eq(sysUsers.username, 'admin'))
    .limit(1);

  if (adminUsers.length === 0) {
    console.log('[seed] admin user not found, skipping user-roles seed');
    return;
  }

  const superAdminRoles = await db
    .select({ id: sysRoles.id })
    .from(sysRoles)
    .where(eq(sysRoles.code, RoleCode.SUPER_ADMIN))
    .limit(1);

  if (superAdminRoles.length === 0) {
    console.log('[seed] super_admin role not found, skipping user-roles seed');
    return;
  }

  await db
    .insert(sysUserRoles)
    .values({
      userId: adminUsers[0].id,
      roleId: superAdminRoles[0].id,
    })
    .onConflictDoNothing();

  console.log('[seed] admin user-roles seeded');
}

async function seedEncodingRules(db: ReturnType<typeof createDb>): Promise<void> {
  const existing = await db
    .select({ id: sysEncodingRules.id })
    .from(sysEncodingRules)
    .where(eq(sysEncodingRules.name, '默认学号规则'))
    .limit(1);

  if (existing.length > 0) {
    console.log('[seed] encoding rule already exists, skipping');
    return;
  }

  await db.insert(sysEncodingRules).values({
    name: '默认学号规则',
    prefix: 'STU',
    dateFormat: 'yyyyMMdd',
    separator: '-',
    sequenceDigits: 4,
    paddingChar: '0',
    resetCycle: 'yearly',
  });

  console.log('[seed] example encoding rule created');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is required');
  }

  const db = createDb(databaseUrl);

  try {
    await ensureTables(db);
    await seedAdmin(db);
    await seedRoles(db);
    await seedMenus(db);
    await seedRoleMenus(db);
    // This block runs independently — outside any early-return guard for admin user creation
    await seedAdminUserRoles(db);
    await seedEncodingRules(db);
    console.log('[seed] completed');
  } finally {
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
