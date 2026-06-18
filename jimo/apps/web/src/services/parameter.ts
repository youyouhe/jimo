import request from './request';

export interface Param {
  id: string;
  name: string;
  key: string;
  value: string;
  desc: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ParamListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  key?: string;
}

export interface ParamListResult {
  list: Param[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateParamDto {
  name: string;
  key: string;
  value: string;
  desc?: string;
}

export interface UpdateParamDto {
  name?: string;
  key?: string;
  value?: string;
  desc?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated parameter list.
 */
export async function getParameters(params?: ParamListParams): Promise<ParamListResult> {
  return request.get('/parameters', { params });
}

/**
 * Get a single parameter by ID.
 */
export async function getParameter(id: string): Promise<Param> {
  return request.get(`/parameters/${id}`);
}

/**
 * Get a parameter by key.
 */
export async function getParameterByKey(key: string): Promise<Param> {
  return request.get(`/parameters/key/${key}`);
}

/**
 * Create a new parameter.
 */
export async function createParameter(dto: CreateParamDto): Promise<Param> {
  return request.post('/parameters', dto);
}

/**
 * Update an existing parameter.
 */
export async function updateParameter(id: string, dto: UpdateParamDto): Promise<Param> {
  return request.patch(`/parameters/${id}`, dto);
}

/**
 * Delete a parameter by ID (soft delete).
 */
export async function deleteParameter(id: string): Promise<void> {
  return request.delete(`/parameters/${id}`);
}

/**
 * Batch delete parameters by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteParameters(ids: string[]): Promise<{ count: number }> {
  return request.delete('/parameters/batch', { data: { ids } });
}
