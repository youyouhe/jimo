import request from './request';

export interface ApiToken {
  id: string;
  name: string;
  token: string;
  userId: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface ApiTokenListParams {
  page?: number;
  pageSize?: number;
  name?: string;
}

export interface ApiTokenListResult {
  list: ApiToken[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateApiTokenDto {
  name: string;
  expiresAt?: string;
}

/**
 * Get paginated API token list.
 */
export async function getApiTokens(params?: ApiTokenListParams): Promise<ApiTokenListResult> {
  return request.get('/api-tokens', { params });
}

/**
 * Generate a new API token.
 */
export async function generateApiToken(dto: CreateApiTokenDto): Promise<ApiToken> {
  return request.post('/api-tokens', dto);
}

/**
 * Revoke an API token by ID.
 */
export async function revokeApiToken(id: string): Promise<void> {
  return request.delete(`/api-tokens/${id}`);
}
