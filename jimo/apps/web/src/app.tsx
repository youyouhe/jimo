import React from 'react';

const JimoLogo: React.FC = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* top bar */}
    <circle cx="13" cy="4"  r="2.5" fill="#4CC9F0"/>
    <circle cx="20" cy="4"  r="2.5" fill="#4CC9F0"/>
    <circle cx="27" cy="4"  r="2.5" fill="#F72585"/>
    {/* right stem */}
    <circle cx="27" cy="11" r="2.5" fill="#4CC9F0"/>
    <circle cx="27" cy="18" r="2.5" fill="#4CC9F0"/>
    {/* bottom curve */}
    <circle cx="6"  cy="25" r="2.5" fill="#7209B7"/>
    <circle cx="13" cy="25" r="2.5" fill="#7209B7"/>
    <circle cx="20" cy="25" r="2.5" fill="#7209B7"/>
    <circle cx="27" cy="25" r="2.5" fill="#4CC9F0"/>
  </svg>
);

// Suppress findDOMNode deprecation warning from rc-align (antd internal dep).
// rc-align@4.x bundles an old rc-util that still calls findDOMNode.
// Remove once antd upgrades rc-align to a version that drops findDOMNode.
if (process.env.NODE_ENV === 'development') {
  const _warn = console.warn.bind(console);
  console.warn = (...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('findDOMNode')) return;
    _warn(...args);
  };
}
import { Dropdown } from 'antd';
import { LogoutOutlined, AppstoreOutlined, TableOutlined, FolderOutlined, UpOutlined, DownOutlined, IdcardOutlined, InfoCircleOutlined } from '@ant-design/icons';

const ICON_MAP: Record<string, React.ReactElement> = {
  AppstoreOutlined: React.createElement(AppstoreOutlined),
  TableOutlined: React.createElement(TableOutlined),
  FolderOutlined: React.createElement(FolderOutlined),
};

function resolveIconString(icon: string | undefined): React.ReactElement | undefined {
  if (!icon || typeof icon !== 'string') return undefined;
  return ICON_MAP[icon];
}
import { useUserStore } from '@/stores/user';
import { useTabsStore } from '@/stores/tabs';
import { getAccessibleMenus, type MenuItem } from '@/services/menu';
import { logout as logoutApi } from '@/services/auth';
import { history } from '@umijs/max';
import WorkspaceTabs from '@/components/WorkspaceTabs';

const HEADER_HIDDEN_KEY = 'jimo_header_hidden';

function initHeaderState() {
  if (localStorage.getItem(HEADER_HIDDEN_KEY) === '1') {
    document.body.classList.add('jimo-header-hidden');
  }
}

// Apply on load immediately (before React mounts)
if (typeof window !== 'undefined') {
  initHeaderState();
  // Inject global CSS for header hide
  const style = document.createElement('style');
  style.textContent = `
    .jimo-header-hidden .ant-pro-layout-header,
    .jimo-header-hidden header.ant-layout-header {
      display: none !important;
    }
    .jimo-header-hidden .ant-pro-layout .ant-layout {
      padding-top: 0 !important;
    }
    .jimo-header-hidden .ant-pro-layout-content {
      margin-top: 0 !important;
    }
    .jimo-header-hidden .ant-pro-sider,
    .jimo-header-hidden .ant-layout-sider {
      top: 0 !important;
    }

    /* Lock the page to the viewport so window-level scroll never happens.
       Content pages scroll inside the WorkspaceTabs content area instead. */
    html, body, #root {
      height: 100%;
      overflow: hidden;
    }
    .ant-pro-layout,
    .ant-pro-layout > .ant-layout {
      height: 100% !important;
      overflow: hidden !important;
    }
    .ant-pro-layout-content,
    .ant-layout-content {
      overflow: hidden !important;
      height: 100% !important;
      min-height: 0 !important;
    }
  `;
  document.head.appendChild(style);
}

function toggleHeader() {
  const hidden = document.body.classList.toggle('jimo-header-hidden');
  localStorage.setItem(HEADER_HIDDEN_KEY, hidden ? '1' : '0');
  window.dispatchEvent(new Event('resize'));
  // Sync the standalone restore button visibility
  setTimeout(() => syncRestoreButton(), 0);
}

