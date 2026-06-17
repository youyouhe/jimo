import request from './request';

export interface PolicyDetail {
  id: string;
  policy_id: string;
  policy_id_display: string | null;
  chapter_number: string | null;
  title: string;
  content: string;
  sort_order: number | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface PolicyOption {
  id: string;
  name: string;
}

export interface PolicyDetailListParams {
  page?: number;
  pageSize?: number;
    chapter_number?: string;
    title?: string;
}

export interface PolicyDetailListResult {
  list: PolicyDetail[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatePolicyDetailDto {
    policy_id: string;
    chapter_number?: string;
    title: string;
    content: string;
    sort_order?: number;
}

export interface UpdatePolicyDetailDto {
    policy_id?: string;
    chapter_number?: string;
    title?: string;
    content?: string;
    sort_order?: number;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated policy-details list.
 */
export async function getPolicyDetailsList(params?: PolicyDetailListParams): Promise<PolicyDetailListResult> {
  return request.get('/lc/policy-details', { params });
}

/**
 * Get a single policy-detail by ID.
 */
export async function getPolicyDetail(id: string): Promise<PolicyDetail> {
  return request.get(`/lc/policy-details/${id}`);
}

/**
 * Create a new policy-detail.
 */
export async function createPolicyDetail(dto: CreatePolicyDetailDto): Promise<PolicyDetail> {
  return request.post('/lc/policy-details', dto);
}

/**
 * Update an existing policy-detail.
 */
export async function updatePolicyDetail(id: string, dto: UpdatePolicyDetailDto): Promise<PolicyDetail> {
  return request.patch(`/lc/policy-details/${id}`, dto);
}

/**
 * Delete a policy-detail by ID (soft delete).
 */
export async function deletePolicyDetail(id: string): Promise<void> {
  return request.delete(`/lc/policy-details/${id}`);
}

/**
 * Batch delete policy-details by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeletePolicyDetails(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/policy-details/batch', { data: { ids } });
}

/**
 * Get policies options for select dropdown.
 */
export async function getPolicyOptions(): Promise<PolicyOption[]> {
  const res = await request.get('/lc/policies', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

