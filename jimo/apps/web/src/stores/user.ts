import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { MenuItem } from '@/services/menu';

interface UserInfo {
  id: string;
  username: string;
  nickname: string;
  status: number;
  roles?: string[];
}

interface UserState {
  userInfo: UserInfo | null;
  accessToken: string | null;
  refreshToken: string | null;
  isLoggedIn: boolean;
  /** Persisted menu tree — used by patchClientRoutes to inject dynamic routes */
  menuTree: MenuItem[] | null;
  setUser: (user: UserInfo) => void;
  setTokens: (access: string, refresh: string) => void;
  clearUser: () => void;
  setMenuTree: (tree: MenuItem[]) => void;
  refreshMenus: () => Promise<void>;
}

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      userInfo: null,
      accessToken: null,
      refreshToken: null,
      isLoggedIn: false,
      menuTree: null,
      setUser: (user) => set({ userInfo: user, isLoggedIn: true }),
      setTokens: (access, refresh) => set({ accessToken: access, refreshToken: refresh }),
      clearUser: () =>
        set({
          userInfo: null,
          accessToken: null,
          refreshToken: null,
          isLoggedIn: false,
          menuTree: null,
        }),
      setMenuTree: (tree) => set({ menuTree: tree }),
      refreshMenus: async () => {
        try {
          const { getAccessibleMenus } = await import('@/services/menu');
          const menus = await getAccessibleMenus();
          set({ menuTree: menus });
        } catch {
          // Silently ignore — stale tree is better than none
        }
      },
    }),
    {
      name: 'jimo-user-store',
      // Only persist menuTree alongside the existing fields
      partialize: (state) => ({
        userInfo: state.userInfo,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isLoggedIn: state.isLoggedIn,
        menuTree: state.menuTree,
      }),
    },
  ),
);