// Standalone restore button — mounted directly to document.body via a portal div
// so it stays visible even when the header (and its actionsRender) is hidden.
function mountRestoreButton() {
  let el = document.getElementById('jimo-header-restore');
  if (!el) {
    el = document.createElement('div');
    el.id = 'jimo-header-restore';
    el.style.cssText = `
      position: fixed; top: 0; left: 50%; transform: translateX(-50%);
      z-index: 9999; display: none;
    `;
    el.innerHTML = `<button title="显示顶部栏" style="
      width:48px;height:16px;border:1px solid #d9d9d9;border-top:none;
      border-radius:0 0 8px 8px;background:#fff;cursor:pointer;
      display:flex;align-items:center;justify-content:center;padding:0;
      box-shadow:0 2px 6px rgba(0,0,0,0.15);font-size:8px;color:#666;
    ">▼</button>`;
    el.querySelector('button')!.addEventListener('click', () => {
      toggleHeader();
      syncRestoreButton();
    });
    document.body.appendChild(el);
  }
  return el;
}

function syncRestoreButton() {
  const el = mountRestoreButton();
  el.style.display = document.body.classList.contains('jimo-header-hidden') ? 'block' : 'none';
}

// Init restore button after DOM ready
if (typeof window !== 'undefined') {
  const run = () => { mountRestoreButton(); syncRestoreButton(); };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}

function HeaderToggleButton() {
  return React.createElement(
    'button',
    {
      onClick: () => { toggleHeader(); },
      title: '隐藏顶部栏',
      style: {
        border: '1px solid #d9d9d9',
        borderRadius: 4,
        background: 'transparent',
        cursor: 'pointer',
        padding: '2px 6px',
        display: 'flex',
        alignItems: 'center',
        fontSize: 12,
        color: '#666',
      },
    },
    React.createElement(UpOutlined, { style: { fontSize: 10 } }),
  );
}

async function doLogout() {
  // Navigate away FIRST so page components unmount before user state changes.
  // Otherwise KeepAliveOutlet still renders DashboardPage which subscribes to
  // useUserStore — and a selector like `userInfo?.roles ?? []` creating a new
  // array on every render would trigger an infinite forceStoreRerender loop.
  history.push('/login');
  // Close all tabs so next user doesn't see previous user's pages
  useTabsStore.getState().closeAll();
  try {
    await logoutApi();
  } catch {
    // swallow API errors — still clear local state
  }
  useUserStore.getState().clearUser();
}

export const layout = ({ initialState }: { initialState: any }) => ({
  layout: 'mix',
  logo: React.createElement(JimoLogo),
  avatarProps: {
    src: 'https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png',
    title: '',
    size: 'small' as const,
    render: (_props: any, _defaultDom: React.ReactNode) => {
      const { userInfo } = useUserStore.getState();
      const displayName = userInfo?.nickname || userInfo?.username || '';
      return React.createElement(
        Dropdown,
        {
          menu: {
            items: [
              {
                key: 'profile',
                icon: React.createElement(IdcardOutlined),
                label: '个人中心',
                onClick: () => history.push('/profile'),
              },
              {
                key: 'about',
                icon: React.createElement(InfoCircleOutlined),
                label: '关于',
                onClick: () => history.push('/about'),
              },
              { type: 'divider' as const },
              {
                key: 'logout',
                icon: React.createElement(LogoutOutlined),
                label: '退出登录',
                onClick: doLogout,
              },
            ],
          },
        },
        React.createElement(
          'span',
          { style: { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('img', {
            src: 'data:image/svg+xml;base64,' +
              'PHN2ZyB3aWR0aD0iMjgiIGhlaWdodD0iMjgiIHZpZXdCb3g9IjAgMCAyOCAyOCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPGNpcmNsZSBjeD0iMTQiIGN5PSIxNCIgcj0iMTQiIGZpbGw9IiMxNjc3ZmYiLz4KPGNpcmNsZSBjeD0iMTQiIGN5PSIxMCIgcj0iNCIgZmlsbD0id2hpdGUiIG9wYWNpdHk9IjAuOSIvPgo8ZWxsaXBzZSBjeD0iMTQiIGN5PSIyMiIgcng9IjgiIHJ5PSI2IiBmaWxsPSJ3aGl0ZSIgb3BhY2l0eT0iMC45Ii8+Cjwvc3ZnPg==',
            alt: 'avatar',
            style: { width: 28, height: 28, borderRadius: '50%', flexShrink: 0 },
          }),
          React.createElement('span', null, displayName),
        ),
      );
    },
  },
  rightContentRender: false,
  actionsRender: () => [React.createElement(HeaderToggleButton, { key: 'header-toggle' })],
  // Take over the content area: render the multi-tab workspace (tab strip +
  // KeepAlive page cache) instead of Umi's default `<Outlet/>`. Navigation still
  // flows through Umi (history/location); pages are rendered from the route
  // registry so each opened tab stays mounted and preserves its state.
  childrenRender: () => <WorkspaceTabs />,
});

export interface InitialState {
  name?: string;
  avatar?: string;
  currentUser: {
    id: string; username: string; nickname: string; status: number; roles?: string[];
  } | null;
  menus: MenuItem[];
}

function isTokenExpired(token: string | null): boolean {
  if (!token) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!));
    return Date.now() / 1000 > (payload.exp as number) - 30;
  } catch {
    return true;
  }
}

