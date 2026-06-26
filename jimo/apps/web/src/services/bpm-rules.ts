import request from './request';

export interface ResolutionRule {
  ruleName: string;
  label: string;
  strategy: string;
  config?: Record<string, unknown>;
}

export async function listRules(): Promise<ResolutionRule[]> {
  return request.get('/bpm-rules');
}

export async function getRule(ruleName: string): Promise<ResolutionRule> {
  return request.get(`/bpm-rules/${encodeURIComponent(ruleName)}`);
}

export async function createRule(dto: Omit<ResolutionRule, never>): Promise<ResolutionRule> {
  return request.post('/bpm-rules', dto);
}

export async function updateRule(
  ruleName: string,
  dto: Partial<ResolutionRule>,
): Promise<ResolutionRule> {
  return request.put(`/bpm-rules/${encodeURIComponent(ruleName)}`, dto);
}

export async function deleteRule(ruleName: string): Promise<void> {
  return request.delete(`/bpm-rules/${encodeURIComponent(ruleName)}`);
}
