import request from './request';

export interface LoginLog {
  id: string;
  userId: string | null;
  username: string;
  ip: string;
  userAgent: string;
  status: number;
  message: string;
  createdAt: string;
}

export interface LoginLogListParams {
  page?: number;
  pageSize?: number;
  username?: string;
  status?: number;
  startDate?: string;
  endDate?: string;
}

export interface LoginLogListResult {
  list: LoginLog[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Get paginated login log list with optional filters.
 */
export async function getLoginLogs(params?: LoginLogListParams): Promise<LoginLogListResult> {
  return request.get('/login-logs', { params });
}

/**
 * Delete a single login log by ID.
 */
export async function deleteLoginLog(id: string): Promise<void> {
  return request.delete(`/login-logs/${id}`);
}

/**
 * Batch delete login logs by IDs.
 */
export async function batchDeleteLoginLogs(ids: string[]): Promise<{ count: number }> {
  return request.delete('/login-logs/batch', { data: { ids } });
}
