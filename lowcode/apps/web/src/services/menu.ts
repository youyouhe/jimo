import request from './request';

export interface MenuItem {
  id: string;
  parentId: string | null;
  path: string | null;
  component: string | null;
  name: string;
  icon: string | null;
  sort: number;
  isVisible: number;
  permission: string | null;
  menuType: number;
  createdAt: string;
  updatedAt: string;
  children?: MenuItem[];
}

export interface MenuListParams {
  name?: string;
  menu_type?: number;
}

export interface CreateMenuDto {
  name: string;
  path?: string;
  component?: string;
  icon?: string;
  parent_id?: string;
  sort?: number;
  is_visible?: number;
  permission?: string;
  menu_type?: number;
}

export interface UpdateMenuDto {
  name?: string;
  path?: string | null;
  component?: string | null;
  icon?: string | null;
  parent_id?: string | null;
  sort?: number;
  is_visible?: number;
  permission?: string | null;
  menu_type?: number;
}

/**
 * Get accessible menus for the current authenticated user.
 * Returns a tree list of menus filtered by user role.
 */
export async function getAccessibleMenus(): Promise<MenuItem[]> {
  return request.get('/menus/accessible');
}

/**
 * Get the full menu tree (for admin management only).
 */
export async function getMenuTree(): Promise<MenuItem[]> {
  return request.get('/menus/tree');
}

/**
 * Get flat list of menus with optional filters.
 */
export async function getMenus(params?: MenuListParams): Promise<MenuItem[]> {
  return request.get('/menus', { params });
}

/**
 * Get a single menu by ID.
 */
export async function getMenu(id: string): Promise<MenuItem> {
  return request.get(`/menus/${id}`);
}

/**
 * Create a new menu item.
 */
export async function createMenu(dto: CreateMenuDto): Promise<MenuItem> {
  return request.post('/menus', dto);
}

/**
 * Update a menu item.
 */
export async function updateMenu(id: string, dto: UpdateMenuDto): Promise<MenuItem> {
  return request.patch(`/menus/${id}`, dto);
}

/**
 * Delete a menu item.
 */
export async function deleteMenu(id: string): Promise<null> {
  return request.delete(`/menus/${id}`);
}

/**
 * Sync all visible menu routes to .umirc.ts.
 */
export async function syncRoutesToUmirc(): Promise<{ updated: number }> {
  return request.post('/menus/sync-routes');
}
