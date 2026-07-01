import { useUserStore } from '@/stores/user';
import type { AiConfig, AiSseEvent } from './types';

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onToolResult: (dto: any) => void;
  onError: (msg: string) => void;
  onDone: () => void;
  onProgress?: (content: string, fallback?: boolean) => void;
}

/**
 * 用 fetch + ReadableStream 接收后端 SSE(因需带自定义 header:Authorization +
 * X-AI-*,不能用 EventSource)。逐行解析 data: {json},按 kind 分发回调。
 */
export interface AiChatContext {
  approvalEnabled?: boolean;
  approvalChain?: string;
  pageType?: 'list' | 'document' | 'grid' | 'calendar';
  visibilityStrategy?: 'private' | 'department' | 'shared' | 'public';
}

export async function streamAiChat(
  messages: Array<{ role: string; content: string }>,
  config: AiConfig,
  cb: StreamCallbacks,
  signal?: AbortSignal,
  context?: AiChatContext,
): Promise<void> {
  const { accessToken } = useUserStore.getState();
  let resp: Response;
  try {
    resp = await fetch('/api/v1/autocode/ai-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken ? `Bearer ${accessToken}` : '',
        'X-AI-Api-Key': config.apiKey,
        'X-AI-Base-URL': config.baseUrl,
        'X-AI-Model': config.model,
      },
      body: JSON.stringify({ messages, ...(context ? { context } : {}) }),
      signal,
    });
  } catch (e: any) {
    if (e?.name === 'AbortError') return;
    cb.onError(e?.message || '网络错误,无法连接 AI 服务');
    return;
  }

  if (!resp.ok || !resp.body) {
    const txt = await resp.text().catch(() => '');
    cb.onError(`AI 请求失败 ${resp.status}: ${txt.slice(0, 300)}`);
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        let evt: AiSseEvent;
        try {
          evt = JSON.parse(data);
        } catch {
          continue;
        }
        switch (evt.kind) {
          case 'token':
            cb.onToken(evt.content || '');
            break;
          case 'tool_result':
            if (evt.dto) cb.onToolResult(evt.dto);
            break;
          case 'progress':
            cb.onProgress?.(evt.content || '', evt.fallback);
            break;
          case 'error':
            cb.onError(evt.message || '未知错误');
            break;
          case 'done':
            cb.onDone();
            break;
        }
      }
    }
  } catch (e: any) {
    if (e?.name !== 'AbortError') cb.onError(e?.message || '流读取中断');
  }
}
