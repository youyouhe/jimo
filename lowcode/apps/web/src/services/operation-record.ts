import request from './request';

export interface OperationRecord {
  id: string;
  ip: string;
  method: string;
  path: string;
  status: number;
  latency: number;
  agent: string;
  errorMessage?: string;
  body?: string;
  resp?: string;
  userId?: string;
  createdAt: string;
}

export interface RecordListParams {
  page?: number;
  pageSize?: number;
  method?: string;
  path?: string;
  status?: number;
  startDate?: string;
  endDate?: string;
}

export interface RecordListResult {
  list: OperationRecord[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Get paginated operation record list.
 */
export async function getRecords(params?: RecordListParams): Promise<RecordListResult> {
  return request.get('/operation-records', { params });
}

/**
 * Get a single operation record by ID.
 */
export async function getRecord(id: string): Promise<OperationRecord> {
  return request.get(`/operation-records/${id}`);
}

/**
 * Delete an operation record by ID (hard delete).
 */
export async function deleteRecord(id: string): Promise<void> {
  return request.delete(`/operation-records/${id}`);
}

/**
 * Batch delete operation records by IDs (hard delete).
 * Returns { count: number }.
 */
export async function batchDeleteRecords(ids: string[]): Promise<{ count: number }> {
  return request.delete('/operation-records/batch', { data: { ids } });
}
