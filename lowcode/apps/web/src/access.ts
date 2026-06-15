import type { InitialState } from './app';

export default function access(initialState: InitialState | undefined) {
  const role = initialState?.currentUser?.role ?? '';

  return {
    isSuperAdmin: role === 'super_admin',
    isAdmin: role === 'admin' || role === 'super_admin',
    isEditor: ['editor', 'admin', 'super_admin'].includes(role),
    isViewer: ['viewer', 'editor', 'admin', 'super_admin'].includes(role),
    canManageRoles: ['admin', 'super_admin'].includes(role),
    canManageMenus: ['admin', 'super_admin'].includes(role),
  };
}
