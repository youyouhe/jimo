import type { InitialState } from './app';

export default function access(initialState: InitialState | undefined) {
  const roles = initialState?.currentUser?.roles ?? [];
  const has = (code: string) => roles.includes(code);

  return {
    isSuperAdmin: has('super_admin'),
    isAdmin: has('admin') || has('super_admin'),
    isEditor: has('editor') || has('admin') || has('super_admin'),
    isViewer: has('viewer') || has('editor') || has('admin') || has('super_admin'),
    canManageRoles: has('admin') || has('super_admin'),
    canManageMenus: has('admin') || has('super_admin'),
    canManageBpm: has('admin') || has('super_admin'),
  };
}
