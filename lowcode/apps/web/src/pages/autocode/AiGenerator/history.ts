import type { AiMessage } from './types';

const HISTORY_KEY = 'autocode-ai-history';
const MAX_MESSAGES = 200; // 防止 localStorage 溢出

let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** 从 localStorage 读取对话历史。streaming 标记统一置 false。 */
export function loadHistory(): AiMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: AiMessage) => ({ ...m, streaming: false }));
  } catch {
    return [];
  }
}

/** 持久化对话历史到 localStorage(debounce 500ms,避免流式输出时高频写入)。 */
export function saveHistory(messages: AiMessage[]): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const sliced = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
      localStorage.setItem(HISTORY_KEY, JSON.stringify(sliced));
    } catch {
      /* ignore (quota exceeded 等) */
    }
  }, 500);
}

/** 立即清除对话历史(同时取消待执行的 debounce 写入) */
export function clearHistory(): void {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