export async function getInitialState(): Promise<InitialState> {
  const { isLoggedIn, userInfo, accessToken, refreshToken } = useUserStore.getState();

  const bothTokensExpired = isTokenExpired(accessToken) && isTokenExpired(refreshToken);
  if (!isLoggedIn || !userInfo || bothTokensExpired) {
    if (bothTokensExpired) {
      useUserStore.getState().clearUser();
    }
    if (window.location.pathname !== '/login') {
      history.push('/login');
    }
    return { currentUser: null, menus: [] };
  }

  let menus: MenuItem[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      menus = await getAccessibleMenus();
      useUserStore.getState().setMenuTree(menus);
      break;
    } catch {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }

  return {
    name: userInfo.nickname || userInfo.username,
    avatar: undefined as string | undefined,
    currentUser: userInfo,
    menus,
  };
}

/**
 * Collect all leaf paths from a menu tree (recursive).
 * Used only by the fallback filter path.
 */
function collectMenuPaths(menuList: MenuItem[]): Set<string> {
  const paths = new Set<string>();
  for (const item of menuList) {
    if (item.path) paths.add(item.path);
    if (item.children?.length) {
      for (const p of collectMenuPaths(item.children)) {
        paths.add(p);
      }
    }
  }
  return paths;
}

// Universal user-level pages always reachable regardless of role-menu assignments.
const ALWAYS_ALLOWED = new Set(['/', '/dashboard', '/profile', '/about', '/login']);
// Special routes absent from the DB menu tree — kept verbatim, never rebuilt.
const SPECIAL_PATHS = new Set(['/', '/login', '/*']);
// Stable id of the Umi layout root route (see .umi/core/route.tsx).
const LAYOUT_ROOT_ID = 'ant-design-pro-layout';

/**
 * Fallback: the original filter behavior. Used when route rebuilding fails so the
 * app never loses all routes. Keeps the layout root, special routes, and any leaf
 * that is always-allowed or present in the accessible menu paths.
 */
function fallbackFilterRoutes(routes: any[], accessiblePaths: Set<string>): any[] {
  const isAlwaysAllowed = (path: string) => ALWAYS_ALLOWED.has(path);

  const filterRoutes = (routeList: any[]): any[] =>
    routeList
      .map((r) => ({ ...r }))
      .filter((r: any) => {
        // Always keep the root layout route
        if (r.isLayout) {
          const kids = filterRoutes(r.routes || r.children || []);
          r.routes = kids;
          r.children = kids;
          return true;
        }
        // Always keep login (layout: false) and catch-all
        if (r.layout === false) return true;
        if (r.path === '/*') return true;

        // Directory route: keep only if it has surviving children
        if (r.routes || r.children) {
          const kids = filterRoutes(r.routes || r.children || []);
          if (kids.length > 0) {
            r.routes = kids;
            r.children = kids;
            return true;
          }
          return false;
        }

        // Leaf route: show if always-allowed OR in accessible menu paths
        return isAlwaysAllowed(r.path) || accessiblePaths.has(r.path);
      });

  return filterRoutes(routes);
}

