import type { ChatMessage } from './types';

const MAX_MESSAGES = 200;
const MAX_CONVS = 30;

function listKey(businessType: string) {
  return `entity-agent-${businessType}-conv-list`;
}
function msgKey(businessType: string, id: string) {
  return `entity-agent-${businessType}-conv-${id}`;
}

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

function titleFromMessages(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content);
  if (!first) return '新对话';
  return first.content.slice(0, 30) + (first.content.length > 30 ? '…' : '');
}

export function loadConvList(businessType: string): ConvMeta[] {
  try {
    const raw = localStorage.getItem(listKey(businessType));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveConvList(businessType: string, list: ConvMeta[]): void {
  try {
    localStorage.setItem(listKey(businessType), JSON.stringify(list.slice(0, MAX_CONVS)));
  } catch { /* ignore */ }
}

const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export function loadConvMessages(businessType: string, id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(msgKey(businessType, id));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: ChatMessage) => ({ ...m, streaming: false }));
  } catch {
    return [];
  }
}

export function saveConvMessages(businessType: string, id: string, messages: ChatMessage[]): void {
  const key = `${businessType}:${id}`;
  if (saveTimers[key]) clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => {
    try {
      const sliced = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
      localStorage.setItem(msgKey(businessType, id), JSON.stringify(sliced));
    } catch { /* ignore */ }
    delete saveTimers[key];
  }, 500);
}

export function updateConvMeta(businessType: string, id: string, messages: ChatMessage[]): void {
  const list = loadConvList(businessType);
  const idx = list.findIndex((c) => c.id === id);
  const title = titleFromMessages(messages);
  const now = Date.now();
  if (idx >= 0) {
    list[idx] = { ...list[idx], title, updatedAt: now };
  } else {
    list.unshift({ id, title, createdAt: now, updatedAt: now });
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  saveConvList(businessType, list);
}

export function createConv(businessType: string): string {
  const id = genId();
  const now = Date.now();
  const list = loadConvList(businessType);
  saveConvList(businessType, [{ id, title: '新对话', createdAt: now, updatedAt: now }, ...list]);
  return id;
}

export function deleteConv(businessType: string, id: string): void {
  const key = `${businessType}:${id}`;
  if (saveTimers[key]) { clearTimeout(saveTimers[key]); delete saveTimers[key]; }
  try { localStorage.removeItem(msgKey(businessType, id)); } catch { /* ignore */ }
  saveConvList(businessType, loadConvList(businessType).filter((c) => c.id !== id));
}

export function clearConvMessages(businessType: string, id: string): void {
  try {
    const key = `${businessType}:${id}`;
    if (saveTimers[key]) { clearTimeout(saveTimers[key]); delete saveTimers[key]; }
    localStorage.setItem(msgKey(businessType, id), JSON.stringify([]));
  } catch { /* ignore */ }
  const list = loadConvList(businessType);
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], title: '新对话', updatedAt: Date.now() };
    saveConvList(businessType, list);
  }
}
