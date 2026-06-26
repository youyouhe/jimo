import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Input,
  Button,
  Modal,
  Form,
  message,
  Spin,
  Typography,
  Space,
} from 'antd';
import { SendOutlined, SettingOutlined, RobotOutlined } from '@ant-design/icons';
import { useUserStore } from '@/stores/user';
import type LogicFlow from '@logicflow/core';

const { Text } = Typography;

const STORAGE_KEY = 'bpm_agent_config';

interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface Props {
  lf: LogicFlow | null;
  definitionId: string | null;
}

function msgId(): string {
  return Math.random().toString(36).slice(2);
}

function loadConfig(): AiConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<AiConfig>;
    if (c.apiKey && c.baseUrl && c.model) return c as AiConfig;
  } catch {
    /* ignore */
  }
  return null;
}

function saveConfig(c: AiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
}

/**
 * BPM Designer Agent Chat Panel.
 *
 * Sends messages to POST /api/v1/bpm/agent/chat with SSE streaming.
 * On canvas_update events, calls lf.render() to update the canvas.
 */
export default function AgentChat({ lf, definitionId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [form] = Form.useForm<AiConfig>();

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const getLfJson = useCallback(() => {
    if (!lf) return undefined;
    try {
      return (lf as any).getGraphData?.() ?? undefined;
    } catch {
      return undefined;
    }
  }, [lf]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const cfg = loadConfig();
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

            case 'canvas_update': {
              const payload = evt.data as { lfJson?: any; message?: string };
              if (payload?.lfJson && lf) {
                try {
                  (lf as any).render(payload.lfJson);
                } catch (err) {
                  console.error('[BpmAgent] lf.render failed:', err);
                }
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

  const handleSettingsSave = async () => {
    const v = await form.validateFields();
    saveConfig(v);
    message.success('AI 配置已保存');
    setSettingsOpen(false);
  };

  const openSettings = () => {
    const c = loadConfig();
    form.setFieldsValue(
      c || { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
    );
    setSettingsOpen(true);
  };

  const configured = !!loadConfig();

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
          <Text strong style={{ fontSize: 13 }}>
            AI 设计助手
          </Text>
        </Space>
        <Button
          size="small"
          type="text"
          icon={<SettingOutlined />}
          onClick={openSettings}
          title="配置 AI"
          style={{ color: configured ? '#1677ff' : '#faad14' }}
        />
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
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

      {/* Settings Modal */}
      <Modal
        title="配置 AI (OpenAI 兼容)"
        open={settingsOpen}
        onOk={handleSettingsSave}
        onCancel={() => setSettingsOpen(false)}
        okText="保存"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical">
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
            <Input placeholder="https://api.openai.com/v1" />
          </Form.Item>
          <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
            <Input.Password placeholder="sk-..." />
          </Form.Item>
          <Form.Item name="model" label="Model" rules={[{ required: true }]}>
            <Input placeholder="gpt-4o-mini" />
          </Form.Item>
        </Form>
        <div style={{ color: '#8c8c8c', fontSize: 12, lineHeight: 1.6 }}>
          Key 存于浏览器 localStorage，后端不落盘。支持任意 OpenAI 兼容服务。
        </div>
      </Modal>
    </div>
  );
}
