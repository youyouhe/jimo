import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import {
  Input,
  Button,
  message,
  Spin,
  Typography,
  Space,
  Drawer,
  List,
  Popconfirm,
  Tooltip,
} from 'antd';
import {
  SendOutlined, SettingOutlined, RobotOutlined,
  HistoryOutlined, CopyOutlined, ClearOutlined, PlusOutlined,
} from '@ant-design/icons';
import { useUserStore } from '@/stores/user';
import { useBpmDesignerStore } from '@/stores/bpm-designer';
import { loadAiConfig } from '@/pages/autocode/AiGenerator/key-config';
import { KeySettingModal } from '@/pages/autocode/AiGenerator/KeySettingModal';
import type LogicFlow from '@logicflow/core';
import type { DesignerCanvasHandle } from './DesignerCanvas';

const { Text } = Typography;

const HISTORY_KEY = 'bpm_agent_history';
const MAX_HISTORY = 20;

interface SavedSession {
  id: string;
  title: string;
  savedAt: string;
  messages: ChatMessage[];
}

function loadHistory(): SavedSession[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch { return []; }
}

function saveToHistory(msgs: ChatMessage[]): void {
  if (msgs.length === 0) return;
  const first = msgs.find((m) => m.role === 'user');
  const title = first ? first.content.slice(0, 40) : '对话记录';
  const session: SavedSession = {
    id: Date.now().toString(),
    title,
    savedAt: new Date().toLocaleString(),
    messages: msgs,
  };
  const history = [session, ...loadHistory()].slice(0, MAX_HISTORY);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface Props {
  lf: LogicFlow | null;
  canvasRef: RefObject<DesignerCanvasHandle | null>;
  definitionId: string | null;
}

function msgId(): string {
  return Math.random().toString(36).slice(2);
}

/**
 * BPM Designer Agent Chat Panel.
 *
 * Sends messages to POST /api/v1/bpm/agent/chat with SSE streaming.
 * On canvas_update events, writes to store.pendingRender; DesignerCanvas
 * picks it up and calls lf.render() + fitView() since it always holds a valid lf.
 */
export default function AgentChat({ lf, canvasRef, definitionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SavedSession[]>(() => loadHistory());

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const getLfJson = useCallback(() => {
    // Read from LF instance (source of truth — includes manually dragged nodes)
    if (lf) {
      try {
        const raw = (lf as any).getGraphRawData?.();
        if (raw && (raw.nodes?.length > 0 || raw.edges?.length > 0)) return raw;
      } catch { /* ignore */ }
    }
    // Fallback to store
    const stored = useBpmDesignerStore.getState().lfJson;
    return stored ?? { nodes: [], edges: [] };
  }, [lf]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const cfg = loadAiConfig();
    if (!cfg) {
      setSettingsOpen(true);
      return;
    }

    const userMsg: ChatMessage = { id: msgId(), role: 'user', content: text };
    const aiMsg: ChatMessage = { id: msgId(), role: 'assistant', content: '', streaming: true };
    const aiMsgId = aiMsg.id;

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const { accessToken } = useUserStore.getState();
    const lfJson = getLfJson();

    let resp: Response;
    try {
      resp = await fetch('/api/v1/bpm/agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken ? `Bearer ${accessToken}` : '',
          'x-api-key': cfg.apiKey,
          'x-base-url': cfg.baseUrl,
          'x-model': cfg.model,
        },
        body: JSON.stringify({ message: text, lfJson }),
        signal: ctrl.signal,
      });
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        message.error(e?.message || '网络错误');
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, streaming: false } : m)),
      );
      setLoading(false);
      abortRef.current = null;
      return;
    }

    if (!resp.ok || !resp.body) {
      const txt = await resp.text().catch(() => '');
      message.error(`AI 请求失败 ${resp.status}: ${txt.slice(0, 200)}`);
      setMessages((prev) =>
        prev.map((m) => (m.id === aiMsgId ? { ...m, streaming: false } : m)),
      );
      setLoading(false);
      abortRef.current = null;
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
          let evt: any;
          try {
            evt = JSON.parse(data);
          } catch {
            continue;
          }

          switch (evt.kind) {
            case 'token':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId ? { ...m, content: m.content + (evt.content || '') } : m,
                ),
              );
              break;

            case 'node_add': {
              const payload = evt.data as { node?: any; message?: string };
              if (payload?.node) {
                if (lf) {
                  try {
                    (lf as any).addNode(payload.node);
                    const raw = (lf as any).getGraphRawData?.();
                    if (raw) useBpmDesignerStore.getState().setLfJson(raw);
                  } catch (err) {
                    console.error('[BpmAgent] lf.addNode failed:', err);
                  }
                }
              }
              break;
            }

            case 'edge_add': {
              const payload = evt.data as { edge?: any; message?: string };
              if (payload?.edge) {
                if (lf) {
                  try {
                    (lf as any).addEdge(payload.edge);
                    const raw = (lf as any).getGraphRawData?.();
                    if (raw) useBpmDesignerStore.getState().setLfJson(raw);
                  } catch (err) {
                    console.error('[BpmAgent] lf.addEdge failed:', err);
                  }
                }
              }
              break;
            }

            case 'canvas_update': {
              const payload = evt.data as { lfJson?: any; message?: string };
              if (payload?.lfJson) {
                canvasRef.current?.applyGraph(payload.lfJson);
              }
              break;
            }

            case 'progress':
              // Show progress as a faint system note appended to assistant message
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: m.content + `\n\`${evt.content || ''}\`` }
                    : m,
                ),
              );
              break;

            case 'error':
              message.error(evt.message || '未知错误');
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsgId
                    ? { ...m, content: m.content || `(出错: ${evt.message})`, streaming: false }
                    : m,
                ),
              );
              break;

            case 'done':
              setMessages((prev) =>
                prev.map((m) => (m.id === aiMsgId ? { ...m, streaming: false } : m)),
              );
              setLoading(false);
              abortRef.current = null;
              break;
          }
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        message.error(e?.message || '流读取中断');
      }
    }

    setMessages((prev) =>
      prev.map((m) => (m.id === aiMsgId ? { ...m, streaming: false } : m)),
    );
    setLoading(false);
    abortRef.current = null;
  };

  const handleStop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
    setMessages((prev) => prev.map((m) => (m.streaming ? { ...m, streaming: false } : m)));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const configured = !!loadAiConfig();

  const handleCopy = useCallback(() => {
    if (messages.length === 0) { message.info('暂无对话内容'); return; }
    const text = messages.map((m) => `${m.role === 'user' ? '我' : 'AI'}: ${m.content}`).join('\n\n');
    // Clipboard API requires HTTPS or localhost; fallback to textarea execCommand
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => message.success('已复制到剪贴板'),
        () => message.error('复制失败'),
      );
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
        message.success('已复制到剪贴板');
      } catch {
        message.error('复制失败，请手动选择文本');
      } finally {
        document.body.removeChild(ta);
      }
    }
  }, [messages]);

  const handleClean = useCallback(() => {
    if (messages.length > 0) saveToHistory(messages);
    setMessages([]);
    setHistory(loadHistory());
  }, [messages]);

  const handleRestoreHistory = useCallback((session: SavedSession) => {
    if (messages.length > 0) saveToHistory(messages);
    setMessages(session.messages);
    setHistoryOpen(false);
    setHistory(loadHistory());
  }, [messages]);

  const handleDeleteHistory = useCallback((id: string) => {
    const updated = loadHistory().filter((s) => s.id !== id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(updated));
    setHistory(updated);
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderBottom: '1px solid #f0f0f0',
          flexShrink: 0,
        }}
      >
        <Space size={6}>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <Text strong style={{ fontSize: 13 }}>AI 设计助手</Text>
        </Space>
        <Space size={2}>
          <Tooltip title="新对话">
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => { if (messages.length > 0) saveToHistory(messages); setMessages([]); setHistory(loadHistory()); }} />
          </Tooltip>
          <Tooltip title="历史记录">
            <Button size="small" type="text" icon={<HistoryOutlined />} onClick={() => { setHistory(loadHistory()); setHistoryOpen(true); }} />
          </Tooltip>
          <Tooltip title="复制对话">
            <Button size="small" type="text" icon={<CopyOutlined />} onClick={handleCopy} />
          </Tooltip>
          <Tooltip title="清空对话">
            <Popconfirm title="清空当前对话？（会自动保存到历史）" okText="清空" cancelText="取消" onConfirm={handleClean}>
              <Button size="small" type="text" icon={<ClearOutlined />} />
            </Popconfirm>
          </Tooltip>
          <Tooltip title="配置 AI（与代码生成器共享）">
            <Button size="small" type="text" icon={<SettingOutlined />} onClick={() => setSettingsOpen(true)} style={{ color: configured ? '#1677ff' : '#faad14' }} />
          </Tooltip>
        </Space>
      </div>

      {/* Messages — minHeight:0 is required to make flex child scrollable */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '8px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ color: '#bbb', fontSize: 12, textAlign: 'center', marginTop: 24 }}>
            <RobotOutlined style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
            <div>告诉我你想构建什么流程</div>
            <div style={{ marginTop: 4 }}>例：帮我建一个三级审批流：部门主管→财务→总裁</div>
          </div>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '85%',
                padding: '6px 10px',
                borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                background: m.role === 'user' ? '#1677ff' : '#f5f5f5',
                color: m.role === 'user' ? '#fff' : '#000',
                fontSize: 13,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.content || (m.streaming ? <Spin size="small" /> : '')}
            </div>
          </div>
        ))}
      </div>

      {/* Input area */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #f0f0f0',
          flexShrink: 0,
          display: 'flex',
          gap: 6,
          alignItems: 'flex-end',
        }}
      >
        <Input.TextArea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={configured ? '描述你要构建的流程... (Enter 发送)' : '点击右上角 ⚙ 先配置 AI'}
          disabled={loading}
          autoSize={{ minRows: 1, maxRows: 4 }}
          style={{ flex: 1, resize: 'none' }}
        />
        {loading ? (
          <Button size="small" danger onClick={handleStop}>
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            size="small"
            icon={<SendOutlined />}
            onClick={send}
            disabled={!input.trim() || !configured}
          />
        )}
      </div>

      {/* History Drawer */}
      <Drawer
        title="历史对话"
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        width={320}
        bodyStyle={{ padding: 0 }}
      >
        {history.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#bbb', padding: 32 }}>暂无历史记录</div>
        ) : (
          <List
            dataSource={history}
            renderItem={(session) => (
              <List.Item
                style={{ padding: '10px 16px', cursor: 'pointer' }}
                actions={[
                  <Popconfirm key="del" title="删除此记录？" okText="删除" cancelText="取消" onConfirm={() => handleDeleteHistory(session.id)}>
                    <Button size="small" type="text" danger>删除</Button>
                  </Popconfirm>,
                ]}
                onClick={() => handleRestoreHistory(session)}
              >
                <List.Item.Meta
                  title={<Text ellipsis style={{ maxWidth: 180 }}>{session.title}</Text>}
                  description={<Text type="secondary" style={{ fontSize: 11 }}>{session.savedAt} · {session.messages.length} 条</Text>}
                />
              </List.Item>
            )}
          />
        )}
      </Drawer>

      {/* 复用代码生成器的 AI 配置 Modal（同一份 sessionStorage 配置） */}
      <KeySettingModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
