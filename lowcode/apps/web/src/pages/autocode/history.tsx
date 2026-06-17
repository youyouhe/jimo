import { useRef, useState, useEffect, useCallback } from 'react';
import { Button, Drawer, message, Modal, Space, Typography, Tabs, Tag, Alert, Progress, Checkbox } from 'antd';
import {
  EyeOutlined,
  RollbackOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  getAutoCodeHistory,
  getAutoCodeHistoryDetail,
  rollbackAutoCodeHistory,
  deleteAutoCodeHistory,
  analyzeImpact,
  getDeleteStatus,
  type AutoCodeHistory,
  type ImpactAnalysis,
  type CascadeChainEntry,
  type GenerateStep,
  type GenerateJobStatus,
} from '@/services/autocode';
import request from '@/services/request';
import { useUserStore } from '@/stores/user';

const { Text, Title } = Typography;

function getFileLabel(path: string): string {
  if (path.includes('schema')) return 'Schema';
  if (path.includes('create-') && path.includes('.dto')) return 'Create DTO';
  if (path.includes('query-') && path.includes('.dto')) return 'Query DTO';
  if (path.includes('update-') && path.includes('.dto')) return 'Update DTO';
  if (path.endsWith('.service.ts')) return 'Service';
  if (path.endsWith('.controller.ts')) return 'Controller';
  if (path.endsWith('.module.ts')) return 'Module';
  if (path.includes('/services/')) return 'Frontend Service';
  if (path.includes('/pages/')) return 'Frontend Page';
  return path.split('/').pop() || path;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Shared step icon
// ---------------------------------------------------------------------------

function StepIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
    case 'running':
      return <LoadingOutlined style={{ color: '#1677ff' }} spin />;
    case 'failed':
      return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />;
    default:
      return <ClockCircleOutlined style={{ color: '#d9d9d9' }} />;
  }
}

// ---------------------------------------------------------------------------
// Delete Progress Modal
// ---------------------------------------------------------------------------

interface DeleteProgressModalProps {
  open: boolean;
  jobId: string | null;
  tableName: string;
  onClose: () => void;
  onComplete: () => void;
}

