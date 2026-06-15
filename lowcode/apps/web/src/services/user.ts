import request from './request';

export interface UserInfo {
  id: string;
  username: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  role: string;
  status: number;
  lastLoginAt: string | null;
  lastLoginIp: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileDto {
  nickname?: string;
  email?: string;
  phone?: string;
  avatar?: string;
}

export interface ChangePasswordDto {
  oldPassword: string;
  newPassword: string;
}

/**
 * Get current user profile.
 */
export async function getProfile(): Promise<UserInfo> {
  return request.get('/users/profile');
}

/**
 * Update current user profile.
 */
export async function updateProfile(dto: UpdateProfileDto): Promise<UserInfo> {
  return request.patch('/users/profile', dto);
}

/**
 * Change current user password.
 */
export async function changePassword(dto: ChangePasswordDto): Promise<void> {
  return request.post('/users/change-password', dto);
}

// ---- User Management (Admin) ----

export type User = UserInfo;

export interface UserListParams {
  page?: number;
  pageSize?: number;
  username?: string;
  nickname?: string;
  phone?: string;
  email?: string;
  status?: number;
}

export interface UserListResult {
  list: User[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateUserDto {
  username: string;
  password: string;
  nickname: string;
  email?: string;
  phone?: string;
  role?: string;
  status?: number;
}

export interface UpdateUserDto {
  nickname?: string;
  email?: string | null;
  phone?: string | null;
  role?: string;
  roleIds?: string[];
  status?: number;
}

/**
 * Get paginated user list with optional filters.
 */
export async function getUsers(params?: UserListParams): Promise<UserListResult> {
  return request.get('/users', { params });
}

/**
 * Get a single user by ID.
 */
export async function getUser(id: string): Promise<User> {
  return request.get(`/users/${id}`);
}

/**
 * Create a new user.
 */
export async function createUser(dto: CreateUserDto): Promise<User> {
  return request.post('/users', dto);
}

/**
 * Update an existing user.
 */
export async function updateUser(id: string, dto: UpdateUserDto): Promise<User> {
  return request.patch(`/users/${id}`, dto);
}

/**
 * Soft delete a user by ID.
 */
export async function deleteUser(id: string): Promise<null> {
  return request.delete(`/users/${id}`);
}

/**
 * Get role IDs assigned to a user (from sys_user_roles).
 */
export async function getUserRoleIds(userId: string): Promise<string[]> {
  const roles: Array<{ id: string }> = await request.get(`/roles/${userId}/users-roles`);
  return (roles || []).map((r) => r.id);
}

/**
 * Set (replace) role assignments for a user.
 */
export async function assignUserRoles(userId: string, roleIds: string[]): Promise<void> {
  return request.post('/roles/assign', { userId, roleIds });
}
