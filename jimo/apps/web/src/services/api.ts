import request from './request';

export interface Api {
  id: string;
  method: string;
  path: string;
  description: string;
  apiGroup: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiListParams {
  page?: number;
  pageSize?: number;
  method?: string;
  path?: string;
  apiGroup?: string;
}

export interface ApiListResult {
  list: Api[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateApiDto {
  method: string;
  path: string;
  description?: string;
  apiGroup?: string;
}

export interface UpdateApiDto {
  method?: string;
  path?: string;
  description?: string;
  apiGroup?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated API list.
 */
export async function getApis(params?: ApiListParams): Promise<ApiListResult> {
  return request.get('/apis', { params });
}

export interface ApiGroupItem {
  group: string;
  count: number;
}

/**
 * Get distinct API groups, optionally with counts.
 */
export async function getApiGroups(withCount?: boolean): Promise<string[] | ApiGroupItem[]> {
  return request.get('/apis/groups', { params: withCount ? { withCount: 'true' } : {} });
}

/**
 * Get a single API by ID.
 */
export async function getApi(id: string): Promise<Api> {
  return request.get(`/apis/${id}`);
}

/**
 * Create a new API.
 */
export async function createApi(dto: CreateApiDto): Promise<Api> {
  return request.post('/apis', dto);
}

/**
 * Update an existing API.
 */
export async function updateApi(id: string, dto: UpdateApiDto): Promise<Api> {
  return request.patch(`/apis/${id}`, dto);
}

/**
 * Delete an API by ID (soft delete).
 */
export async function deleteApi(id: string): Promise<void> {
  return request.delete(`/apis/${id}`);
}

/**
 * Batch delete APIs by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteApis(ids: string[]): Promise<{ count: number }> {
  return request.delete('/apis/batch', { data: { ids } });
}
