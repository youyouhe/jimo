import type { AiConfig } from './types';

const STORAGE_KEY = 'autocode-ai-config';

/** 从 sessionStorage 读取 BYOC 配置;不完整返回 null。 */
export function loadAiConfig(): AiConfig | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<AiConfig>;
    if (c.apiKey && c.baseUrl && c.model) return c as AiConfig;
  } catch {
    /* ignore */
  }
  return null;
}

export function saveAiConfig(c: AiConfig): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

export function clearAiConfig(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

export function isConfigured(): boolean {
  return loadAiConfig() !== null;
}
