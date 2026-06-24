import { useState, useRef, useEffect, useCallback } from 'react';
import {
  Input, Button, Space, Typography, message, Empty, Popconfirm,
  Alert, Drawer, List, Tooltip,
} from 'antd';
import {
  SendOutlined, SettingOutlined, RobotOutlined, ClearOutlined,
  CheckOutlined, HistoryOutlined, PlusOutlined, DeleteOutlined, CopyOutlined,
} from '@ant-design/icons';
import type { AiMessage } from './types';
import { getProposeItems } from './types';
import type { AutoCodeDto } from '../../../services/autocode';
import { streamAiChat } from './sse';
import { loadAiConfig, isConfigured } from './key-config';
import { KeySettingModal } from './KeySettingModal';
import { MessageBubble } from './MessageBubble';
import { ProposeCard } from './ProposeCard';
import {
  migrateIfNeeded,
  loadConvList,
  loadConvMessages,
  saveConvMessages,
  updateConvMeta,
  createConv,
  deleteConv,
  clearConvMessages,
  type ConvMeta,
} from './history';

interface Props {
  onGenerate: (dto: AutoCodeDto) => void;
  onGenerateBatch?: (dtos: AutoCodeDto[]) => void;
  onFillForm: (dto: AutoCodeDto) => void;
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
  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'numeric', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AiGeneratorPanel({ onGenerate, onGenerateBatch, onFillForm }: Props) {
  // ── History bootstrap ───────────────────────────────────────────────────
  useEffect(() => { migrateIfNeeded(); }, []);

  const [convList, setConvList] = useState<ConvMeta[]>(() => {
    migrateIfNeeded();
    const list = loadConvList();
    return list;
  });

  // active conv id — create one if none exists
  const [activeId, setActiveId] = useState<string>(() => {
    const list = loadConvList();
    if (list.length > 0) return list[0].id;
    return createConv();
  });

  const [messages, setMessages] = useState<AiMessage[]>(() => loadConvMessages(activeId));
  const [historyOpen, setHistoryOpen] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const configured = isConfigured();

  // Persist whenever messages change
  useEffect(() => {
    saveConvMessages(activeId, messages);
    if (messages.length > 0) {
      updateConvMeta(activeId, messages);
      setConvList(loadConvList());
    }
  }, [messages, activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // ── Conv management ─────────────────────────────────────────────────────

  const switchConv = useCallback((id: string) => {
    if (loading) return;
    setActiveId(id);
    setMessages(loadConvMessages(id));
    setHistoryOpen(false);
  }, [loading]);

  const handleNewChat = useCallback(() => {
    if (loading) return;
    const id = createConv();
    setConvList(loadConvList());
    setActiveId(id);
    setMessages([]);
    setHistoryOpen(false);
  }, [loading]);

  const handleClearCurrent = useCallback(() => {
    clearConvMessages(activeId);
    setMessages([]);
    setConvList(loadConvList());
    message.success('对话历史已清除');
  }, [activeId]);

  const handleCopy = useCallback(() => {
    const text = messages
      .map((m) => `${m.role === 'user' ? 'You' : 'AI'}: ${m.content}`)
      .join('\n\n');
    navigator.clipboard.writeText(text).then(
      () => message.success('已复制'),
      () => message.error('复制失败'),
    );
  }, [messages]);

  const handleDeleteConv = useCallback((id: string) => {
    deleteConv(id);
    const updated = loadConvList();
    setConvList(updated);
    if (id === activeId) {
      if (updated.length > 0) {
        setActiveId(updated[0].id);
        setMessages(loadConvMessages(updated[0].id));
      } else {
        const newId2 = createConv();
        setConvList(loadConvList());
        setActiveId(newId2);
        setMessages([]);
      }
    }
  }, [activeId]);

  // ── Send ─────────────────────────────────────────────────────────────────

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const cfg = loadAiConfig();
    if (!cfg) { setKeyOpen(true); return; }

    const userMsg: AiMessage = { id: newId(), role: 'user', content: text };
    const aiMsg: AiMessage = { id: newId(), role: 'assistant', content: '', streaming: true };

    const history = [...messages, userMsg]
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    await streamAiChat(history, cfg, {
      onToken: (t) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content + t } : m)),
        );
      },
      onToolResult: (dto) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? { ...m, proposeItems: [...(m.proposeItems || []), { dto, status: 'pending' as const }] }
              : m,
          ),
        );
      },
      onProgress: (content, fallback) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? {
                  ...m,
                  progressLines: [...(m.progressLines || []), content],
                  noProposalFallback: fallback ? true : m.noProposalFallback,
                }
              : m,
          ),
        );
      },
      onError: (msg) => {
        message.error(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id
              ? { ...m, content: m.content || `(出错: ${msg})`, streaming: false }
              : m,
          ),
        );
      },
      onDone: () => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsg.id ? { ...m, streaming: false } : m)),
        );
      },
    }, ctrl.signal);

    setLoading(false);
    abortRef.current = null;
  };

  // ── Propose actions ──────────────────────────────────────────────────────

  const setItemStatus = (msgId: string, idx: number, status: 'confirmed' | 'rejected') => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== msgId) return m;
        const items = getProposeItems(m).map((it, i) => (i === idx ? { ...it, status } : it));
        return { ...m, proposeItems: items };
      }),
    );
  };

  const handleConfirm = (msgId: string, idx: number, dto: AutoCodeDto) => {
    setItemStatus(msgId, idx, 'confirmed');
    onGenerate(dto);
  };

  const handleConfirmAll = async (msg: AiMessage) => {
    const items = getProposeItems(msg);
    const pending = items.map((it, idx) => ({ idx, dto: it.dto })).filter((x) => items[x.idx].status === 'pending');
    if (pending.length === 0) return;
    const dtos = pending.map((p) => p.dto);
    setBatchLoading(true);
    try {
      if (onGenerateBatch) {
        onGenerateBatch(dtos);
      } else {
        for (const dto of dtos) {
          await new Promise<void>((resolve) => { onGenerate(dto); setTimeout(resolve, 0); });
        }
      }
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== msg.id) return m;
          const updated = getProposeItems(m).map((it) =>
            it.status === 'pending' ? { ...it, status: 'confirmed' as const } : it,
          );
          return { ...m, proposeItems: updated };
        }),
      );
    } finally {
      setBatchLoading(false);
    }
  };

  const handleEdit = (_msgId: string, dto: AutoCodeDto) => {
    onFillForm(dto);
    message.success('已填入下方代码生成器表单,可调整后生成');
  };

  // ── Active conv title ────────────────────────────────────────────────────
  const activeMeta = convList.find((c) => c.id === activeId);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <Space>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>AI 实体助手</Typography.Text>
          {activeMeta && messages.length > 0 && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              · {activeMeta.title}
            </Typography.Text>
          )}
        </Space>
        <Space size={4}>
          <Tooltip title="新对话">
            <Button size="small" icon={<PlusOutlined />} type="text" onClick={handleNewChat} disabled={loading} />
          </Tooltip>
          <Tooltip title="历史对话">
            <Button
              size="small"
              icon={<HistoryOutlined />}
              type="text"
              onClick={() => setHistoryOpen(true)}
            />
          </Tooltip>
          <Tooltip title="复制对话">
            <Button size="small" icon={<CopyOutlined />} type="text" disabled={messages.length === 0} onClick={handleCopy} />
          </Tooltip>
          <Popconfirm
            title="确定清除当前对话?"
            description="清除后不可恢复"
            onConfirm={handleClearCurrent}
            okText="确定"
            cancelText="取消"
            placement="bottomRight"
          >
            <Button size="small" icon={<ClearOutlined />} type="text" disabled={messages.length === 0} />
          </Popconfirm>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setKeyOpen(true)}
            type={configured ? 'text' : 'primary'}
          >
            {configured ? 'AI 配置' : '配置 AI'}
          </Button>
        </Space>
      </div>

      {/* Chat area */}
      <div
        ref={scrollRef}
        style={{ height: 260, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 6, padding: 8, background: '#fafafa' }}
      >
        {messages.length === 0 ? (
          <Empty
            style={{ marginTop: 60 }}
            description={
              <span style={{ fontSize: 12 }}>
                描述你想创建的实体,如:
                <br />「创建员工表,含工号、姓名、部门、联系方式」
                <br />或「帮我设计一套学籍管理,建好所有表」
              </span>
            }
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        ) : (
          messages.map((m) => {
            const items = getProposeItems(m);
            const pendingCount = items.filter((it) => it.status === 'pending').length;
            return (
              <div key={m.id}>
                <MessageBubble msg={m} />
                {m.progressLines && m.progressLines.length > 0 ? (
                  <div style={{ fontSize: 12, color: '#8c8c8c', margin: '-2px 2px 6px', lineHeight: 1.5 }}>
                    {m.progressLines.map((p, i) => <div key={i}>· {p}</div>)}
                  </div>
                ) : null}
                {items.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    {pendingCount >= 2 ? (
                      <div style={{ marginBottom: 6 }}>
                        <Button size="small" type="primary" icon={<CheckOutlined />} loading={batchLoading} onClick={() => handleConfirmAll(m)}>
                          全部确认创建 ({pendingCount})
                        </Button>
                      </div>
                    ) : null}
                    {items.map((item, idx) => (
                      <ProposeCard
                        key={idx}
                        dto={item.dto}
                        status={item.status}
                        onConfirm={() => handleConfirm(m.id, idx, item.dto)}
                        onEdit={() => handleEdit(m.id, item.dto)}
                      />
                    ))}
                  </div>
                ) : m.noProposalFallback && !m.streaming ? (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginTop: 4, marginBottom: 8, fontSize: 12 }}
                    message="AI 本轮未给出可创建的方案"
                    description="可更明确地描述要建的表(例如「创建员工表,含工号、姓名、部门」),AI 会直接提交方案。"
                  />
                ) : null}
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <Space.Compact style={{ width: '100%', marginTop: 8 }}>
        <Input
          placeholder="描述你要创建的实体表(可一次描述多个表)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={send}
          disabled={loading}
        />
        {loading ? (
          <Button
            danger
            onClick={() => { abortRef.current?.abort(); }}
          >
            停止
          </Button>
        ) : (
          <Button type="primary" icon={<SendOutlined />} onClick={send}>
            发送
          </Button>
        )}
      </Space.Compact>

      {/* History Drawer */}
      <Drawer
        title={
          <Space>
            <HistoryOutlined />
            历史对话
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              ({convList.length} 条)
            </Typography.Text>
          </Space>
        }
        placement="right"
        width={320}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        extra={
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNewChat} disabled={loading}>
            新对话
          </Button>
        }
      >
        {convList.length === 0 ? (
          <Empty description="暂无历史对话" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ marginTop: 60 }} />
        ) : (
          <List
            dataSource={convList}
            renderItem={(conv) => {
              const isActive = conv.id === activeId;
              return (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    background: isActive ? '#e6f4ff' : undefined,
                    borderRadius: 6,
                    padding: '8px 12px',
                    marginBottom: 4,
                    border: isActive ? '1px solid #91caff' : '1px solid transparent',
                  }}
                  onClick={() => switchConv(conv.id)}
                  actions={[
                    <Popconfirm
                      key="del"
                      title="删除此对话?"
                      onConfirm={(e) => { e?.stopPropagation(); handleDeleteConv(conv.id); }}
                      okText="删除"
                      cancelText="取消"
                      placement="left"
                    >
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Popconfirm>,
                  ]}
                >
                  <List.Item.Meta
                    title={
                      <Typography.Text ellipsis style={{ fontSize: 13, maxWidth: 180 }}>
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
              );
            }}
          />
        )}
      </Drawer>

      <KeySettingModal open={keyOpen} onClose={() => setKeyOpen(false)} />
    </div>
  );
}
