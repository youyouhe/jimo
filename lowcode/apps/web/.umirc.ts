import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {},
  access: {},
  model: {},
  initialState: {},
  // Error boundaries are class components; esbuild's minifier can emit
  // conflicting class helpers across the main bundle and async page chunks.
  // IIFE-wrapping each chunk prevents the name collision.
  esbuildMinifyIIFE: true,
  layout: {
    title: 'LowCode Admin',
  },
  request: {},
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: './login/index', layout: false },
    // ── Dashboard ──
    {
      path: '/dashboard',
      name: '仪表盘',
      icon: 'DashboardOutlined',
      component: './dashboard/index',
    },
    // ── System Management (directory) ──
    {
      path: '/system',
      name: '系统管理',
      icon: 'SettingOutlined',
      routes: [
        { path: '/system/users', name: '用户管理', icon: 'TeamOutlined', component: './users/index' },
        { path: '/system/roles', name: '角色管理', icon: 'SafetyCertificateOutlined', component: './roles/index' },
        { path: '/system/menus', name: '菜单管理', icon: 'MenuOutlined', component: './menus/index' },
        { path: '/system/apis', name: 'API管理', icon: 'ApiOutlined', component: './apis/index' },
        { path: '/system/parameters', name: '系统参数', icon: 'SlidersOutlined', component: './parameters/index' },
        { path: '/system/dictionary', name: '字典管理', icon: 'BookOutlined', component: './dictionary/index' },
        { path: '/system/jwt-blacklist', name: 'JWT黑名单', icon: 'StopOutlined', component: './jwt-blacklist/index' },
        { path: '/system/config', name: '系统配置', icon: 'ControlOutlined', component: './system/index' },
        { path: '/system/init', name: '系统初始化', icon: 'ThunderboltOutlined', component: './init/index' },
      ],
    },
    // ── System Tools (directory) ──
    {
      path: '/tools',
      name: '系统工具',
      icon: 'ToolOutlined',
      routes: [
        { path: '/tools/files', name: '文件管理', icon: 'FileOutlined', component: './files/index' },
        { path: '/tools/autocode', name: '代码生成器', icon: 'CodeOutlined', component: './autocode/index' },
        { path: '/tools/autocode-history', name: '生成历史', icon: 'HistoryOutlined', component: './autocode/history' },
        { path: '/tools/autocode-packages', name: '模板包', icon: 'AppstoreOutlined', component: './autocode/packages' },
        { path: '/tools/export-templates', name: '导出模板', icon: 'ExportOutlined', component: './export-templates/index' },
        { path: '/tools/versions', name: '版本管理', icon: 'BranchesOutlined', component: './versions/index' },
        { path: '/tools/authority-btns', name: '按钮权限', icon: 'BlockOutlined', component: './authority-btns/index' },
        { path: '/tools/api-tokens', name: 'API令牌', icon: 'KeyOutlined', component: './api-tokens/index' },
        { path: '/tools/encoding-rules', name: '编码规则管理', icon: 'BarcodeOutlined', component: './encoding-rules/index' },
      ],
    },
    // ── Monitoring (directory) ──
    {
      path: '/monitor',
      name: '系统监控',
      icon: 'MonitorOutlined',
      routes: [
        { path: '/monitor/operation-records', name: '操作日志', icon: 'AuditOutlined', component: './operation-records/index' },
        { path: '/monitor/login-logs', name: '登录日志', icon: 'SecurityScanOutlined', component: './login-logs/index' },
        { path: '/monitor/errors', name: '错误日志', icon: 'WarningOutlined', component: './errors/index' },
      ],
    },
    // ── Profile ──
    {
      path: '/profile',
      name: '个人中心',
      icon: 'IdcardOutlined',
      component: './profile/index',
    },
    {
      path: '/about',
      name: '关于',
      icon: 'InfoCircleOutlined',
      component: './about/index',
    },
    // Generated business module routes are added by updateUmiRoutes() at
    // code-generation time.  patchClientRoutes filters them at runtime
    // against the DB menu tree for role-based access control.
    {
      path: '/lc/suppliers',
      name: '供应商（类型1：独立业务表示例）',
      icon: 'TableOutlined',
      component: './suppliers/index',
    },
    {
      path: '/lc/purchase-orders',
      name: '采购订单（类型2：主表+子表示例）',
      icon: 'TableOutlined',
      component: './purchase-orders/index',
    },
    {
      path: '/lc/training-courses',
      name: '培训课程（类型3：三层嵌套示例）',
      icon: 'TableOutlined',
      component: './training-courses/index',
    },
    {
      path: '/lc/departments',
      name: '部门表（为类型4挂载已有表准备）',
      icon: 'TableOutlined',
      component: './departments/index',
    },
    {
      path: '/lc/students',
      name: '学生表（为类型5 M:N准备）',
      icon: 'TableOutlined',
      component: './students/index',
    },
    {
      path: '/lc/clubs',
      name: '社团表（为类型5 M:N准备）',
      icon: 'TableOutlined',
      component: './clubs/index',
    },
    {
      path: '/lc/project-tasks',
      name: '项目任务表（类型4准备：含 project_id FK，后续被 projects 挂载）',
      icon: 'TableOutlined',
      component: './project-tasks/index',
    },
    {
      path: '/lc/student-clubs',
      name: '学生社团关联表（类型5 M:N中间表）',
      icon: 'TableOutlined',
      component: './student-clubs/index',
    },
    {
      path: '/lc/projects',
      name: '项目表（类型4：挂载已有表示例 - 用 existing 模式挂 project_tasks）',
      icon: 'TableOutlined',
      component: './projects/index',
    },
    {
      path: '/lc/companies',
      name: '公司',
      icon: 'TableOutlined',
      component: './companies/index',
    },
    {
      path: '/lc/policies',
      name: '制度',
      icon: 'TableOutlined',
      component: './policies/index',
    },
    {
      path: '/lc/policy-details',
      name: '制度明细',
      icon: 'TableOutlined',
      component: './policy-details/index',
    },
    {
      path: '/lc/bills',
      name: '账单',
      icon: 'TableOutlined',
      component: './bills/index',
    },
    { path: '/*', redirect: '/dashboard' },
  ],
  proxy: {
    '/api': {
      target: 'http://localhost:8888',
      changeOrigin: true,
    },
  },
  npmClient: 'pnpm',
});
