import { useState, useRef, useEffect, useCallback } from 'react';
import { Input, Button, Space, Typography, message, Empty, Popconfirm, Alert } from 'antd';
import { SendOutlined, SettingOutlined, RobotOutlined, ClearOutlined, CheckOutlined } from '@ant-design/icons';
import type { AiMessage } from './types';
import { getProposeItems } from './types';
import type { AutoCodeDto } from '../../../services/autocode';
import { streamAiChat } from './sse';
import { loadAiConfig, isConfigured } from './key-config';
import { KeySettingModal } from './KeySettingModal';
import { MessageBubble } from './MessageBubble';
import { ProposeCard } from './ProposeCard';
import { loadHistory, saveHistory, clearHistory } from './history';

interface Props {
  /** 确认创建单个:父组件触发生成(复用现有进度 modal 流程) */
  onGenerate: (dto: AutoCodeDto) => void;
  /** 确认创建多个(批量):父组件按顺序依次生成。可选;缺省时回退为顺序调用 onGenerate */
  onGenerateBatch?: (dtos: AutoCodeDto[]) => void;
  /** 填入表单修改:父组件把 dto 写入代码生成器表单 */
  onFillForm: (dto: AutoCodeDto) => void;
}

function newId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : String(Date.now() + Math.random());
}

export function AiGeneratorPanel({ onGenerate, onGenerateBatch, onFillForm }: Props) {
  const [messages, setMessages] = useState<AiMessage[]>(() => loadHistory());
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [batchLoading, setBatchLoading] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const configured = isConfigured();

  // 消息变化时持久化到 localStorage
  useEffect(() => {
    saveHistory(messages);
  }, [messages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const handleClear = useCallback(() => {
    setMessages([]);
    clearHistory();
    message.success('对话历史已清除');
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text) return;
    if (loading) return;
    const cfg = loadAiConfig();
    if (!cfg) {
      setKeyOpen(true);
      return;
    }

    const userMsg: AiMessage = { id: newId(), role: 'user', content: text };
    const aiMsg: AiMessage = { id: newId(), role: 'assistant', content: '', streaming: true };

    // 已生成实体/字典/Package 的上下文统一由后端按 DB 实时状态注入(systemWithCtx),
    // 前端只回传纯对话历史,避免"前端本地态 vs 后端 DB 快照"两份上下文不同步。
    const history = [...messages, userMsg]
      .filter((m) => m.content)
      .map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput('');
    setLoading(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    await streamAiChat(
      history,
      cfg,
      {
        onToken: (t) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === aiMsg.id ? { ...m, content: m.content + t } : m)),
          );
        },
        // 累加到 proposeItems(支持一轮多表批量),而不是覆盖单值。
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
      },
      ctrl.signal,
    );

    setLoading(false);
    abortRef.current = null;
  };

  /** 标记某条消息中第 idx 个方案为指定状态(不可变更新)。 */
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

  /** 批量确认:把该消息里所有 pending 方案一次性创建。 */
  const handleConfirmAll = async (msg: AiMessage) => {
    const items = getProposeItems(msg);
    const pending = items
      .map((it, idx) => ({ idx, dto: it.dto }))
      .filter((x) => items[x.idx].status === 'pending');
    if (pending.length === 0) return;
    const dtos = pending.map((p) => p.dto);

    setBatchLoading(true);
    try {
      if (onGenerateBatch) {
        onGenerateBatch(dtos);
      } else {
        // 回退:顺序逐个生成,避免并发冲突(drizzle push / 文件写入)
        for (const dto of dtos) {
          await new Promise<void>((resolve) => {
            // onGenerate 触发父级 async 流程;这里仅排队,具体 await 由父级负责
            onGenerate(dto);
            // 让出一拍,使父级进度流程串行
            setTimeout(resolve, 0);
          });
        }
      }
      // 全部标记为已创建
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

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 8,
        }}
      >
        <Space>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>AI 实体助手</Typography.Text>
        </Space>
        <Space size={4}>
          <Popconfirm
            title="确定清除所有对话历史?"
            description="清除后不可恢复"
            onConfirm={handleClear}
            okText="确定"
            cancelText="取消"
            placement="bottomRight"
          >
            <Button
              size="small"
              icon={<ClearOutlined />}
              type="text"
              disabled={messages.length === 0}
            />
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

      <div
        ref={scrollRef}
        style={{
          height: 260,
          overflowY: 'auto',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          padding: 8,
          background: '#fafafa',
        }}
      >
        {messages.length === 0 ? (
          <Empty
            style={{ marginTop: 60 }}
            description={
              <span style={{ fontSize: 12 }}>
                描述你想创建的实体,如:
                <br />
                「创建员工表,含工号、姓名、部门、联系方式」
                <br />
                或「帮我设计一套学籍管理,建好所有表」
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
                  <div
                    style={{
                      fontSize: 12,
                      color: '#8c8c8c',
                      margin: '-2px 2px 6px',
                      lineHeight: 1.5,
                    }}
                  >
                    {m.progressLines.map((p, i) => (
                      <div key={i}>· {p}</div>
                    ))}
                  </div>
                ) : null}
                {items.length > 0 ? (
                  <div style={{ marginTop: 4 }}>
                    {pendingCount >= 2 ? (
                      <div style={{ marginBottom: 6 }}>
                        <Button
                          size="small"
                          type="primary"
                          icon={<CheckOutlined />}
                          loading={batchLoading}
                          onClick={() => handleConfirmAll(m)}
                        >
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

      <Space.Compact style={{ width: '100%', marginTop: 8 }}>
        <Input
          placeholder="描述你要创建的实体表(可一次描述多个表)..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onPressEnter={send}
          disabled={loading}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={send}
          loading={loading}
        >
          发送
        </Button>
      </Space.Compact>

      <KeySettingModal open={keyOpen} onClose={() => setKeyOpen(false)} />
    </div>
  );
}