function DeleteProgressModal({
  open,
  jobId,
  tableName,
  onClose,
  onComplete,
}: DeleteProgressModalProps) {
  const [jobStatus, setJobStatus] = useState<GenerateJobStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);
  const refreshMenus = useUserStore((s) => s.refreshMenus);

  const MAX_FAIL_COUNT = 15; // ~30 seconds of consecutive failures

  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  useEffect(() => {
    if (open && jobId) {
      setJobStatus(null);
      setPollError(null);
      failCountRef.current = 0;
    }
    if (!open) clearTimers();
  }, [open, jobId, clearTimers]);

  // Polling logic
  useEffect(() => {
    if (!open || !jobId) return;
    if (jobStatus?.status === 'completed' || jobStatus?.status === 'failed') return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const status = await getDeleteStatus(jobId);
        if (cancelled) return;
        setJobStatus(status);
        setPollError(null);
        failCountRef.current = 0;

        if (status.status === 'completed' || status.status === 'failed') return;
        pollTimerRef.current = setTimeout(poll, 800);
      } catch (err: any) {
        if (cancelled) return;
        failCountRef.current += 1;

        // Too many consecutive failures → treat as expired
        if (failCountRef.current >= MAX_FAIL_COUNT) {
          setJobStatus({
            jobId: jobId,
            status: 'failed',
            steps: [],
            progress: 0,
            currentStepLabel: '任务已过期或丢失',
            error: '无法获取任务状态（可能已过期）。请关闭后重试。',
          });
          clearDeleteJob();
          return;
        }

        if (jobStatus && jobStatus.progress >= 70) {
          // Most steps done, backend likely restarting
          setJobStatus({
            ...jobStatus,
            status: 'completed',
            progress: 100,
            currentStepLabel: '删除完成',
            result: jobStatus.result || undefined,
            completedAt: new Date().toISOString(),
          });
          return;
        }
        setPollError('连接中断，正在重试...');
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };

    pollTimerRef.current = setTimeout(poll, 500);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [open, jobId, jobStatus?.status, jobStatus?.progress]);

  const isComplete = jobStatus?.status === 'completed';
  const isFailed = jobStatus?.status === 'failed';
  const isTerminal = isComplete || isFailed;

  const handleDone = async () => {
    // Refresh menu tree to remove deleted module from sidebar on next reload
    try {
      await refreshMenus();
    } catch { /* non-critical */ }
    onComplete();
  };

  // Build result summary
  const resultSummary = isComplete && jobStatus?.result ? (() => {
    const r = jobStatus.result;
    const parts: string[] = [];
    if (r.deletedFiles?.length > 0) parts.push(`${r.deletedFiles.length} 个文件`);
    if (r.droppedTable) parts.push('数据库表');
    if (r.removedMenus > 0) parts.push(`${r.removedMenus} 个菜单`);
    return parts.length > 0 ? `已清理：${parts.join('、')}` : '';
  })() : '';

  return (
    <Modal
      title={
        <Space>
          {isComplete ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
           isFailed ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> :
           <LoadingOutlined spin />}
          删除进度 — {tableName}
        </Space>
      }
      open={open}
      onCancel={isTerminal ? onClose : undefined}
      closable={isTerminal}
      maskClosable={false}
      width={520}
      footer={
        isComplete ? (
          <Button type="primary" onClick={handleDone}>
            完成
          </Button>
        ) : isFailed ? (
          <Button onClick={onClose}>关闭</Button>
        ) : null
      }
    >
      {/* Progress bar */}
      <Progress
        percent={jobStatus?.progress ?? 0}
        status={isFailed ? 'exception' : isComplete ? 'success' : 'active'}
        style={{ marginBottom: 16 }}
      />

      {/* Current status */}
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        {!jobStatus && !pollError && (
          <Text type="secondary"><LoadingOutlined spin /> 正在启动删除任务...</Text>
        )}
        {pollError && !isTerminal && (
          <Text type="warning"><LoadingOutlined spin /> {pollError}</Text>
        )}
        {jobStatus && !isTerminal && (
          <Text type="secondary"><LoadingOutlined spin /> {jobStatus.currentStepLabel}</Text>
        )}
        {isComplete && (
          <Text type="success">删除完成！{resultSummary}</Text>
        )}
        {isFailed && (
          <Text type="danger">{jobStatus?.error || '删除失败'}</Text>
        )}
      </div>

      {/* Step list */}
      {jobStatus?.steps && (
        <div style={{ background: '#fafafa', borderRadius: 8, padding: '12px 16px' }}>
          {jobStatus.steps.map((step: GenerateStep, index: number) => (
            <div
              key={step.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 0',
                borderBottom: index < jobStatus.steps.length - 1 ? '1px solid #f0f0f0' : 'none',
              }}
            >
              <StepIcon status={step.status} />
              <Text style={{ flex: 1, color: step.status === 'pending' ? '#bbb' : undefined }}>
                {step.label}
              </Text>
              {step.status === 'completed' && (
                <Text type="success" style={{ fontSize: 12 }}>✓</Text>
              )}
            </div>
          ))}
        </div>
      )}

      {isFailed && jobStatus?.error && (
        <div style={{ marginTop: 12, padding: 12, background: '#fff2f0', borderRadius: 6 }}>
          <Text type="danger" style={{ fontSize: 13 }}>{jobStatus.error}</Text>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Impact report component
// ---------------------------------------------------------------------------

function ImpactReport({ impact }: { impact: ImpactAnalysis }) {
  const hasIssues = impact.recordCount > 0 || impact.referencedBy.length > 0;

  return (
    <div style={{ marginTop: 8 }}>
      {hasIssues && (
        <Alert
          type="warning"
          showIcon
          icon={<ExclamationCircleOutlined />}
          message="此操作存在以下影响，请仔细确认"
          style={{ marginBottom: 16 }}
        />
      )}

      <div style={{ marginBottom: 12 }}>
        <Text strong>数据库表: </Text>
        <Tag color="blue">{impact.dbTableName}</Tag>
        <Text type={impact.recordCount > 0 ? 'danger' : 'secondary'}>
          {impact.recordCount > 0
            ? `⚠ 包含 ${impact.recordCount} 条记录，删除后数据将丢失`
            : '空表，无数据丢失风险'}
        </Text>
      </div>

      {impact.referencedBy.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong>外键依赖: </Text>
          <Text type="danger">被以下表引用，删除后关联关系将断开</Text>
          <div style={{ marginTop: 8, paddingLeft: 16 }}>
            {impact.referencedBy.map((ref, i) => (
              <div key={i} style={{ marginBottom: 4 }}>
                <LinkOutlined style={{ marginRight: 4, color: '#faad14' }} />
                <Tag>{ref.table}</Tag>
                <Text type="secondary">.{ref.column}</Text>
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>({ref.constraint})</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cascade chain detail */}
      {impact.cascadeChain && impact.cascadeChain.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong>级联影响: </Text>
          <Text type="danger">以下关联表及其代码/菜单将被一并删除</Text>
          <div style={{ marginTop: 8 }}>
            {impact.cascadeChain.map((entry, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 8,
                  padding: '8px 12px',
                  background: '#fff1f0',
                  borderRadius: 6,
                  border: '1px solid #ffa39e',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <Tag color="red">{entry.dbTable}</Tag>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {entry.recordCount > 0 ? `${entry.recordCount} 条记录` : '空表'}
                  </Text>
                  {entry.hasHistory && (
                    <Tag color="orange" style={{ fontSize: 11 }}>有历史</Tag>
                  )}
                </div>
                {entry.files.length > 0 && (
                  <div style={{ fontSize: 12, color: '#999', paddingLeft: 4 }}>
                    文件: {entry.files.map(f => f.split('/').pop()).join(', ')}
                  </div>
                )}
                {entry.menus.length > 0 && (
                  <div style={{ fontSize: 12, color: '#999', paddingLeft: 4 }}>
                    菜单: {entry.menus.map(m => m.name).join(', ')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {impact.menus.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong>菜单记录: </Text>
          <Text>{impact.menus.length} 个菜单将被删除</Text>
          {impact.roleMenuCount > 0 && (
            <Text type="warning" style={{ marginLeft: 8 }}>
              ({impact.roleMenuCount} 个角色-菜单关联将被移除)
            </Text>
          )}
          <div style={{ marginTop: 4, paddingLeft: 16 }}>
            {impact.menus.map((m, i) => (
              <div key={i}>
                <Tag>{m.name}</Tag>
                <Text type="secondary">{m.path}</Text>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <Text strong>生成文件: </Text>
        <Text>{impact.files.length} 个文件将被删除</Text>
        <div style={{ marginTop: 4, paddingLeft: 16 }}>
          {impact.files.map((f, i) => (
            <div key={i} style={{ fontSize: 12, color: '#999' }}>
              {f}
            </div>
          ))}
        </div>
      </div>

      {impact.hasHistory && (
        <div>
          <Text strong>历史记录: </Text>
          <Text type="secondary">存在生成历史记录</Text>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session storage for delete job (survives HMR reload)
// ---------------------------------------------------------------------------

const DELETE_JOB_KEY = 'autocode-delete-job';

function saveDeleteJob(jobId: string, tableName: string) {
  try { sessionStorage.setItem(DELETE_JOB_KEY, JSON.stringify({ jobId, tableName })); } catch { /* ignore */ }
}
function loadDeleteJob(): { jobId: string; tableName: string } | null {
  try { const r = sessionStorage.getItem(DELETE_JOB_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearDeleteJob() {
  try { sessionStorage.removeItem(DELETE_JOB_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Wait for backend to come back up after hot-reload triggered by file deletion
// ---------------------------------------------------------------------------

async function waitForBackend(timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await request.get('/health');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  // Timed out — proceed anyway, the delete request will surface any real error
}

// ---------------------------------------------------------------------------
// Batch Delete Modal
// ---------------------------------------------------------------------------

interface BatchDeleteItem {
  id: string;
  tableName: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  error?: string;
}

interface BatchDeleteModalProps {
  open: boolean;
  items: BatchDeleteItem[];
  onClose: () => void;
  onComplete: () => void;
}

function BatchDeleteModal({ open, items: initialItems, onClose, onComplete }: BatchDeleteModalProps) {
  const [items, setItems] = useState<BatchDeleteItem[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const abortRef = useRef(false);

  useEffect(() => {
    if (open) {
      setItems(initialItems.map(i => ({ ...i, status: 'pending' })));
      setRunning(false);
      setDone(false);
      abortRef.current = false;
    }
  }, [open, initialItems]);

  const runBatch = async () => {
    setRunning(true);
    let hasError = false;

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;
      const item = items[i];

      setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'running' } : it));

      try {
        const { jobId } = await deleteAutoCodeHistory(item.id, false);

        // Poll until complete
        let attempts = 0;
        while (attempts < 60) {
          if (abortRef.current) break;
          await new Promise(r => setTimeout(r, 1000));
          try {
            const s = await getDeleteStatus(jobId);
            if (s.status === 'completed') break;
            if (s.status === 'failed') throw new Error(s.error || '删除失败');
          } catch (pollErr: any) {
            // Backend may restart mid-delete — treat as done if > 5 polls passed
            if (attempts > 5) break;
          }
          attempts++;
        }

        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'completed' } : it));

        // Backend may restart (watch mode recompiles after file deletion) — wait until healthy before next delete
        if (i < items.length - 1) {
          await waitForBackend();
        }
      } catch (err: any) {
        hasError = true;
        setItems(prev => prev.map((it, idx) => idx === i ? { ...it, status: 'failed', error: err.message } : it));
      }
    }

    setRunning(false);
    setDone(true);
    if (!hasError) {
      setTimeout(onComplete, 800);
    }
  };

  const completedCount = items.filter(i => i.status === 'completed').length;
  const failedCount = items.filter(i => i.status === 'failed').length;

  return (
    <Modal
      title={
        <Space>
          {done
            ? failedCount > 0 ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> : <CheckCircleOutlined style={{ color: '#52c41a' }} />
            : running ? <LoadingOutlined spin /> : <DeleteOutlined />}
          批量删除 ({items.length} 条记录)
        </Space>
      }
      open={open}
      onCancel={!running ? onClose : undefined}
      closable={!running}
      maskClosable={false}
      width={480}
      footer={
        done ? (
          <Button type="primary" onClick={failedCount > 0 ? onClose : onComplete}>完成</Button>
        ) : running ? null : (
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" danger onClick={runBatch} icon={<DeleteOutlined />}>
              确认删除全部
            </Button>
          </Space>
        )
      }
    >
      {!running && !done && (
        <div style={{ marginBottom: 12 }}>
          <Text type="warning">以下 {items.length} 条历史记录将被删除（仅删除历史记录，不级联删除生成文件和数据表）：</Text>
        </div>
      )}
      {running && (
        <Progress
          percent={Math.round((completedCount / items.length) * 100)}
          status={failedCount > 0 ? 'exception' : 'active'}
          style={{ marginBottom: 12 }}
        />
      )}
      <div style={{ background: '#fafafa', borderRadius: 6, padding: '8px 12px', maxHeight: 320, overflowY: 'auto' }}>
        {items.map((item, idx) => (
          <div
            key={item.id}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0',
              borderBottom: idx < items.length - 1 ? '1px solid #f0f0f0' : 'none',
            }}
          >
            <StepIcon status={item.status} />
            <Text style={{ flex: 1 }}>{item.tableName}</Text>
            {item.status === 'failed' && (
              <Text type="danger" style={{ fontSize: 12 }}>{item.error || '失败'}</Text>
            )}
          </div>
        ))}
      </div>
      {done && failedCount > 0 && (
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">{completedCount} 成功，{failedCount} 失败</Text>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// History page
// ---------------------------------------------------------------------------

export default function AutocodeHistoryPage() {
  const actionRef = useRef<ActionType>(undefined);
  const userRole = useUserStore((s) => s.userInfo?.role);
  const isSuperAdmin = userRole === 'super_admin';

  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [batchDeleteItems, setBatchDeleteItems] = useState<BatchDeleteItem[]>([]);

  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<AutoCodeHistory | null>(null);
  const [detailFiles, setDetailFiles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('');

  // Delete progress modal state
  const [deleteProgressOpen, setDeleteProgressOpen] = useState(false);
  const [deleteJobId, setDeleteJobId] = useState<string | null>(null);
  const [deleteTableName, setDeleteTableName] = useState('');

  // On mount: restore active delete job from sessionStorage (survives HMR reload)
  useEffect(() => {
    const saved = loadDeleteJob();
    if (saved) {
      setDeleteJobId(saved.jobId);
      setDeleteTableName(saved.tableName);
      setDeleteProgressOpen(true);
    }
  }, []);

  const handleViewDetail = async (id: string) => {
    try {
      const record = await getAutoCodeHistoryDetail(id);
      setDetailRecord(record);
      setDetailFiles(record.templates || {});
      const filePaths = Object.keys(record.templates || {});
      if (filePaths.length > 0) {
        setActiveTab(filePaths[0]!);
      }
      setDetailOpen(true);
    } catch (err: any) {
      message.error(err.message || 'Failed to load history detail');
    }
  };

  const handleRollback = async (id: string, tableName: string) => {
    try {
      const impact = await analyzeImpact(tableName);
      Modal.confirm({
        title: '确认回滚',
        icon: <ExclamationCircleOutlined />,
        width: 640,
        content: (
          <div>
            <p>将 <strong>{tableName}</strong> 的代码回滚到此历史版本。</p>
            <ImpactReport impact={impact} />
          </div>
        ),
        okText: '确认回滚',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            const result = await rollbackAutoCodeHistory(id);
            message.success(`回滚完成: ${result.restoredFiles.length} 个文件已恢复`);
            actionRef.current?.reload();
          } catch (err: any) {
            message.error(err.message || '回滚失败');
          }
        },
      });
    } catch (err: any) {
      message.error(err.message || '分析失败');
    }
  };

  const handleDelete = async (id: string, tableName: string) => {
    try {
      // Always fetch cascade chain so user can see the full impact
      const impact = await analyzeImpact(tableName, true);
      let cascadeDelete = false;
      Modal.confirm({
        title: '确认删除',
        icon: <DeleteOutlined style={{ color: '#ff4d4f' }} />,
        width: 640,
        content: (
          <div>
            <p>删除 <strong>{tableName}</strong> 的所有生成内容，包括数据库表、后端代码、前端代码和菜单配置。</p>
            <ImpactReport impact={impact} />
            {impact.recordCount > 0 && (
              <Alert
                type="error"
                showIcon
                message={`数据库表 ${impact.dbTableName} 中有 ${impact.recordCount} 条记录将被永久删除！`}
                style={{ marginTop: 12 }}
              />
            )}
            {impact.referencedBy.length > 0 && (
              <>
                <Alert
                  type="error"
                  showIcon
                  message={`${impact.referencedBy.length} 个外键依赖：级联删除将同时清除关联表的数据表、代码文件和菜单。`}
                  style={{ marginTop: 8 }}
                />
                <div style={{ marginTop: 12, padding: '8px 12px', background: '#fff7e6', borderRadius: 4 }}>
                  <Checkbox onChange={(e) => { cascadeDelete = e.target.checked; }}>
                    <Text strong style={{ color: '#d4380d' }}>级联删除所有关联表（含代码和菜单）</Text>
                  </Checkbox>
                  <div style={{ marginTop: 4, paddingLeft: 24 }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      勾选后，以下引用表将被<strong>彻底清除</strong>（DROP TABLE + 删除代码文件 + 删除菜单 + 清除历史记录）：
                    </Text>
                    <div style={{ marginTop: 4 }}>
                      {impact.referencedBy.map((ref, i) => {
                        const chainEntry = impact.cascadeChain?.find(c => c.dbTable === ref.table);
                        const fileCount = chainEntry?.files?.length ?? 0;
                        const menuCount = chainEntry?.menus?.length ?? 0;
                        return (
                          <Tag key={i} color="red" style={{ marginTop: 4 }}>
                            {ref.table}
                            {chainEntry && ` (${chainEntry.recordCount}行`}
                            {chainEntry && fileCount > 0 && `, ${fileCount}文件`}
                            {chainEntry && menuCount > 0 && `, ${menuCount}菜单`}
                            {chainEntry && ')'}
                          </Tag>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        ),
        okText: '确认删除',
        okType: 'danger',
        cancelText: '取消',
        onOk: async () => {
          try {
            const { jobId } = await deleteAutoCodeHistory(id, cascadeDelete);
            saveDeleteJob(jobId, tableName);
            setDeleteTableName(tableName);
            setDeleteJobId(jobId);
            setDeleteProgressOpen(true);
          } catch (err: any) {
            message.error(err.message || '删除失败');
          }
        },
      });
    } catch (err: any) {
      message.error(err.message || '分析失败');
    }
  };

  const handleDeleteComplete = () => {
    clearDeleteJob();
    setDeleteProgressOpen(false);
    message.success('删除完成');
    actionRef.current?.reload();
  };

  const columns: ProColumns<AutoCodeHistory>[] = [
    {
      title: 'Table Name',
      dataIndex: 'tableName',
      width: 160,
      search: false,
    },
    {
      title: 'Version',
      dataIndex: 'version',
      width: 80,
      search: false,
      render: (_, record) => (
        <Tag color="blue">{record.version ? `v${record.version}` : '-'}</Tag>
      ),
    },
    {
      title: 'Operation',
      dataIndex: 'operation',
      width: 100,
      search: false,
      render: (_, record) => {
        const op = record.operation;
        if (!op) return <Tag>create</Tag>;
        const colorMap: Record<string, string> = {
          create: 'green',
          update: 'orange',
          rollback: 'purple',
        };
        const labelMap: Record<string, string> = {
          create: '新建',
          update: '更新',
          rollback: '回滚',
        };
        return <Tag color={colorMap[op] || 'default'}>{labelMap[op] || op}</Tag>;
      },
    },
    {
      title: 'Change Log',
      dataIndex: 'changeLog',
      width: 260,
      search: false,
      ellipsis: true,
      render: (_, record) => (
        <Text type={record.changeLog ? undefined : 'secondary'} style={{ fontSize: 13 }}>
          {record.changeLog || '-'}
        </Text>
      ),
    },
    {
      title: 'Files',
      search: false,
      width: 70,
      render: (_, record) => {
        const count = Object.keys(record.templates || {}).length;
        return <Text>{count}</Text>;
      },
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 170,
      search: false,
    },
    {
      title: 'Action',
      key: 'action',
      width: 220,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            View
          </Button>
          {isSuperAdmin && (
            <Button
              type="link"
              size="small"
              icon={<RollbackOutlined />}
              danger
              onClick={() => handleRollback(record.id, record.tableName)}
            >
              Rollback
            </Button>
          )}
          <Button
            type="link"
            size="small"
            danger
            onClick={() => handleDelete(record.id, record.tableName)}
          >
            Delete
          </Button>
        </Space>
      ),
    },
  ];

  const tabItems = Object.entries(detailFiles).map(([path, content]) => ({
    key: path,
    label: getFileLabel(path),
    children: (
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <pre
          style={{
            background: '#1e1e1e',
            color: '#d4d4d4',
            padding: 16,
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.6,
            overflowX: 'auto',
            whiteSpace: 'pre',
            margin: 0,
          }}
        >
          <code>{content}</code>
        </pre>
      </div>
    ),
  }));

  return (
    <div style={{ padding: '0 0 24px 0' }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        <RollbackOutlined /> Code Generation History
      </Title>

      <ProTable<AutoCodeHistory>
        headerTitle="History Records"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        tableAlertRender={({ selectedRowKeys: keys, onCleanSelected }) => (
          <Space>
            <span>已选 {keys.length} 条</span>
            <Button size="small" onClick={onCleanSelected}>取消选择</Button>
          </Space>
        )}
        tableAlertOptionRender={({ selectedRows, onCleanSelected }) => (
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              setBatchDeleteItems(selectedRows.map(r => ({
                id: r.id,
                tableName: r.tableName,
                status: 'pending' as const,
              })));
              setBatchDeleteOpen(true);
            }}
          >
            批量删除 ({selectedRows.length})
          </Button>
        )}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getAutoCodeHistory({ page, pageSize });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
      />

      <Drawer
        title={
          <Space>
            <Text strong>History Detail</Text>
            {detailRecord && (
              <Text type="secondary">
                ({detailRecord.tableName} - {Object.keys(detailFiles).length} files)
              </Text>
            )}
          </Space>
        }
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailRecord(null);
          setDetailFiles({});
        }}
        width="80%"
      >
        {Object.keys(detailFiles).length > 0 && (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabPosition="left"
            style={{ minHeight: 400 }}
            items={tabItems}
          />
        )}
        {Object.keys(detailFiles).length === 0 && (
          <Text type="secondary">No templates stored in this history record.</Text>
        )}
      </Drawer>

      {/* Delete progress modal */}
      <DeleteProgressModal
        open={deleteProgressOpen}
        jobId={deleteJobId}
        tableName={deleteTableName}
        onClose={() => { clearDeleteJob(); setDeleteProgressOpen(false); }}
        onComplete={handleDeleteComplete}
      />

      {/* Batch delete modal */}
      <BatchDeleteModal
        open={batchDeleteOpen}
        items={batchDeleteItems}
        onClose={() => setBatchDeleteOpen(false)}
        onComplete={() => {
          setBatchDeleteOpen(false);
          setSelectedRowKeys([]);
          message.success('批量删除完成');
          actionRef.current?.reload();
        }}
      />
    </div>
  );
}
