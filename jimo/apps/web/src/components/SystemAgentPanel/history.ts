import type { ChatMessage } from './types';
import { useUserStore } from '@/stores/user';

const MAX_MESSAGES = 200;
const MAX_CONVS = 30;

function uid(): string {
  return useUserStore.getState().userInfo?.id ?? 'anon';
}

function listKey(agentType: string) {
  return `system-agent-${uid()}-${agentType}-conv-list`;
}
function msgKey(agentType: string, id: string) {
  return `system-agent-${uid()}-${agentType}-conv-${id}`;
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

export function loadConvList(agentType: string): ConvMeta[] {
  try {
    const raw = localStorage.getItem(listKey(agentType));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveConvList(agentType: string, list: ConvMeta[]): void {
  try {
    localStorage.setItem(listKey(agentType), JSON.stringify(list.slice(0, MAX_CONVS)));
  } catch { /* ignore */ }
}

const saveTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export function loadConvMessages(agentType: string, id: string): ChatMessage[] {
  try {
    const raw = localStorage.getItem(msgKey(agentType, id));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.map((m: ChatMessage) => ({ ...m, streaming: false }));
  } catch {
    return [];
  }
}

export function saveConvMessages(agentType: string, id: string, messages: ChatMessage[]): void {
  const key = `${agentType}:${id}`;
  if (saveTimers[key]) clearTimeout(saveTimers[key]);
  saveTimers[key] = setTimeout(() => {
    try {
      const sliced = messages.length > MAX_MESSAGES ? messages.slice(-MAX_MESSAGES) : messages;
      localStorage.setItem(msgKey(agentType, id), JSON.stringify(sliced));
    } catch { /* ignore */ }
    delete saveTimers[key];
  }, 500);
}

export function updateConvMeta(agentType: string, id: string, messages: ChatMessage[]): void {
  const list = loadConvList(agentType);
  const idx = list.findIndex((c) => c.id === id);
  const title = titleFromMessages(messages);
  const now = Date.now();
  if (idx >= 0) {
    list[idx] = { ...list[idx], title, updatedAt: now };
  } else {
    list.unshift({ id, title, createdAt: now, updatedAt: now });
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  saveConvList(agentType, list);
}

export function createConv(agentType: string): string {
  const id = genId();
  const now = Date.now();
  const list = loadConvList(agentType);
  saveConvList(agentType, [{ id, title: '新对话', createdAt: now, updatedAt: now }, ...list]);
  return id;
}

export function deleteConv(agentType: string, id: string): void {
  const key = `${agentType}:${id}`;
  if (saveTimers[key]) { clearTimeout(saveTimers[key]); delete saveTimers[key]; }
  try { localStorage.removeItem(msgKey(agentType, id)); } catch { /* ignore */ }
  saveConvList(agentType, loadConvList(agentType).filter((c) => c.id !== id));
}

export function clearConvMessages(agentType: string, id: string): void {
  try {
    const key = `${agentType}:${id}`;
    if (saveTimers[key]) { clearTimeout(saveTimers[key]); delete saveTimers[key]; }
    localStorage.setItem(msgKey(agentType, id), JSON.stringify([]));
  } catch { /* ignore */ }
  const list = loadConvList(agentType);
  const idx = list.findIndex((c) => c.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], title: '新对话', updatedAt: Date.now() };
    saveConvList(agentType, list);
  }
}
