import request from './request';

export interface JwtBlacklistEntry {
  id: string;
  jti: string;
  expiresAt: string;
  createdAt: string;
}

export interface JwtBlacklistListParams {
  page?: number;
  pageSize?: number;
}

export interface JwtBlacklistListResult {
  list: JwtBlacklistEntry[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Get paginated JWT blacklist entries.
 */
export async function getBlacklist(params?: JwtBlacklistListParams): Promise<JwtBlacklistListResult> {
  return request.get('/jwt-blacklist', { params });
}

/**
 * Remove a JWT blacklist entry by ID.
 */
export async function deleteBlacklistEntry(id: string): Promise<void> {
  return request.delete(`/jwt-blacklist/${id}`);
}
