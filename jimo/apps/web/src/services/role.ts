import request from './request';

export interface Role {
  id: string;
  code: string;
  name: string;
  description: string | null;
  is_default: number;
  createdAt: string;
  updatedAt: string;
}

export interface RoleListParams {
  page?: number;
  pageSize?: number;
  code?: string;
  name?: string;
}

export interface RoleListResult {
  list: Role[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateRoleDto {
  code: string;
  name: string;
  description?: string;
  is_default?: number;
}

export interface UpdateRoleDto {
  name?: string;
  description?: string;
  is_default?: number;
}

export interface AssignRolesDto {
  userId: string;
  roleIds: string[];
}

/**
 * Get paginated role list.
 */
export async function getRoles(params?: RoleListParams): Promise<RoleListResult> {
  return request.get('/roles', { params });
}

/**
 * Get a single role by ID.
 */
export async function getRole(id: string): Promise<Role> {
  return request.get(`/roles/${id}`);
}

/**
 * Create a new role.
 */
export async function createRole(dto: CreateRoleDto): Promise<Role> {
  return request.post('/roles', dto);
}

/**
 * Update an existing role.
 */
export async function updateRole(id: string, dto: UpdateRoleDto): Promise<Role> {
  return request.patch(`/roles/${id}`, dto);
}

/**
 * Delete a role by ID.
 */
export async function deleteRole(id: string): Promise<void> {
  return request.delete(`/roles/${id}`);
}

/**
 * Assign roles to a user.
 */
export async function assignRoles(dto: AssignRolesDto): Promise<void> {
  return request.post('/roles/assign', dto);
}

/**
 * Get menu IDs assigned to a role.
 */
export async function getRoleMenus(roleId: string): Promise<string[]> {
  return request.get(`/roles/${roleId}/menus`);
}

/**
 * Set (replace) menus for a role.
 */
export async function setRoleMenus(roleId: string, menuIds: string[]): Promise<void> {
  return request.post(`/roles/${roleId}/menus`, { menuIds });
}
