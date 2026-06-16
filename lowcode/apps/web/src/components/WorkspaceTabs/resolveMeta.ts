import { useUserStore } from '@/stores/user';
import type { MenuItem } from '@/services/menu';

export interface RouteMeta {
  title: string;
  icon?: string;
}

/** Pages that exist outside the DB menu tree but must always be reachable. */
const STATIC_META: Record<string, RouteMeta> = {
  '/dashboard': { title: '仪表盘', icon: 'DashboardOutlined' },
  '/profile': { title: '个人中心', icon: 'IdcardOutlined' },
  '/about': { title: '关于', icon: 'InfoCircleOutlined' },
};

/** Recursively find the first menu node whose path matches. */
function findMenuByPath(menus: MenuItem[] | null | undefined, path: string): MenuItem | null {
  if (!menus) return null;
  for (const m of menus) {
    if (m.path === path) return m;
    const child = findMenuByPath(m.children, path);
    if (child) return child;
  }
  return null;
}

/** Turn a trailing path segment into a readable title (e.g. /lc/students → Students). */
function titleFromPath(path: string): string {
  const seg = path.split('/').filter(Boolean).pop() ?? path;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/**
 * Resolve a tab's title + icon for a route path.
 *
 * Order of preference:
 *   1. DB menu tree (single source of truth for names/labels)
 *   2. static always-allowed pages
 *   3. derived from the trailing path segment
 */
export function resolveRouteMeta(path: string): RouteMeta {
  const menu = findMenuByPath(useUserStore.getState().menuTree, path);
  if (menu) {
    return { title: menu.name, icon: menu.icon ?? undefined };
  }
  const stat = STATIC_META[path];
  if (stat) return stat;
  return { title: titleFromPath(path) };
}
