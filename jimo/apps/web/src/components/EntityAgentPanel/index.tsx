import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Modal, Input, Button, Space, Typography, Empty, message,
  Drawer, List, Popconfirm, Tooltip,
} from 'antd';
import {
  SendOutlined, RobotOutlined, ClearOutlined,
  HistoryOutlined, PlusOutlined, DeleteOutlined, CopyOutlined,
} from '@ant-design/icons';
import { useUserStore } from '@/stores/user';
import { loadAiConfig } from '@/pages/autocode/AiGenerator/key-config';
import type { ChatMessage } from './types';
import {
  loadConvList, loadConvMessages, saveConvMessages, updateConvMeta,
  createConv, deleteConv, clearConvMessages, type ConvMeta,
} from './history';

export interface EntityAgentPanelProps {
  open: boolean;
  businessType: string;
  onClose: () => void;
}

/** SSE event from the ai-chat endpoint */
interface SseEvent {
  kind: 'token' | 'tool_result' | 'error' | 'done' | 'progress';
  content?: string;
  dto?: any;
  message?: string;
  fallback?: boolean;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (isToday) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  );
}

export default function EntityAgentPanel({ open, businessType, onClose }: EntityAgentPanelProps) {
  const [convList, setConvList] = useState<ConvMeta[]>(() => loadConvList(businessType));
  const [activeId, setActiveId] = useState<string>(() => {
    const list = loadConvList(businessType);
    if (list.length > 0) return list[0].id;
    return createConv(businessType);
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadConvMessages(businessType, loadConvList(businessType)[0]?.id ?? ''),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Persist messages on change
  useEffect(() => {
    if (messages.length === 0) return;
    saveConvMessages(businessType, activeId, messages);
    updateConvMeta(businessType, activeId, messages);
    setConvList(loadConvList(businessType));
  }, [messages, activeId, businessType]);

  const switchConv = useCallback((id: string) => {
    setActiveId(id);
    setMessages(loadConvMessages(businessType, id));
    setHistoryOpen(false);
  }, [businessType]);

  const handleNewConv = useCallback(() => {
    const id = createConv(businessType);
    setActiveId(id);
    setMessages([]);
    setConvList(loadConvList(businessType));
    setHistoryOpen(false);
  }, [businessType]);

  const handleDeleteConv = useCallback((id: string) => {
    deleteConv(businessType, id);
    const list = loadConvList(businessType);
    setConvList(list);
    if (id === activeId) {
      if (list.length > 0) {
        setActiveId(list[0].id);
        setMessages(loadConvMessages(businessType, list[0].id));
      } else {
        const newId2 = createConv(businessType);
        setActiveId(newId2);
        setMessages([]);
        setConvList(loadConvList(businessType));
      }
    }
  }, [activeId, businessType]);

  const handleClear = useCallback(() => {
    clearConvMessages(businessType, activeId);
    setMessages([]);
    setConvList(loadConvList(businessType));
    message.success('对话已清除');
  }, [activeId, businessType]);

  const handleCopy = useCallback(() => {
    const text = messages
      .map((m) => `${m.role === 'user' ? 'You' : 'AI'}: ${m.content}`)
      .join('\n\n');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(
        () => message.success('已复制'),
        () => message.error('复制失败'),
      );
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      message.success('已复制');
    }
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const cfg = loadAiConfig();
    if (!cfg) {
      message.warning('请先在「代码生成器」页面配置 AI 连接信息（API Key / Base URL / Model）');
      return;
    }

    const userMsg: ChatMessage = { id: newId(), role: 'user', content: text };
    const aiMsg: ChatMessage = { id: newId(), role: 'assistant', content: '', streaming: true };

    // Only send role+content to model — strip progressLines (tool notes) to
    // avoid inflating context with operational output that the model doesn't need.
    const history = [...messages, userMsg]
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const { accessToken } = useUserStore.getState();

    try {
      const resp = await fetch('/api/v1/autocode/ai-chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken ? `Bearer ${accessToken}` : '',
          'X-AI-Api-Key': cfg.apiKey,
          'X-AI-Base-URL': cfg.baseUrl,
          'X-AI-Model': cfg.model,
        },
        body: JSON.stringify({ businessType, messages: history }),
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        const txt = await resp.text().catch(() => '');
        message.error(`AI 请求失败 ${resp.status}: ${txt.slice(0, 300)}`);
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsg.id ? { ...m, content: '(请求失败)', streaming: false } : m)),
        );
        setLoading(false);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
          let evt: SseEvent;
          try { evt = JSON.parse(data); } catch { continue; }
          switch (evt.kind) {
            case 'token':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsg.id ? { ...m, content: m.content + (evt.content || '') } : m,
                ),
              );
              break;
            case 'progress':
              // Store progress notes separately — never append to content to avoid
              // inflating the context sent back to the model on the next turn.
              if (evt.content) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === aiMsg.id
                      ? { ...m, progressLines: [...(m.progressLines ?? []), evt.content!] }
                      : m,
                  ),
                );
              }
              break;
            case 'error':
              message.error(evt.message || 'AI 出错');
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsg.id
                    ? { ...m, content: m.content || `(出错: ${evt.message})`, streaming: false }
                    : m,
                ),
              );
              break;
            case 'done':
              setMessages((prev) =>
                prev.map((m) => (m.id === aiMsg.id ? { ...m, streaming: false } : m)),
              );
              break;
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        message.error(err?.message || '流读取中断');
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? { ...m, content: m.content || '(连接中断)', streaming: false }
              : m,
          ),
        );
      }
    }

    setLoading(false);
    abortRef.current = null;
  };

  return (
    <>
      <Modal
        title={
          <Space>
            <RobotOutlined style={{ color: '#1677ff' }} />
            <span>AI 助手 - {businessType}</span>
          </Space>
        }
        open={open}
        onCancel={() => {
          if (loading && abortRef.current) abortRef.current.abort();
          onClose();
        }}
        width={560}
        footer={null}
        destroyOnClose={false}
      >
        {/* Toolbar */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 6 }}>
          <Tooltip title="新建对话">
            <Button size="small" icon={<PlusOutlined />} onClick={handleNewConv} />
          </Tooltip>
          <Tooltip title="历史对话">
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => { setConvList(loadConvList(businessType)); setHistoryOpen(true); }}
            />
          </Tooltip>
          <Tooltip title="复制对话">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={handleCopy}
              disabled={messages.length === 0}
            />
          </Tooltip>
          <Tooltip title="清除当前对话">
            <Button
              size="small"
              icon={<ClearOutlined />}
              onClick={handleClear}
              disabled={messages.length === 0}
            />
          </Tooltip>
        </div>

        {/* Messages area */}
        <div
          ref={scrollRef}
          style={{
            height: 360,
            overflowY: 'auto',
            border: '1px solid #f0f0f0',
            borderRadius: 6,
            padding: 12,
            background: '#fafafa',
            marginBottom: 12,
          }}
        >
          {messages.length === 0 ? (
            <Empty
              style={{ marginTop: 100 }}
              description={
                <span style={{ fontSize: 13 }}>
                  向 AI 助手提问关于「{businessType}」的问题
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    例如：「查询所有记录」「最近创建的有哪些」「帮我一键 mock 10 条数据」
                  </Typography.Text>
                </span>
              }
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                style={{
                  marginBottom: 12,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '85%',
                    padding: '8px 12px',
                    borderRadius: 8,
                    background: m.role === 'user' ? '#1677ff' : '#fff',
                    color: m.role === 'user' ? '#fff' : '#333',
                    border: m.role === 'user' ? 'none' : '1px solid #e8e8e8',
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {m.streaming && !m.content && !m.progressLines?.length ? (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>思考中...</Typography.Text>
                  ) : (
                    <>
                      {m.progressLines && m.progressLines.length > 0 && (
                        <div style={{ marginBottom: m.content ? 6 : 0 }}>
                          {m.progressLines.map((line, i) => (
                            <Typography.Text
                              key={i}
                              type="secondary"
                              style={{ fontSize: 11, display: 'block', lineHeight: 1.5 }}
                            >
                              ▸ {line}
                            </Typography.Text>
                          ))}
                        </div>
                      )}
                      {m.content}
                    </>
                  )}
                </div>
                <Typography.Text
                  type="secondary"
                  style={{ fontSize: 11, marginTop: 2, marginLeft: 4, marginRight: 4 }}
                >
                  {m.role === 'user' ? 'You' : 'AI'}
                </Typography.Text>
              </div>
            ))
          )}
        </div>

        {/* Input area */}
        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={`向 AI 询问关于「${businessType}」的问题...`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={send}
            disabled={loading}
          />
          {loading ? (
            <Button danger onClick={() => { abortRef.current?.abort(); }}>
              停止
            </Button>
          ) : (
            <Button type="primary" icon={<SendOutlined />} onClick={send}>
              发送
            </Button>
          )}
        </Space.Compact>
      </Modal>

      {/* History drawer */}
      <Drawer
        title="历史对话"
        placement="right"
        width={300}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        extra={
          <Button size="small" icon={<PlusOutlined />} onClick={handleNewConv}>
            新对话
          </Button>
        }
      >
        <List
          dataSource={convList}
          locale={{ emptyText: '暂无历史对话' }}
          renderItem={(conv) => (
            <List.Item
              style={{
                cursor: 'pointer',
                background: conv.id === activeId ? '#e6f4ff' : undefined,
                borderRadius: 6,
                padding: '8px 10px',
              }}
              onClick={() => switchConv(conv.id)}
              actions={[
                <Popconfirm
                  key="del"
                  title="删除此对话？"
                  onConfirm={() => handleDeleteConv(conv.id)}
                >
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Popconfirm>,
              ]}
            >
              <List.Item.Meta
                title={
                  <Typography.Text
                    ellipsis
                    style={{ fontSize: 13, fontWeight: conv.id === activeId ? 600 : 400 }}
                  >
                    {conv.title}
                  </Typography.Text>
                }
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                    {formatTime(conv.updatedAt)}
                  </Typography.Text>
                }
              />
            </List.Item>
          )}
        />
      </Drawer>
    </>
  );
}
