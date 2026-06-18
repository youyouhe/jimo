import request from './request';

export interface EncodingRule {
  id: string;
  name: string;
  prefix: string | null;
  dateFormat: string | null;
  separator: string;
  sequenceDigits: number;
  paddingChar: string;
  resetCycle: 'never' | 'yearly' | 'monthly';
  createdAt: string;
  updatedAt: string;
}

export interface CreateEncodingRuleDto {
  name: string;
  prefix?: string;
  dateFormat?: string;
  separator?: string;
  sequenceDigits?: number;
  paddingChar?: string;
  resetCycle: 'never' | 'yearly' | 'monthly';
}

export interface UpdateEncodingRuleDto {
  name?: string;
  prefix?: string;
  dateFormat?: string;
  separator?: string;
  sequenceDigits?: number;
  paddingChar?: string;
  resetCycle?: 'never' | 'yearly' | 'monthly';
}

export interface ListResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export async function getEncodingRulesList(params?: {
  name?: string;
  page?: number;
  pageSize?: number;
}): Promise<ListResult<EncodingRule>> {
  return request.get('/encoding-rules', { params });
}

export async function getEncodingRule(id: string): Promise<EncodingRule> {
  return request.get(`/encoding-rules/${id}`);
}

export async function createEncodingRule(
  dto: CreateEncodingRuleDto,
): Promise<EncodingRule> {
  return request.post('/encoding-rules', dto);
}

export async function updateEncodingRule(
  id: string,
  dto: UpdateEncodingRuleDto,
): Promise<EncodingRule> {
  return request.put(`/encoding-rules/${id}`, dto);
}

export async function deleteEncodingRule(id: string): Promise<void> {
  return request.delete(`/encoding-rules/${id}`);
}
