import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The pinned home tab — never closable. */
export const HOME_PATH = '/dashboard';

export interface TabItem {
  /** Route path — also the unique tab key. */
  path: string;
  /** Display title (resolved from menu tree / static map). */
  title: string;
  /** Optional icon name (e.g. 'DashboardOutlined'); rendered via iconMap if known. */
  icon?: string;
  /** Pinned tabs (HOME) cannot be closed. */
  closable: boolean;
}

interface OpenTabInput {
  path: string;
  title: string;
  icon?: string;
}

interface TabsState {
  tabs: TabItem[];
  /** The currently active tab's path. */
  activeKey: string;
  /** path → refresh counter; bumping remounts just that page (used by "刷新"). */
  refreshKeys: Record<string, number>;

  /** Open (or activate) a tab for the given path. */
  openTab: (input: OpenTabInput) => void;
  /** Set the active tab. */
  setActive: (path: string) => void;
  /**
   * Close a tab. Returns the path that should become active (the previous
   * neighbour, or HOME if none) — the caller navigates to it when the closed
   * tab was active. Returns empty string if the active tab did not change.
   */
  closeTab: (path: string) => string;
  /** Close every tab except `keep` and HOME. */
  closeOthers: (keep: string) => void;
  /**
   * Close all tabs except HOME. Returns HOME so the caller can navigate.
   */
  closeAll: () => string;
  /** Bump the refresh counter for a path → remount that page only. */
  refreshTab: (path: string) => void;
  /** Drop tabs whose path isn't in `validPaths`; always keep HOME. */
  sanitize: (validPaths: Set<string>) => void;
}

const HOME_TAB: TabItem = {
  path: HOME_PATH,
  title: '仪表盘',
  icon: 'DashboardOutlined',
  closable: false,
};

export const useTabsStore = create<TabsState>()(
  persist(
    (set, get) => ({
      tabs: [HOME_TAB],
      activeKey: HOME_PATH,
      refreshKeys: {},

      openTab: ({ path, title, icon }) => {
        const { tabs } = get();
        const existing = tabs.find((t) => t.path === path);
        if (existing) {
          if (get().activeKey !== path) set({ activeKey: path });
          return;
        }
        set({
          tabs: [
            ...tabs,
            { path, title, icon, closable: path !== HOME_PATH },
          ],
          activeKey: path,
        });
      },

      setActive: (path) => {
        if (get().activeKey !== path) set({ activeKey: path });
      },

      closeTab: (path) => {
        const { tabs, activeKey } = get();
        const idx = tabs.findIndex((t) => t.path === path);
        if (idx === -1) return '';
        // HOME is pinned — refuse.
        if (path === HOME_PATH) return '';
        const next = tabs.filter((t) => t.path !== path);
        set({ tabs: next });
        if (activeKey === path) {
          // activate the previous neighbour, else HOME
          const neighbour = next[idx - 1] ?? next[idx] ?? HOME_TAB;
          set({ activeKey: neighbour.path });
          return neighbour.path;
        }
        return '';
      },

      closeOthers: (keep) => {
        const { tabs } = get();
        const next = tabs.filter(
          (t) => t.path === keep || t.path === HOME_PATH,
        );
        // Ensure HOME is always present.
        if (!next.find((t) => t.path === HOME_PATH)) next.unshift(HOME_TAB);
        set({ tabs: next, activeKey: keep });
      },

      closeAll: () => {
        set({ tabs: [HOME_TAB], activeKey: HOME_PATH });
        return HOME_PATH;
      },

      refreshTab: (path) => {
        const { refreshKeys } = get();
        set({ refreshKeys: { ...refreshKeys, [path]: (refreshKeys[path] ?? 0) + 1 } });
      },

      sanitize: (validPaths) => {
        const { tabs } = get();
        const next = tabs.filter((t) => t.path === HOME_PATH || validPaths.has(t.path));
        if (!next.find((t) => t.path === HOME_PATH)) next.unshift(HOME_TAB);
        const activeKey = next.find((t) => t.path === get().activeKey)
          ? get().activeKey
          : HOME_PATH;
        set({ tabs: next, activeKey });
      },
    }),
    {
      name: 'lowcode-tabs-store',
      // Persist open tabs + active key so they survive a page refresh.
      // refreshKeys are intentionally NOT persisted (a refresh should not carry over).
      partialize: (state) => ({
        tabs: state.tabs,
        activeKey: state.activeKey,
      }),
    },
  ),
);
