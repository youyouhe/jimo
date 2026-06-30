import { defineConfig } from '@umijs/max';
import { generatedRoutes } from './src/generated-routes';

export default defineConfig({
  antd: {},
  access: {},
  model: {},
  initialState: {},
  // Error boundaries are class components; esbuild's minifier can emit
  // conflicting class helpers across the main bundle and async page chunks.
  // IIFE-wrapping each chunk prevents the name collision.
  esbuildMinifyIIFE: true,
  // Disable MFSU entirely — react-leaflet uses hooks and MFSU's module-federation
  // context causes React to be null when the component remounts inside ProTable,
  // giving "Cannot read properties of null (reading 'useState')".
  // mfsu: false tells Umi to use plain webpack without federation sharding.
  mfsu: false,
  layout: {
    title: 'Jimo',
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
        { path: '/system/departments', name: '部门管理', icon: 'ApartmentOutlined', component: './departments/index' },
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
        { path: '/tools/bpm-designer', name: 'BPM设计器', icon: 'ApartmentOutlined', component: './bpm/designer/index' },
        { path: '/tools/bpm-manager', name: 'BPM流程管理', icon: 'BranchesOutlined', component: './bpm/manager/index' },
        { path: '/tools/bpm-rules', name: 'BPM审批规则', icon: 'RuleOutlined', component: './bpm/rules' },
        { path: '/tools/versions', name: '版本管理', icon: 'BranchesOutlined', component: './versions/index' },
        { path: '/tools/authority-btns', name: '按钮权限', icon: 'BlockOutlined', component: './authority-btns/index' },
        { path: '/tools/api-tokens', name: 'API令牌', icon: 'KeyOutlined', component: './api-tokens/index' },
        { path: '/tools/encoding-rules', name: '编码规则管理', icon: 'BarcodeOutlined', component: './encoding-rules/index' },
        { path: '/tools/reserved-names', name: '保留名管理', icon: 'SafetyOutlined', component: './autocode/reserved-names' },
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
    {
      path: '/approvals',
      name: '流程中心',
      icon: 'AuditOutlined',
      component: './approvals/index',
    },
    // Generated business module routes — managed by autocode via src/generated-routes.ts.
    // patchClientRoutes() filters them at runtime against the DB menu tree for RBAC.
    ...generatedRoutes,
    { path: '/*', redirect: '/dashboard' },
  ],
  proxy: {
    '/api': {
      target: 'http://localhost:8888',
      changeOrigin: true,
    },
    // MinIO object storage — proxied so file URLs can be relative (/storage/...),
    // letting any client reach MinIO through the web dev port regardless of
    // whether the browser runs on localhost or a remote host.
    '/storage': {
      target: 'http://localhost:9000',
      changeOrigin: true,
      pathRewrite: { '^/storage': '' },
    },
  },
  npmClient: 'pnpm',
});
