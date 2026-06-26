import { toKebabCase } from './autocode-field-utils';

/**
 * 系统保留表名 —— autocode 业务表不得使用这些名字,否则其生成的前端页面/服务
 * 会覆盖平台自带的系统页面/服务(departments/users/roles...),删除时还会连坐删掉
 * 系统代码导致前端 crash(见 2026-06-23 departments 事故)。
 *
 * 存 kebab 形式;isReservedTableName() 会先把输入规范化为 kebab 再比对,
 * 因此 snake_case(如 jwt_blacklist)和 kebab-case(如 jwt-blacklist)输入都能命中。
 *
 * 维护规则:新增系统页面(src/pages/<name>/,对应非 /lc/ 前缀的路由)时,
 * 把其目录名(kebab)加入此清单。
 */
const RESERVED: Set<string> = new Set([
  'dashboard', 'login', 'users', 'roles', 'menus', 'apis', 'parameters',
  'dictionary', 'jwt-blacklist', 'system', 'init', 'departments', 'files',
  'autocode', 'export-templates', 'versions', 'authority-btns', 'api-tokens',
  'encoding-rules', 'operation-records', 'login-logs', 'errors', 'profile',
  'about', 'approvals',
]);

export const RESERVED_TABLE_NAMES: ReadonlySet<string> = RESERVED;

/** Add names to the live in-memory set (call after updating the file on disk). */
export function addToReservedNames(names: string[]): void {
  for (const n of names) RESERVED.add(n);
}

/** 判断表名是否为系统保留(内部转 kebab 后比对,兼容 snake/kebab 输入)。 */
export function isReservedTableName(name: string): boolean {
  if (!name) return false;
  return RESERVED.has(toKebabCase(name));
}
