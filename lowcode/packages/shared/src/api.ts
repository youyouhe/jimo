/**
 * Unified API response envelope.
 * code=0 means success; non-zero values are error codes from ApiErrorCode.
 */
export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
  requestId?: string;
}

/** Paginated list response — data field is always a page object. */
export interface PaginatedData<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type PaginatedResponse<T> = ApiResponse<PaginatedData<T>>;

/** Helper to build a success response (code=0). */
export function ok<T>(data: T, msg = 'success', requestId?: string): ApiResponse<T> {
  return { code: 0, msg, data, ...(requestId ? { requestId } : {}) };
}

/** Helper to build an error response. */
export function err(code: number, msg: string, requestId?: string): ApiResponse<null> {
  return { code, msg, data: null, ...(requestId ? { requestId } : {}) };
}