/**
 * Flatten a nested route tree into a Map<path, routeObj> (shallow-copied so the
 * original component/lazy references are preserved). The .umirc.ts route tree is
 * the sole provider of route components; this map lets us look them up by path
 * when rebuilding the hierarchy from the DB menu tree.
 */
function flattenRouteTree(
  routeList: any[],
  out = new Map<string, any>(),
): Map<string, any> {
  for (const r of routeList) {
    if (typeof r.path === 'string' && r.path && !out.has(r.path)) {
      out.set(r.path, { ...r });
    }
    const kids = r.routes || r.children;
    if (Array.isArray(kids) && kids.length) {
      flattenRouteTree(kids, out);
    }
  }
  return out;
}

/** Find the Umi layout root route (by stable id, falling back to isLayout). */
function findLayoutRoot(routeList: any[]): any | null {
  for (const r of routeList) {
    if (r.id === LAYOUT_ROOT_ID || r.isLayout) return r;
    const kids = r.routes || r.children;
    if (Array.isArray(kids) && kids.length) {
      const found = findLayoutRoot(kids);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Rebuild a nested route tree from the DB menu tree, attaching the component (and
 * other fields) looked up by path from the flattened .umirc.ts route map. name/icon
 * are taken from the DB menu — it is the single source of truth for the sidebar
 * labels and hierarchy. Button menus (menuType=3) are skipped.
 */
function buildRouteTree(
  menuList: MenuItem[],
  routeMap: Map<string, any>,
  emptyComponent: any,
  parentRouteId: string = LAYOUT_ROOT_ID,
  visited: Set<string> = new Set(),
  seenPaths: Set<string> = new Set(),
): any[] {
  const sorted = [...menuList].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const result: any[] = [];

  for (const menu of sorted) {
    if (menu.id && visited.has(menu.id)) continue; // cycle guard
    if (menu.id) visited.add(menu.id);
    if (menu.menuType === 3) continue; // button — not a route

    // /pkg/* directories are runtime-created and never in .umirc.ts. Force synthesize
    // so they are always pathless in React Router (absolute-path children cannot be
    // nested under a path-bearing parent — React Router v6 invariant).
    const isPkgDir = menu.menuType === 1 && !!menu.path?.startsWith('/pkg/');
    const routeObj = (menu.path && !isPkgDir) ? routeMap.get(menu.path) : undefined;
    if (menu.path && !routeObj && menu.menuType !== 1) {
      console.warn(`[patchClientRoutes] no route for menu path=${menu.path}, skipped`);
      continue;
    }

    // A route path is globally unique. If the DB menu tree contains duplicate
    // rows for the same path (e.g. seed re-run), keep only the first occurrence.
    if (menu.path && seenPaths.has(menu.path)) continue;
    if (menu.path) seenPaths.add(menu.path);

    // This node's own id — passed as parentId to its children so Umi/ProLayout's
    // internal parent/child bookkeeping matches the routes/children tree we build.
    // (A missing/wrong parentId is what makes the sidebar render duplicate entries.)
    const nodeId = routeObj?.id || menu.id;
    const hasMenuChildren = !!menu.children?.length;
    const kids = hasMenuChildren
      ? buildRouteTree(menu.children, routeMap, emptyComponent, nodeId, visited, seenPaths)
      : undefined;

    // A pathless container directory whose children were all filtered out should
    // not appear as an empty sidebar entry. But a page node (has its own path)
    // must never be skipped just because its only children are buttons (menuType=3)
    // — those are permission markers, not sidebar items.
    if (!menu.path && hasMenuChildren && (!kids || kids.length === 0)) {
      continue;
    }

    let node: any;
    if (!routeObj) {
      // Container directory — synthesize a layout wrapper node WITHOUT a path.
      // React Router forbids absolute-path children nested under a path-bearing parent,
      // so directory nodes must be pathless. ProLayout uses `name`/`icon` for the sidebar.
      node = {
        name: menu.name,
        key: menu.id,
        path: menu.path ?? undefined,
        icon: resolveIconString(menu.icon ?? undefined),
        component: emptyComponent,
        id: nodeId,
        parentId: parentRouteId,
      };
    } else {
      // name from DB (eliminates label drift). icon/component/id preserved verbatim
      // from the Umi route object (icon is a resolved component ref — never overwrite
      // with the DB string). parentId points to the NEW parent so it agrees with the
      // routes/children tree (this is what prevents duplicate menu entries).
      node = { ...routeObj, name: menu.name, parentId: parentRouteId };
    }

    if (kids && kids.length) {
      node.routes = kids;
      node.children = kids;
    } else {
      delete node.routes;
      delete node.children;
    }
    result.push(node);
  }
  return result;
}

// Snapshot of the layout root's original children, captured on the first
// patchClientRoutes call. Umi may invoke patchClientRoutes more than once;
// always rebuild from this immutable snapshot so we never accumulate duplicates
// by re-flattening an already-rebuilt tree.
let originalChildrenSnapshot: any[] | null = null;

/**
 * patchClientRoutes — rebuilds the route tree at runtime from the DB menu tree so
 * the sidebar hierarchy reflects menu parent assignments and labels (DB is the
 * single source of truth). The .umirc.ts route tree is flattened into a
 * path→component map (it is now just a component provider). Special routes
 * (/, /login, /*) are preserved verbatim. If rebuilding fails, falls back to the
 * original filter behavior so the app never loses all routes.
 */
export function patchClientRoutes({ routes }: { routes: any[] }) {
  const { menuTree } = useUserStore.getState();
  if (!menuTree || menuTree.length === 0) return;

  try {
    const layoutRoot = findLayoutRoot(routes);
    if (!layoutRoot) return;

    if (!originalChildrenSnapshot) {
      const live = layoutRoot.routes || layoutRoot.children || [];
      originalChildrenSnapshot = live.map((c: any) => ({ ...c }));
    }
    const originalChildren = originalChildrenSnapshot;
    const routeMap = flattenRouteTree(originalChildren);

    // Grab the EmptyRoute component (used by container directories) from any
    // known directory route; falls back to null.
    const emptyComponent =
      routeMap.get('/system')?.component ||
      routeMap.get('/tools')?.component ||
      routeMap.get('/monitor')?.component ||
      null;

    const rebuilt = buildRouteTree(menuTree, routeMap, emptyComponent);

    // Diagnostic: surface the raw DB menu tree top-level so duplicate rows (e.g.
    // from a re-run seed) are visible. Safe to remove once verified stable.
    console.log(
      '[patchClientRoutes] menuTree top-level:',
      menuTree.map((m) => ({ id: m.id, path: m.path, name: m.name, menuType: m.menuType })),
    );

    // ALWAYS_ALLOWED backfill: ensure universal pages remain reachable even if
    // absent from the menu tree. Special routes are handled separately below.
    const rebuiltPaths = new Set(rebuilt.map((r) => r.path).filter(Boolean));
    for (const p of ALWAYS_ALLOWED) {
      if (rebuiltPaths.has(p) || SPECIAL_PATHS.has(p)) continue;
      const r = routeMap.get(p);
      if (r) rebuilt.push({ ...r });
    }

    // Special routes preserved verbatim, positioned to match .umirc.ts conventions:
    //   - '/' redirect and '/login' (layout:false) lead
    //   - '/*' catch-all trails everything (so it never shadows concrete routes)
    const leadSpecials = originalChildren
      .filter((c) => c.path === '/' || c.path === '/login')
      .map((c) => ({ ...c }));
    const trailingSpecials = originalChildren
      .filter((c) => c.path === '/*')
      .map((c) => ({ ...c }));

    const finalChildren = [...leadSpecials, ...rebuilt, ...trailingSpecials];
    if (finalChildren.length === 0) throw new Error('rebuilt route tree is empty');

    // Diagnostic: surface the rebuilt top-level children so any remaining
    // duplication can be traced. Safe to remove once verified stable.
    console.log(
      '[patchClientRoutes] finalChildren:',
      finalChildren.map((c) => ({
        path: c.path,
        id: c.id,
        parentId: c.parentId,
        kids: (c.routes || c.children)?.length || 0,
      })),
    );

    layoutRoot.routes = finalChildren;
    layoutRoot.children = finalChildren;
  } catch (err) {
    console.warn('[patchClientRoutes] rebuild failed, falling back to filter:', err);
    const accessiblePaths = collectMenuPaths(menuTree);
    const filtered = fallbackFilterRoutes(routes, accessiblePaths);
    routes.length = 0;
    routes.push(...filtered);
  }
}
