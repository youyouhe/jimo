import request from './request';

export interface Department {
  id: string;
  name: string;
  manager_name: string | null;
  phone: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DepartmentListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    manager_name?: string;
}

export interface DepartmentListResult {
  list: Department[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateDepartmentDto {
    name: string;
    manager_name?: string;
    phone?: string;
    description?: string;
}

export interface UpdateDepartmentDto {
    name?: string;
    manager_name?: string;
    phone?: string;
    description?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated departments list.
 */
export async function getDepartmentsList(params?: DepartmentListParams): Promise<DepartmentListResult> {
  return request.get('/lc/departments', { params });
}

/**
 * Get a single department by ID.
 */
export async function getDepartment(id: string): Promise<Department> {
  return request.get(`/lc/departments/${id}`);
}

/**
 * Create a new department.
 */
export async function createDepartment(dto: CreateDepartmentDto): Promise<Department> {
  return request.post('/lc/departments', dto);
}

/**
 * Update an existing department.
 */
export async function updateDepartment(id: string, dto: UpdateDepartmentDto): Promise<Department> {
  return request.patch(`/lc/departments/${id}`, dto);
}

/**
 * Delete a department by ID (soft delete).
 */
export async function deleteDepartment(id: string): Promise<void> {
  return request.delete(`/lc/departments/${id}`);
}

/**
 * Batch delete departments by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteDepartments(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/departments/batch', { data: { ids } });
}

