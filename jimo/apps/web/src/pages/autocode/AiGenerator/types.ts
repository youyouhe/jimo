import type { AutoCodeDto } from '../../../services/autocode';

/** 一条提议方案(一个实体表)及其处理状态。 */
export interface ProposeItem {
  dto: AutoCodeDto;
  status: 'pending' | 'confirmed' | 'rejected';
}

/** 对话消息。assistant 消息可附带一个或多个提议方案(proposeItems)。 */
export interface AiMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** assistant 消息携带的实体方案列表(来自 AI tool_result,支持一轮多表批量) */
  proposeItems?: ProposeItem[];
  /** 方案是否已被用户处理(confirmed / rejected) */
  proposeStatus?: 'pending' | 'confirmed' | 'rejected';
  /** @deprecated 旧字段,单方案。仅用于兼容历史 localStorage 记录。 */
  proposeDto?: AutoCodeDto;
  /** 流式输出进行中 */
  streaming?: boolean;
  /** 后端进度提示(字典/包创建、补提等),在气泡下以小字展示 */
  progressLines?: string[];
  /** 后端标记:本轮走了"零工具补提/降级"路径(用于无方案卡时的友好兜底) */
  noProposalFallback?: boolean;
}

/** 后端 SSE 事件 */
export interface AiSseEvent {
  kind: 'token' | 'tool_result' | 'error' | 'done' | 'progress';
  content?: string;
  dto?: AutoCodeDto;
  message?: string;
  /** progress 事件专用:是否为"零工具/降级"兜底标记 */
  fallback?: boolean;
}

/** BYOC 配置(存 sessionStorage) */
export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 取出一条消息里的全部提议方案(统一从 proposeItems 读;兼容旧的单 proposeDto)。
 * 纯函数,供渲染与上下文注入复用。
 */
export function getProposeItems(m: AiMessage): ProposeItem[] {
  if (m.proposeItems && m.proposeItems.length > 0) return m.proposeItems;
  if (m.proposeDto) {
    return [{ dto: m.proposeDto, status: m.proposeStatus || 'pending' }];
  }
  return [];
}
