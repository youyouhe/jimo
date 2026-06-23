import request from '../request';

export interface Dept {
  id: string;
  name: string;
  code: string;
  parent_id: string | null;
  parent_id_display: string | null;
  description: string | null;
  sort_order: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DeptOption {
  id: string;
  name: string;
}

export interface DeptListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    code?: string;
}

export interface DeptListResult {
  list: Dept[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateDeptDto {
    name: string;
    code: string;
    parent_id?: string;
    description?: string;
    sort_order?: number;
}

export interface UpdateDeptDto {
    name?: string;
    code?: string;
    parent_id?: string;
    description?: string;
    sort_order?: number;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated depts list.
 */
export async function getDeptsList(params?: DeptListParams): Promise<DeptListResult> {
  return request.get('/lc/depts', { params });
}

/**
 * Get a single dept by ID.
 */
export async function getDept(id: string): Promise<Dept> {
  return request.get(`/lc/depts/${id}`);
}

/**
 * Create a new dept.
 */
export async function createDept(dto: CreateDeptDto): Promise<Dept> {
  return request.post('/lc/depts', dto);
}

/**
 * Update an existing dept.
 */
export async function updateDept(id: string, dto: UpdateDeptDto): Promise<Dept> {
  return request.patch(`/lc/depts/${id}`, dto);
}

/**
 * Delete a dept by ID (soft delete).
 */
export async function deleteDept(id: string): Promise<void> {
  return request.delete(`/lc/depts/${id}`);
}

/**
 * Batch delete depts by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteDepts(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/depts/batch', { data: { ids } });
}

/**
 * Get depts options for select dropdown.
 */
export async function getDeptOptions(): Promise<DeptOption[]> {
  const res = await request.get('/lc/depts', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

