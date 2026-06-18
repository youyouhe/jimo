import request from './request';

export interface ErrorLog {
  id: string;
  level: string;
  source: string;
  message: string;
  stack: string;
  solution: string;
  status: number;
  createdAt: string;
  updatedAt: string;
}

export interface ErrorLogListParams {
  page?: number;
  pageSize?: number;
  level?: string;
  source?: string;
  status?: number;
}

export interface ErrorLogListResult {
  list: ErrorLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateErrorDto {
  solution?: string;
  status?: number;
}

/**
 * Get paginated error log list with optional filters.
 */
export async function getErrors(params?: ErrorLogListParams): Promise<ErrorLogListResult> {
  return request.get('/errors', { params });
}

/**
 * Get a single error log detail by ID.
 */
export async function getError(id: string): Promise<ErrorLog> {
  return request.get(`/errors/${id}`);
}

/**
 * Update error log (solution/status).
 */
export async function updateError(id: string, dto: UpdateErrorDto): Promise<ErrorLog> {
  return request.patch(`/errors/${id}`, dto);
}

/**
 * Delete a single error log by ID.
 */
export async function deleteError(id: string): Promise<void> {
  return request.delete(`/errors/${id}`);
}

/**
 * Batch delete error logs by IDs.
 */
export async function batchDeleteErrors(ids: string[]): Promise<{ count: number }> {
  return request.delete('/errors/batch', { data: { ids } });
}
