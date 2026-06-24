import type { AiMessage } from './types';
import { useUserStore } from '@/stores/user';

function uid(): string {
  return useUserStore.getState().userInfo?.id ?? 'anon';
}

function listKey(): string {
  return `autocode-ai-${uid()}-conv-list`;
}
function msgKey(id: string): string {
  return `autocode-ai-${uid()}-conv-${id}`;
}

const LEGACY_KEY = 'autocode-ai-history';
const MAX_MESSAGES = 200;
const MAX_CONVS = 50;

export interface ConvMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

function genId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());
}

function titleFromMessages(messages: AiMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content);
  if (!first) return '新对话';
  return first.content.slice(0, 30) + (first.content.length > 30 ? '…' : '');
}

// ── List ops ────────────────────────────────────────────────────────────────

export function loadConvList(): ConvMeta[] {
  try {
    const raw = localStorage.getItem(listKey());
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveConvList(list: ConvMeta[]): void {
  try {
    const trimmed = list.slice(0, MAX_CONVS);
    localStorage.setItem(listKey(), JSON.stringify(trimmed));
  } catch { /* ignore */ }
}

// ── Message ops ─────────────────────────────────────────────────────────────

const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export function loadConvMessages(id: string): AiMessage[] {
  try {
    const raw = localStorage.getItem(msgKey(id));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: AiMessage) => ({ ...m, streaming: false }));
  } catch {
    return [];
  }
}

export function saveConvMessages(id: string, messages: AiMessage[]): void {
  if (saveTimers[id]) clearTimeout(saveTimers[id]);
  saveTimers[id] = setTimeout(() => {
    try {
      const sliced = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
      localStorage.setItem(msgKey(id), JSON.stringify(sliced));
    } catch { /* ignore */ }
    delete saveTimers[id];
  }, 500);
}

function saveConvMessagesNow(id: string, messages: AiMessage[]): void {
  if (saveTimers[id]) {
    clearTimeout(saveTimers[id]);
    delete saveTimers[id];
  }
  try {
    const sliced = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
    localStorage.setItem(msgKey(id), JSON.stringify(sliced));
  } catch { /* ignore */ }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

/** 创建新会话，返回 id。 */
export function createConv(): string {
  const id = genId();
  const now = Date.now();
  const meta: ConvMeta = { id, title: '新对话', createdAt: now, updatedAt: now };
  const list = loadConvList();
  saveConvList([meta, ...list]);
  return id;
}

/** 消息变化时更新元数据标题 + 时间戳。 */
export function updateConvMeta(id: string, messages: AiMessage[]): void {
  const list = loadConvList();
  const idx = list.findIndex((c) => c.id === id);
  const title = titleFromMessages(messages);
  const now = Date.now();
  if (idx >= 0) {
    list[idx] = { ...list[idx], title, updatedAt: now };
  } else {
    list.unshift({ id, title, createdAt: now, updatedAt: now });
  }
  // 按 updatedAt 降序排
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  saveConvList(list);
}

/** 删除会话（立即，含 debounce 取消）。 */
export function deleteConv(id: string): void {
  if (saveTimers[id]) {
    clearTimeout(saveTimers[id]);
    delete saveTimers[id];
  }
  try { localStorage.removeItem(msgKey(id)); } catch { /* ignore */ }
  const list = loadConvList().filter((c) => c.id !== id);
  saveConvList(list);
}

/** 清空会话消息（保留 meta）。 */
export function clearConvMessages(id: string): void {
  saveConvMessagesNow(id, []);
  const list = loadConvList();
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], title: '新对话', updatedAt: Date.now() };
    saveConvList(list);
  }
}

// ── Migration: 旧单会话 → 新多会话 ──────────────────────────────────────────

/** 首次加载时，把旧 localStorage 数据迁移为第一条会话记录。 */
export function migrateIfNeeded(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (!legacy) return;
    const arr = JSON.parse(legacy);
    if (!Array.isArray(arr) || arr.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    const messages: AiMessage[] = arr.map((m: AiMessage) => ({ ...m, streaming: false }));
    const id = genId();
    const now = Date.now();
    saveConvMessagesNow(id, messages);
    const meta: ConvMeta = {
      id,
      title: titleFromMessages(messages),
      createdAt: now,
      updatedAt: now,
    };
    const existing = loadConvList();
    saveConvList([meta, ...existing]);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}
