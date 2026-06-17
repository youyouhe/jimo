import request from './request';

export interface PolicyPolicyDetail {
  id: string;
  chapter_number: string | null;
  title: string;
  content: string;
  sort_order: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Policy {
  id: string;
  name: string;
  policy_code: string | null;
  policy_type: string | null;
  version: string | null;
  status: string | null;
  department_id: string | null;
  department_id_display: string | null;
  effective_date: string | null;
  expiration_date: string | null;
  description: string | null;
  policy_details: PolicyPolicyDetail[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface DepartmentOption {
  id: string;
  name: string;
}

export interface PolicyListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    policy_code?: string;
    policy_type?: string;
    status?: string;
    department_id?: string;
}

export interface PolicyListResult {
  list: Policy[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatePolicyDto {
    name: string;
    policy_code?: string;
    policy_type?: string;
    version?: string;
    status?: string;
    department_id?: string;
    effective_date?: string;
    expiration_date?: string;
    description?: string;
    policy_details?: PolicyPolicyDetail[];
}

export interface UpdatePolicyDto {
    name?: string;
    policy_code?: string;
    policy_type?: string;
    version?: string;
    status?: string;
    department_id?: string;
    effective_date?: string;
    expiration_date?: string;
    description?: string;
    policy_details?: PolicyPolicyDetail[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated policies list.
 */
export async function getPoliciesList(params?: PolicyListParams): Promise<PolicyListResult> {
  return request.get('/lc/policies', { params });
}

/**
 * Get a single policy by ID.
 */
export async function getPolicy(id: string): Promise<Policy> {
  return request.get(`/lc/policies/${id}`);
}

/**
 * Create a new policy.
 */
export async function createPolicy(dto: CreatePolicyDto): Promise<Policy> {
  return request.post('/lc/policies', dto);
}

/**
 * Update an existing policy.
 */
export async function updatePolicy(id: string, dto: UpdatePolicyDto): Promise<Policy> {
  return request.patch(`/lc/policies/${id}`, dto);
}

/**
 * Delete a policy by ID (soft delete).
 */
export async function deletePolicy(id: string): Promise<void> {
  return request.delete(`/lc/policies/${id}`);
}

/**
 * Batch delete policies by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeletePolicies(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/policies/batch', { data: { ids } });
}

/**
 * Get departments options for select dropdown.
 */
export async function getDepartmentOptions(): Promise<DepartmentOption[]> {
  const res = await request.get('/lc/departments', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

