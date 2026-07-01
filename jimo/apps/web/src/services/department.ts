import request from './request';

// Backed by the persistent sys_departments table (native system entity).
export interface Department {
  id: string;
  name: string;
  code: string;
  description: string | null;
  parentId: string | null;
  leadId: string | null;
  // joined display fields from the backend
  parent_id_display: string | null;
  lead_display: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface DepartmentListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  code?: string;
}

export interface DepartmentListResult {
  list: Department[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateDepartmentDto {
  name: string;
  code: string;
  description?: string;
  parentId?: string | null;
  leadId?: string | null;
}

export interface UpdateDepartmentDto {
  name?: string;
  code?: string;
  description?: string;
  parentId?: string | null;
  leadId?: string | null;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated departments list.
 */
export async function getDepartmentsList(params?: DepartmentListParams): Promise<DepartmentListResult> {
  return request.get('/departments', { params });
}

/**
 * Get a single department by ID.
 */
export async function getDepartment(id: string): Promise<Department> {
  return request.get(`/departments/${id}`);
}

/**
 * Create a new department.
 */
export async function createDepartment(dto: CreateDepartmentDto): Promise<Department> {
  return request.post('/departments', dto);
}

/**
 * Update an existing department.
 */
export async function updateDepartment(id: string, dto: UpdateDepartmentDto): Promise<Department> {
  return request.patch(`/departments/${id}`, dto);
}

/**
 * Delete a department by ID (soft delete).
 */
export async function deleteDepartment(id: string): Promise<void> {
  return request.delete(`/departments/${id}`);
}

/**
 * Batch delete departments by IDs (soft delete). Returns { count: number }.
 */
export async function batchDeleteDepartments(ids: string[]): Promise<{ count: number }> {
  return request.delete('/departments/batch', { data: { ids } });
}

/**
 * Get department options for select dropdowns (parent picker).
 */
export interface DepartmentTreeNode extends Department {
  children?: DepartmentTreeNode[];
}

export async function getDepartmentTree(): Promise<DepartmentTreeNode[]> {
  return request.get('/departments/tree');
}

export async function getDepartmentOptions(): Promise<DepartmentOption[]> {
  return request.get('/departments/options');
}
