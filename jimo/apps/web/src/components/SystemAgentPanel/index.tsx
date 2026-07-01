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

export interface SystemAgentPanelProps {
  open: boolean;
  agentType: 'users' | 'departments' | 'employees' | 'menus' | 'packages';
  onClose: () => void;
}

interface SseEvent {
  kind: 'token' | 'tool_result' | 'error' | 'done' | 'progress';
  content?: string;
  dto?: any;
  message?: string;
}

const AGENT_LABELS: Record<string, string> = {
  users: '账号管理',
  departments: '组织管理',
  employees: '员工管理',
  menus: '菜单管理',
  packages: '模板包管理',
};

const AGENT_EXAMPLES: Record<string, string> = {
  users: '例如：「查询所有用户」「创建一个新账号」「把小王设为管理员」「软删除 zhangsan」',
  departments: '例如：「列出所有部门」「创建技术部」「把销售部的负责人改成李总」',
  employees: '例如：「查询在职员工」「新员工张三，工号E001，入职技术部」「帮小王改下手机号」',
  menus: '例如：「列出菜单树」「创建新菜单」「把某菜单改为隐藏」「把按钮移到某目录下」',
  packages: '例如：「列出所有包」「创建一个新包」「查看包的菜单分类」「清理孤立菜单」',
};

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

export default function SystemAgentPanel({ open, agentType, onClose }: SystemAgentPanelProps) {
  const label = AGENT_LABELS[agentType] || agentType;
  const [convList, setConvList] = useState<ConvMeta[]>(() => loadConvList(agentType));
  const [activeId, setActiveId] = useState<string>(() => {
    const list = loadConvList(agentType);
    if (list.length > 0) return list[0].id;
    return createConv(agentType);
  });
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadConvMessages(agentType, loadConvList(agentType)[0]?.id ?? ''),
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (messages.length === 0) return;
    saveConvMessages(agentType, activeId, messages);
    updateConvMeta(agentType, activeId, messages);
    setConvList(loadConvList(agentType));
  }, [messages, activeId, agentType]);

  const switchConv = useCallback((id: string) => {
    setActiveId(id);
    setMessages(loadConvMessages(agentType, id));
    setHistoryOpen(false);
  }, [agentType]);

  const handleNewConv = useCallback(() => {
    const id = createConv(agentType);
    setActiveId(id);
    setMessages([]);
    setConvList(loadConvList(agentType));
    setHistoryOpen(false);
  }, [agentType]);

  const handleDeleteConv = useCallback((id: string) => {
    deleteConv(agentType, id);
    const list = loadConvList(agentType);
    setConvList(list);
    if (id === activeId) {
      if (list.length > 0) {
        setActiveId(list[0].id);
        setMessages(loadConvMessages(agentType, list[0].id));
      } else {
        const newId2 = createConv(agentType);
        setActiveId(newId2);
        setMessages([]);
        setConvList(loadConvList(agentType));
      }
    }
  }, [activeId, agentType]);

  const handleClear = useCallback(() => {
    clearConvMessages(agentType, activeId);
    setMessages([]);
    setConvList(loadConvList(agentType));
    message.success('对话已清除');
  }, [activeId, agentType]);

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

    const history = [...messages, userMsg]
      .filter((m) => m.content && !m.content.startsWith('⚠️'))
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const { accessToken } = useUserStore.getState();

    try {
      const resp = await fetch('/api/v1/system-agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken ? `Bearer ${accessToken}` : '',
          'x-api-key': cfg.apiKey,
          'x-base-url': cfg.baseUrl,
          'x-model': cfg.model,
        },
        body: JSON.stringify({ agentType, messages: history }),
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
            case 'error': {
              const errMsg = evt.message || 'AI 出错';
              const friendlyMsg = (() => {
                try {
                  const m = errMsg.match(/:\s*(\{.*\})/s);
                  if (m) {
                    const obj = JSON.parse(m[1]);
                    return obj?.error?.message || errMsg;
                  }
                } catch { /* ignore */ }
                return errMsg;
              })();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiMsg.id
                    ? { ...m, content: `⚠️ ${friendlyMsg}`, streaming: false }
                    : m,
                ),
              );
              break;
            }
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
    } finally {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== aiMsg.id) return m;
          if (!m.streaming) return m;
          return { ...m, content: '⚠️ AI 无响应（可能是 API 余额不足或网络问题，请检查 AI 配置）', streaming: false };
        }),
      );
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
            <span>AI 助手 - {label}</span>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 6 }}>
          <Tooltip title="新建对话">
            <Button size="small" icon={<PlusOutlined />} onClick={handleNewConv} />
          </Tooltip>
          <Tooltip title="历史对话">
            <Button
              size="small"
              icon={<HistoryOutlined />}
              onClick={() => { setConvList(loadConvList(agentType)); setHistoryOpen(true); }}
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
                  向 AI 助手提问关于「{label}」的问题
                  <br />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {AGENT_EXAMPLES[agentType]}
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

        <Space.Compact style={{ width: '100%' }}>
          <Input
            placeholder={`向 AI 询问关于「${label}」的问题...`}
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
