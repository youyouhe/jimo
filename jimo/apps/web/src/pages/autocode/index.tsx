import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from '@umijs/max';
import {
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Switch,
  Space,
  Tabs,
  Tag,
  message,
  Popconfirm,
  Typography,
  Row,
  Col,
  Tooltip,
  Modal,
  Progress,
  Segmented,
} from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EyeOutlined,
  CodeOutlined,
  CheckCircleOutlined,
  LoadingOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  RocketOutlined,
  ExclamationCircleOutlined,
  SaveOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import {
  previewGenerate,
  executeGenerate,
  getGenerateStatus,
  getTables,
  getTemplates,
  getLatestVersion,
  startModuleUpdate,
  getUpdateStatus,
  listAllPackages,
  getPackageConfig,
  saveFromConfig,
  type AutoCodeDto,
  type AutoCodeField,
  type GenerateJobStatus,
  type GenerateStep,
  type PackageListItem,
} from '@/services/autocode';
import { useUserStore } from '@/stores/user';
import { getDictionaries, type Dictionary } from '@/services/dictionary';
import { getEncodingRulesList, createEncodingRule } from '@/services/encoding-rule';
import { ModalForm, ProFormText, ProFormSelect, ProFormDigit } from '@ant-design/pro-components';
import ERGraphTab from './ErGraph';
import { AiGeneratorPanel } from './AiGenerator';

const { Text, Title } = Typography;

// Defensive fallback only. The authoritative field-type list is fetched from
// the server (GET /autocode/templates) into `fieldTypeOptions` on mount, so a
// type added on the backend (e.g. 'calculated') propagates here automatically.
// This constant only guarantees the editor is never empty before the fetch.
const FALLBACK_FIELD_TYPES = [
  { value: 'varchar', label: 'String (varchar)' },
  { value: 'text', label: 'Long Text (text)' },
  { value: 'integer', label: 'Integer (integer)' },
  { value: 'bigint', label: 'Big Integer (bigint)' },
  { value: 'decimal', label: 'Decimal (numeric)' },
  { value: 'boolean', label: 'Boolean (boolean)' },
  { value: 'timestamp', label: 'Timestamp (timestamp)' },
  { value: 'uuid', label: 'UUID (uuid)' },
  { value: 'image', label: 'Image (upload)' },
  { value: 'file', label: 'Attachment (upload)' },
  { value: 'relation', label: 'Relation (foreign key)' },
  { value: 'dict', label: '字典 (Dictionary)' },
  { value: 'code', label: '编码规则 (Auto Code)' },
  { value: 'point', label: 'GIS 坐标 (point)' },
  { value: 'calculated', label: '计算字段 (Calculated)' },
];

const DEFAULT_FIELD: AutoCodeField = {
  name: '',
  type: 'varchar',
  length: 255,
  required: false,
  unique: false,
  description: '',
  searchable: true,
  listable: true,
  creatable: true,
  editable: true,
  fixed: false,
  removed: false,
};

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
// Generate Progress Modal — self-contained, no external callbacks
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

interface GenerateProgressModalProps {
  open: boolean;
  jobId: string | null;
  tableName: string;
  mode?: 'generate' | 'update';
  onClose: () => void;
}

function GenerateProgressModal({
  open,
  jobId,
  tableName,
  mode = 'generate',
  onClose,
}: GenerateProgressModalProps) {
  const [jobStatus, setJobStatus] = useState<GenerateJobStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [navigating, setNavigating] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failCountRef = useRef(0);
  const refreshMenus = useUserStore((s) => s.refreshMenus);

  const MAX_FAIL_COUNT = 15; // ~30 seconds of consecutive failures
  const STUCK_STEP_TIMEOUT = 60000; // 60 seconds on the same running step = likely killed by nest --watch restart
  const stuckSinceRef = useRef<number | null>(null);

  // Cleanup all timers
  const clearTimers = useCallback(() => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    pollTimerRef.current = null;
  }, []);

  // Reset state when modal opens with a new job
  useEffect(() => {
    if (open && jobId) {
      setJobStatus(null);
      setPollError(null);
      setNavigating(false);
      failCountRef.current = 0;
      stuckSinceRef.current = null;
    }
    if (!open) {
      clearTimers();
    }
  }, [open, jobId, clearTimers]);

  // Polling logic
  useEffect(() => {
    if (!open || !jobId) return;
    // Stop polling once we have a terminal state
    if (jobStatus?.status === 'completed' || jobStatus?.status === 'failed') return;

    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const statusFn = mode === 'update' ? getUpdateStatus : getGenerateStatus;
        const status = await statusFn(jobId);
        if (cancelled) return;

        // Job 文件已丢失(后端重启导致) → 直接关闭 modal
        if (!status) {
          clearActiveJob();
          onClose();
          message.info('任务已过期（后端已重启），请重试');
          return;
        }

        setJobStatus(status);
        setPollError(null);
        failCountRef.current = 0;

        // Detect stuck step: same running step for too long → backend likely restarted
        const runningStep = status.steps?.find(s => s.status === 'running');
        if (runningStep) {
          const now = Date.now();
          if (!stuckSinceRef.current) {
            stuckSinceRef.current = now;
          } else if (now - stuckSinceRef.current > STUCK_STEP_TIMEOUT) {
            // Step stuck for too long — mark all remaining steps as completed
            const completedSteps = status.steps.map(s => ({
              ...s,
              status: (s.status === 'pending' || s.status === 'running') ? 'completed' as const : s.status,
            }));
            setJobStatus({
              ...status,
              status: 'completed',
              steps: completedSteps,
              progress: 100,
              currentStepLabel: '更新完成（后端已重启）',
              completedAt: new Date().toISOString(),
            });
            clearActiveJob();
            return;
          }
        } else {
          stuckSinceRef.current = null;
        }

        if (status.status === 'completed' || status.status === 'failed') {
          // Terminal state — stop polling
          return;
        }
        // Continue polling
        pollTimerRef.current = setTimeout(poll, 800);
      } catch (err: any) {
        if (cancelled) return;
        failCountRef.current += 1;

        // After the entrypoint step mutates app.module / .umirc, `nest --watch` restarts
        // the backend, so polls fail for several seconds. The generate-worker is a separate
        // tsx process unaffected by the restart, so it has already written the final `done`
        // status (with result.createdFiles) to the DB — we just need to keep retrying until
        // the HTTP server responds again. Completing optimistically on the FIRST failure
        // used a stale jobStatus with no result, which is why the UI showed "共 0 个文件".
        if (failCountRef.current >= MAX_FAIL_COUNT) {
          // Backend didn't recover within ~30s. If most steps had completed, generation
          // almost certainly succeeded — mark completed (file count may be unknown).
          // Otherwise the job is genuinely lost.
          if (jobStatus && jobStatus.progress >= 80) {
            setJobStatus({
              ...jobStatus,
              status: 'completed',
              progress: 100,
              currentStepLabel: '代码生成完成',
              result: jobStatus.result || { createdFiles: [] },
              completedAt: new Date().toISOString(),
            });
          } else {
            setJobStatus({
              jobId: jobId,
              status: 'failed',
              steps: [],
              progress: 0,
              currentStepLabel: '任务已过期或丢失',
              error: '无法获取任务状态（可能已过期）。请关闭后重试。',
            });
            clearActiveJob();
          }
          return;
        }

        // Keep polling through the restart window; once the backend is back, the poll
        // returns the real terminal status with createdFiles populated.
        setPollError(jobStatus && jobStatus.progress >= 80
          ? '后端正在重启以加载新模块，正在等待恢复...'
          : '连接中断，正在重试...');
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };

    // Start polling after a short delay
    pollTimerRef.current = setTimeout(poll, 500);

    return () => {
      cancelled = true;
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [open, jobId, jobStatus?.status, jobStatus?.progress]);

  const isComplete = jobStatus?.status === 'completed';
  const isFailed = jobStatus?.status === 'failed';
  const isTerminal = isComplete || isFailed;

  // Navigate to the new module
  const handleNavigate = async () => {
    setNavigating(true);
    // Refresh menu tree (persists to localStorage so patchClientRoutes picks it up on reload)
    try {
      await refreshMenus();
    } catch {
      // Non-critical
    }
    const saved = loadActiveJob();
    clearActiveJob();
    const kebabName = tableName.toLowerCase().replace(/_/g, '-');
    const modulePath = saved?.modulePath || `/lc/${kebabName}`;
    // Full reload — patchClientRoutes now reads persisted menuTree from localStorage
    window.location.href = modulePath;
  };

  return (
    <Modal
      title={
        <Space>
          {isComplete ? <CheckCircleOutlined style={{ color: '#52c41a' }} /> :
           isFailed ? <CloseCircleOutlined style={{ color: '#ff4d4f' }} /> :
           <LoadingOutlined spin />}
          {mode === 'update' ? '模块更新进度' : '代码生成进度'}
        </Space>
      }
      open={open}
      onCancel={isTerminal ? onClose : undefined}
      closable={isTerminal}
      maskClosable={false}
      width={520}
      footer={
        isComplete ? (
          <Space>
            <Button onClick={async () => {
              clearActiveJob();
              try { await useUserStore.getState().refreshMenus(); } catch { /* ok */ }
              window.location.reload();
            }}>关闭</Button>
            {mode === 'generate' && (
              <Button type="primary" loading={navigating} onClick={handleNavigate}>
                前往新模块
              </Button>
            )}
          </Space>
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

      {/* Current status label */}
      <div style={{ marginBottom: 16, textAlign: 'center' }}>
        {!jobStatus && !pollError && (
          <Text type="secondary"><LoadingOutlined spin /> 正在启动生成任务...</Text>
        )}
        {pollError && !isTerminal && (
          <Text type="warning"><LoadingOutlined spin /> {pollError}</Text>
        )}
        {jobStatus && !isTerminal && (
          <Text type="secondary"><LoadingOutlined spin /> {jobStatus.currentStepLabel}</Text>
        )}
        {isComplete && (
          <Text type="success">
            {mode === 'update'
              ? `更新完成！共 ${jobStatus?.result?.createdFiles?.length ?? 0} 个文件已覆盖。`
              : `生成完成！共 ${jobStatus?.result?.createdFiles?.length ?? 0} 个文件。`
            }
            后端正在重启以加载变更。
          </Text>
        )}
        {isFailed && (
          <Text type="danger">{jobStatus?.error || '生成失败'}</Text>
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
              <Text
                style={{
                  flex: 1,
                  color: step.status === 'pending' ? '#bbb' : undefined,
                }}
              >
                {step.label}
              </Text>
              {step.status === 'completed' && (
                <Text type="success" style={{ fontSize: 12 }}>✓</Text>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error details */}
      {isFailed && jobStatus?.error && (
        <div style={{ marginTop: 12, padding: 12, background: '#fff2f0', borderRadius: 6 }}>
          <Text type="danger" style={{ fontSize: 13 }}>{jobStatus.error}</Text>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Session storage keys for surviving HMR / page reload
// ---------------------------------------------------------------------------

const JOB_STORAGE_KEY = 'autocode-active-job';

function saveActiveJob(jobId: string, tableName: string, mode: 'generate' | 'update' = 'generate', modulePath?: string) {
  try {
    sessionStorage.setItem(JOB_STORAGE_KEY, JSON.stringify({ jobId, tableName, mode, modulePath }));
  } catch { /* ignore */ }
}

function loadActiveJob(): { jobId: string; tableName: string; mode: 'generate' | 'update'; modulePath?: string } | null {
  try {
    const raw = sessionStorage.getItem(JOB_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearActiveJob() {
  try { sessionStorage.removeItem(JOB_STORAGE_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// PostgreSQL reserved words that cannot be used as column names without quoting.
// Drizzle ORM does not auto-quote identifiers, so we block them upfront.
// ---------------------------------------------------------------------------
// Strictly PostgreSQL reserved words — these CANNOT be used as column names
// without double-quoting. Drizzle ORM does not auto-quote identifiers, so any
// of these as a field name will generate broken SQL.
// Source: https://www.postgresql.org/docs/current/sql-keywords-appendix.html (reserved = yes)
const PG_RESERVED_WORDS = new Set([
  'all','analyse','analyze','and','any','array','as','asc','asymmetric',
  'both','case','cast','check','collate','collation','column','concurrently',
  'constraint','create','cross','current_catalog','current_date','current_role',
  'current_schema','current_time','current_timestamp','current_user',
  'default','deferrable','desc','distinct','do','else','end','except',
  'false','fetch','for','foreign','freeze','from','full','grant',
  'group','having','ilike','in','initially','inner','intersect','into','is',
  'isnull','join','lateral','leading','left','like','limit','localtime',
  'localtimestamp','natural','not','notnull','null','offset','on',
  'only','or','order','outer','overlaps','placing','primary','references',
  'returning','right','row','select','session_user','similar','some',
  'symmetric','table','tablesample','then','to','trailing','true','union',
  'unique','user','using','variadic','verbose','when','where','window','with',
]);

function checkReservedWords(fields: any[]): string[] {
  const violations: string[] = [];
  const check = (name: string, context: string) => {
    if (name && PG_RESERVED_WORDS.has(name.toLowerCase().trim())) {
      violations.push(`${context}: "${name}" 是 PostgreSQL 保留字`);
    }
  };
  (fields || []).forEach((f, i) => {
    const label = `字段 ${i + 1}${f.description ? `（${f.description}）` : ''}`;
    check(f.name, label);
    (f.detailFields || []).forEach((df: any, j: number) => {
      const dlabel = `明细字段 ${j + 1}${df.description ? `（${df.description}）` : ''}`;
      check(df.name, dlabel);
    });
  });
  return violations;
}

// Check if any field name collides with the table name (schemaVar = camelCase of tableName).
// e.g. tableName='course' → schemaVar='course'; field name='course' → collision.
function checkFieldTableNameCollision(tableName: string, fields: any[]): string[] {
  if (!tableName) return [];
  // schemaVar is camelCase of tableName (same logic as deriveNames on the server)
  const schemaVar = tableName.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  const violations: string[] = [];
  (fields || []).forEach((f, i) => {
    if (f.name && f.name === schemaVar) {
      const label = `字段 ${i + 1}${f.description ? `（${f.description}）` : ''}`;
      violations.push(`${label}: 字段名 "${f.name}" 与业务表变量名相同，会导致 Service 代码命名冲突`);
    }
  });
  return violations;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AutocodePage() {
  const [form] = Form.useForm();
  const userRoles = useUserStore((s) => s.userInfo?.roles) ?? [];
  const isSuperAdmin = userRoles.includes('super_admin');

  // Form state
  const [generateWeb, setGenerateWeb] = useState(true);
  // Mock-data generation (opt-in, default off; count default 10)
  const [mockEnabled, setMockEnabled] = useState(false);
  const [mockCount, setMockCount] = useState(10);
  // Approval flow (opt-in; default chain deptHead)
  const [approvalEnabled, setApprovalEnabled] = useState(false);
  const [approvalChain, setApprovalChain] = useState('deptHead');
  // Visibility strategy (default private)
  const [visibilityStrategy, setVisibilityStrategy] = useState<'private' | 'department' | 'shared' | 'public'>('private');
  // Agent config (opt-in). Enable to create a companion agent for the entity.
  const [agentEnabled, setAgentEnabled] = useState(false);
  // Page type: list=standard table+modal (default), document=list+detail page, grid=Excel-like inline-editable table
  const [pageType, setPageType] = useState<'list' | 'document' | 'grid'>('list');

  // Update mode state
  const [updateMode, setUpdateMode] = useState(false);
  const [selectedTableName, setSelectedTableName] = useState<string | null>(null);
  const [loadingFields, setLoadingFields] = useState(false);
  const [currentVersion, setCurrentVersion] = useState<number | null>(null);

  // Preview state
  const [previewFiles, setPreviewFiles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('');
  const [viewMode, setViewMode] = useState<'generator' | 'ergraph'>('generator');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [tableOptions, setTableOptions] = useState<{ value: string; label: string }[]>([]);
  // Cache: targetTableName → field options for Display Field Select
  const relationTableColumnsCache = useRef<Map<string, { value: string; label: string }[]>>(new Map());

  // Progress modal state — restored from sessionStorage on HMR reload
  const [progressOpen, setProgressOpen] = useState(false);
  const [progressJobId, setProgressJobId] = useState<string | null>(null);
  const [progressTableName, setProgressTableName] = useState('');
  const [progressMode, setProgressMode] = useState<'generate' | 'update'>('generate');

  // Package state
  const [packageOptions, setPackageOptions] = useState<PackageListItem[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [dictOptions, setDictOptions] = useState<{ value: string; label: string }[]>([]);
  const [encodingRuleOptions, setEncodingRuleOptions] = useState<{ label: string; value: string }[]>([]);
  // Authoritative field-type options, fetched from server templates; initialized
  // from the fallback so the field editor is never empty before the fetch lands.
  const [fieldTypeOptions, setFieldTypeOptions] = useState(FALLBACK_FIELD_TYPES);
  const [quickCreateRuleModalOpen, setQuickCreateRuleModalOpen] = useState(false);
  const [searchParams] = useSearchParams();

  // On mount: restore active job from sessionStorage (survives HMR reload)
  useEffect(() => {
    const saved = loadActiveJob();
    if (saved) {
      setProgressJobId(saved.jobId);
      setProgressTableName(saved.tableName);
      setProgressMode(saved.mode || 'generate');
      setProgressOpen(true);
    }
  }, []);

  // Fetch table list on mount
  useEffect(() => {
    getTables()
      .then((tables) => {
        setTableOptions(tables.map((t) => ({ value: t, label: t })));
      })
      .catch((err) => {
        console.error('[autocode] 获取表列表失败，请确认后端服务是否正常', err);
        message.warning('获取表列表失败，请刷新页面重试');
      });
  }, []);

  // Fetch authoritative field-type templates on mount (single source of truth).
  useEffect(() => {
    getTemplates()
      .then((tpl) => {
        if (tpl.fieldTypes?.length) {
          setFieldTypeOptions(tpl.fieldTypes.map((ft) => ({ value: ft.value, label: ft.label })));
        }
      })
      .catch(() => { /* non-critical — keep fallback */ });
  }, []);

  // Fetch package list on mount
  useEffect(() => {
    listAllPackages()
      .then((pkgs) => setPackageOptions(pkgs))
      .catch(() => { /* non-critical */ });
  }, []);

  // Fetch dictionary list on mount for dict-type field picker
  useEffect(() => {
    getDictionaries({ page: 1, pageSize: 100 })
      .then((res) => {
        setDictOptions(res.list.map((d: Dictionary) => ({ value: d.type, label: `${d.name} (${d.type})` })));
      })
      .catch(() => { /* non-critical */ });
    loadEncodingRules();
  }, []);

  const loadEncodingRules = async () => {
    try {
      const res = await getEncodingRulesList({ pageSize: 100 });
      setEncodingRuleOptions((res.list || []).map((r: any) => ({ label: r.name, value: r.id })));
    } catch { /* non-critical */ }
  };

  // Handle ?packageId=xxx URL param (from packages page "Apply" button)
  useEffect(() => {
    const pid = searchParams.get('packageId');
    if (pid) {
      getPackageConfig(pid)
        .then((config) => {
          form.setFieldsValue({
            tableName: config.tableName || '',
            description: config.description || config.name || '',
            fields: config.fields?.length > 0 ? config.fields : [{ ...DEFAULT_FIELD }],
          });
          setSelectedPackageId(pid);
          message.success(`已加载模板包: ${config.name}`);
        })
        .catch(() => message.error('加载模板包配置失败'));
    }
  }, [searchParams]);

  const handlePreview = async () => {
    try {
      const values = await form.validateFields();

      const violations = [
        ...checkReservedWords(values.fields || []),
        ...checkFieldTableNameCollision(values.tableName, values.fields || []),
      ];
      if (violations.length > 0) {
        Modal.error({
          title: '字段名存在命名冲突',
          content: (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {violations.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          ),
          okText: '去修改',
        });
        return;
      }

      setPreviewLoading(true);

      const dto: AutoCodeDto = {
        tableName: values.tableName.trim(),
        description: values.description.trim(),
        fields: values.fields || [],
        generateWeb,
      };

      const files = await previewGenerate(dto);
      setPreviewFiles(files);

      const filePaths = Object.keys(files);
      if (filePaths.length > 0) {
        setActiveTab(filePaths[0]!);
      }
      message.success(`Preview generated ${filePaths.length} files`);
    } catch (err: any) {
      if (err?.errorFields) {
        message.error('Please fix the form errors before previewing');
        return;
      }
      message.error(err.message || 'Preview failed');
    } finally {
      setPreviewLoading(false);
    }
  };

  const startGenerateJob = async (dto: AutoCodeDto) => {
    // Unified mock-data injection — applies to all three callers:
    // manual handleGenerate, AI handleAiGenerate, and AI batch handleAiGenerateBatch.
    const finalDto: AutoCodeDto = {
      ...dto,
      ...(mockEnabled ? { mockData: { enabled: true, count: mockCount } } : {}),
      ...(approvalEnabled
        ? { approvalFlow: { enabled: true, defaultChain: approvalChain.split(',').map((s) => s.trim()).filter(Boolean) } }
        : {}),
      visibilityStrategy,
      ...(agentEnabled ? { agentConfig: { enabled: true } } : {}),
      pageType,
    };
    const { jobId } = await executeGenerate(finalDto);
    const kebab = dto.tableName.toLowerCase().replace(/_/g, '-');
    const modulePath = `/lc/${kebab}`;
    saveActiveJob(jobId, dto.tableName, 'generate', modulePath);
    setProgressTableName(dto.tableName);
    setProgressJobId(jobId);
    setProgressMode('generate');
    setProgressOpen(true);
  };

  const startUpdateJob = async (dto: AutoCodeDto & { force?: boolean }) => {
    const { jobId } = await startModuleUpdate({
      tableName: dto.tableName,
      description: dto.description,
      fields: dto.fields,
      generateWeb: dto.generateWeb,
      force: dto.force,
      pageType,
      ...(approvalEnabled ? { approvalFlow: { enabled: true, defaultChain: approvalChain.split(',').map((s) => s.trim()).filter(Boolean) } } : {}),
      ...(agentEnabled ? { agentConfig: { enabled: true } } : {}),
      visibilityStrategy,
    });
    // No navigation path for update — user stays on same module
    saveActiveJob(jobId, dto.tableName, 'update');
    setProgressTableName(dto.tableName);
    setProgressJobId(jobId);
    setProgressMode('update');
    setProgressOpen(true);
  };

  // Load existing table's fields into the form for update mode
  const handleLoadExistingTable = async (tableName: string) => {
    if (!tableName) {
      setUpdateMode(false);
      setSelectedTableName(null);
      setCurrentVersion(null);
      return;
    }
    setLoadingFields(true);
    try {
      const latest = await getLatestVersion(tableName);
      const fields = (latest.fields as AutoCodeField[]) || [];
      setCurrentVersion(latest.version ?? null);
      setUpdateMode(true);
      setSelectedTableName(tableName);
      form.setFieldsValue({
        tableName,
        description: (latest as any).menuName || tableName,
        fields: fields.length > 0 ? fields : [{ ...DEFAULT_FIELD }],
      });
    } catch {
      message.error('加载表字段失败，可能没有版本记录');
      setUpdateMode(false);
      setSelectedTableName(null);
    } finally {
      setLoadingFields(false);
    }
  };

  // Reset update mode
  const handleExitUpdateMode = () => {
    setUpdateMode(false);
    setSelectedTableName(null);
    setCurrentVersion(null);
    form.setFieldsValue({
      tableName: '',
      description: '',
      fields: [{ ...DEFAULT_FIELD }],
    });
  };

  const handleGenerate = async () => {
    try {
      const values = await form.validateFields();

      const violations = [
        ...checkReservedWords(values.fields || []),
        ...checkFieldTableNameCollision(values.tableName, values.fields || []),
      ];
      if (violations.length > 0) {
        Modal.error({
          title: '字段名存在命名冲突',
          content: (
            <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
              {violations.map((v, i) => <li key={i}>{v}</li>)}
            </ul>
          ),
          okText: '去修改',
        });
        return;
      }

      setGenerateLoading(true);

      const dto: AutoCodeDto = {
        tableName: values.tableName.trim(),
        description: values.description.trim(),
        fields: values.fields || [],
        generateWeb,
        ...(selectedPackageId ? { packageId: selectedPackageId } : {}),
        // mockData is injected centrally in startGenerateJob (also covers the AI path).
      };

      // Try normal generate first
      try {
        await startGenerateJob(dto);
      } catch (err: any) {
        // If files already exist, ask user to confirm overwrite
        const errMsg = err?.message || '';
        if (errMsg.includes('File already exists') || errMsg.includes('already exists')) {
          setGenerateLoading(false);
          Modal.confirm({
            title: '文件已存在',
            icon: <ExclamationCircleOutlined />,
            width: 520,
            content: (
              <div>
                <p>模块 <strong>{dto.tableName}</strong> 的文件已存在。</p>
                <p>确认后将<strong>删除旧文件</strong>并重新生成，包括数据库表、菜单等所有内容。</p>
              </div>
            ),
            okText: '确认覆盖',
            okType: 'danger',
            cancelText: '取消',
            onOk: async () => {
              setGenerateLoading(true);
              try {
                await startGenerateJob({ ...dto, force: true });
              } catch (err2: any) {
                message.error(err2.message || 'Generation failed');
              } finally {
                setGenerateLoading(false);
              }
            },
          });
          return;
        }
        throw err; // re-throw other errors
      }
    } catch (err: any) {
      if (err?.errorFields) {
        message.error('Please fix the form errors first');
        return;
      }
      message.error(err.message || 'Generation failed');
    } finally {
      setGenerateLoading(false);
    }
  };

  // AI 对话框「确认创建」→ 复用现有 startGenerateJob 进度 modal 流程
  const handleAiGenerate = async (dto: AutoCodeDto) => {
    try {
      setGenerateLoading(true);
      try {
        await startGenerateJob(dto);
      } catch (err: any) {
        const errMsg = err?.message || '';
        if (errMsg.includes('already exists')) {
          message.warning(
            `表 ${dto.tableName} 已存在。可换个表名重试,或在「填入表单修改」后勾选覆盖生成。`,
          );
        } else {
          throw err;
        }
      }
    } catch (err: any) {
      message.error(err?.message || 'AI 生成失败');
    } finally {
      setGenerateLoading(false);
    }
  };

  // AI 对话框「全部确认创建」(批量)→ 按顺序依次生成(避免并发 drizzle push / 文件写入冲突)。
  // 已存在的表跳过并继续,真正的错误则中断批量。
  const handleAiGenerateBatch = async (dtos: AutoCodeDto[]) => {
    setGenerateLoading(true);
    let ok = 0;
    let skipped = 0;
    try {
      for (const dto of dtos) {
        try {
          await startGenerateJob(dto);
          ok += 1;
        } catch (err: any) {
          const errMsg = err?.message || '';
          if (errMsg.includes('already exists')) {
            skipped += 1;
          } else {
            throw err;
          }
        }
      }
      if (ok > 0 && skipped > 0) {
        message.success(`批量完成:已创建 ${ok} 个,跳过 ${skipped} 个已存在的表`);
      } else if (skipped > 0) {
        message.warning(`批量完成:跳过 ${skipped} 个已存在的表`);
      } else if (ok > 0) {
        message.success(`批量完成:已创建 ${ok} 个表`);
      }
    } catch (err: any) {
      message.error(`批量生成中断: ${err?.message || 'AI 生成失败'}(已成功 ${ok} 个)`);
    } finally {
      setGenerateLoading(false);
    }
  };

  // AI 对话框「填入表单修改」→ 把方案写入代码生成器表单,供用户调整
  const handleAiFillForm = (dto: AutoCodeDto) => {
    form.setFieldsValue({
      tableName: dto.tableName,
      description: dto.description,
      fields: dto.fields && dto.fields.length > 0 ? dto.fields : [{ ...DEFAULT_FIELD }],
      generateWeb: dto.generateWeb,
    });
    setGenerateWeb(dto.generateWeb);
  };

  const tabItems = Object.entries(previewFiles).map(([path, content]) => ({
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
        <CodeOutlined /> Code Generator
      </Title>

      <Segmented
        value={viewMode}
        onChange={(v) => setViewMode(v as 'generator' | 'ergraph')}
        options={[
          { label: '代码生成器', value: 'generator' },
          { label: 'ER 图', value: 'ergraph' },
        ]}
        style={{ marginBottom: 16 }}
      />

      {viewMode === 'ergraph' ? (
        <ERGraphTab />
      ) : (
        <>
      <Card size="small" style={{ marginBottom: 16 }} styles={{ body: { padding: 12 } }}>
        <AiGeneratorPanel
          onGenerate={handleAiGenerate}
          onGenerateBatch={handleAiGenerateBatch}
          onFillForm={handleAiFillForm}
          context={{ approvalEnabled, approvalChain, pageType, visibilityStrategy }}
        />
      </Card>
      {/* Single Form wrapping the entire page */}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          tableName: '',
          description: '',
          generateWeb: true,
          fields: [{ ...DEFAULT_FIELD }],
        }}
      >
        <Card
          title={
            <Space>
              <span>Table Definition</span>
              {updateMode && (
                <Text type="warning" style={{ fontSize: 13, fontWeight: 'normal' }}>
                  ✏️ Update Mode (v{currentVersion ?? '?'})
                </Text>
              )}
            </Space>
          }
          style={{ marginBottom: 24 }}
          extra={
            <Space>
              <Text type="secondary" style={{ fontSize: 13 }}>Load existing table:</Text>
              <Select
                style={{ width: 200 }}
                placeholder="Select existing table..."
                showSearch
                allowClear
                value={selectedTableName}
                onChange={handleLoadExistingTable}
                options={tableOptions}
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
                loading={loadingFields}
              />
              <Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>Or package:</Text>
              <Select
                style={{ width: 200 }}
                placeholder="Load from package..."
                showSearch
                allowClear
                value={selectedPackageId}
                onChange={async (pkgId: string | null) => {
                  if (!pkgId) {
                    setSelectedPackageId(null);
                    return;
                  }
                  try {
                    const config = await getPackageConfig(pkgId);
                    form.setFieldsValue({
                      tableName: config.tableName || '',
                      description: config.description || config.name || '',
                      fields: config.fields?.length > 0 ? config.fields : [{ ...DEFAULT_FIELD }],
                    });
                    setSelectedPackageId(pkgId);
                    message.success(`已加载: ${config.name}`);
                  } catch {
                    message.error('加载模板包失败');
                  }
                }}
                options={packageOptions.map((p) => ({ value: p.id, label: `${p.name}${p.tableName ? ` (${p.tableName})` : ''}` }))}
                filterOption={(input, option) =>
                  (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                }
              />
              {selectedPackageId && (
                <Tag color="blue" closable onClose={() => setSelectedPackageId(null)}>
                  <AppstoreOutlined /> {packageOptions.find((p) => p.id === selectedPackageId)?.name}
                </Tag>
              )}
              {updateMode && (
                <Button size="small" onClick={handleExitUpdateMode}>
                  Exit Update Mode
                </Button>
              )}
            </Space>
          }
        >
          <Row gutter={16}>
            <Col span={6}>
              <Form.Item
                name="tableName"
                label="Table Name"
                rules={[
                  { required: true, message: 'Please enter a table name' },
                  {
                    pattern: /^[a-z][a-z0-9_]*$/,
                    message: 'Must be snake_case (lowercase letters, digits, underscores)',
                  },
                ]}
              >
                <Input placeholder="e.g. user_profiles" disabled={updateMode} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item
                name="description"
                label="Description"
                rules={[{ required: true, message: 'Please enter a description' }]}
              >
                <Input placeholder="e.g. User Profile Management" disabled={updateMode} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="Generate Frontend">
                <Switch
                  checked={generateWeb}
                  onChange={setGenerateWeb}
                  checkedChildren="Web"
                  unCheckedChildren="Server Only"
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="生成 mock 数据">
                <Space>
                  <Switch
                    checked={mockEnabled}
                    onChange={setMockEnabled}
                    checkedChildren="开"
                    unCheckedChildren="关"
                  />
                  <Tooltip title="数据数量">
                    <InputNumber
                      min={1}
                      max={1000}
                      value={mockCount}
                      onChange={(v) => setMockCount(Number(v) || 10)}
                      disabled={!mockEnabled}
                      style={{ width: 96 }}
                    />
                  </Tooltip>
                </Space>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="启用审批流">
                <Space>
                  <Switch
                    checked={approvalEnabled}
                    onChange={setApprovalEnabled}
                    checkedChildren="开"
                    unCheckedChildren="关"
                  />
                  <Tooltip title="审批链（BPM 规则名，逗号分隔）。deptHead=部门负责人, ceo=总裁, deptFinance=财务负责人">
                    <Input
                      value={approvalChain}
                      onChange={(e) => setApprovalChain(e.target.value)}
                      disabled={!approvalEnabled}
                      style={{ width: 160 }}
                      placeholder="deptHead"
                    />
                  </Tooltip>
                </Space>
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="数据可见性">
                <Select
                  value={visibilityStrategy}
                  onChange={(v) => setVisibilityStrategy(v)}
                  options={[
                    { label: '私有（仅 owner）', value: 'private' },
                    { label: '同部门（含子部门）', value: 'department' },
                    { label: '共享（显式 shared_with）', value: 'shared' },
                    { label: '公开（所有登录用户）', value: 'public' },
                  ]}
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="启用实体Agent" tooltip="为该业务实体创建伴随agent，暴露CRUD tools">
                <Switch
                  checked={agentEnabled}
                  onChange={setAgentEnabled}
                  checkedChildren="开"
                  unCheckedChildren="关"
                />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="页面类型" tooltip="list=标准列表+弹窗编辑；document=单据页（列表+独立详情页，适合凭证/单据类业务）；grid=Excel式表格，单元格直接编辑、自动保存">
                <Segmented
                  value={pageType}
                  onChange={(v) => setPageType(v as 'list' | 'document' | 'grid')}
                  options={[
                    { label: '标准列表', value: 'list' },
                    { label: '单据页', value: 'document' },
                    { label: '表格(Excel)', value: 'grid' },
                  ]}
                />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card
          title="Fields"
          style={{ marginBottom: 24 }}
        >
          <Form.List name="fields">
            {(listFields, { add, remove }) => (
              <>
                {listFields.map(({ key, name, ...rest }) => (
                  <Form.Item noStyle key={key} shouldUpdate={(prev, cur) => prev.fields?.[name]?.removed !== cur.fields?.[name]?.removed}>
                    {({ getFieldValue }) => {
                      const isRemoved = getFieldValue(['fields', name, 'removed']);
                      return (
                  <Card
                    key={key}
                    size="small"
                    style={{
                      marginBottom: 16,
                      opacity: isRemoved ? 0.5 : 1,
                      borderLeft: isRemoved ? '3px solid #ff4d4f' : undefined,
                    }}
                    title={
                      <Space>
                        <Text strong>Field #{name + 1}</Text>
                        {isRemoved && <Tag color="red">已停用</Tag>}
                      </Space>
                    }
                    extra={
                      <Space>
                        <Button
                          type="link"
                          icon={<PlusOutlined />}
                          size="small"
                          onClick={() => add({ ...DEFAULT_FIELD })}
                        >
                          Add
                        </Button>
                        {listFields.length > 1 && (
                          <Popconfirm
                            title="Remove this field?"
                            onConfirm={() => remove(name)}
                            okText="Yes"
                            cancelText="No"
                          >
                            <Button type="link" danger icon={<DeleteOutlined />} size="small">
                              Remove
                            </Button>
                          </Popconfirm>
                        )}
                      </Space>
                    }
                  >
                    <Row gutter={12} style={{ marginBottom: 12 }}>
                      <Col span={6}>
                        <Form.Item
                          {...rest}
                          name={[name, 'name']}
                          label="Name"
                          rules={[
                            { required: true, message: 'Field name required' },
                            {
                              pattern: /^[a-z][a-z0-9_]*$/,
                              message: 'snake_case only',
                            },
                          ]}
                        >
                          <Input placeholder="e.g. user_name" />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item
                          {...rest}
                          name={[name, 'type']}
                          label="Type"
                          rules={[{ required: true }]}
                        >
                          <Select options={fieldTypeOptions} />
                        </Form.Item>
                      </Col>
                      <Col span={4}>
                        <Form.Item
                          {...rest}
                          name={[name, 'description']}
                          label="Description"
                          rules={[{ required: true, message: 'Required' }]}
                        >
                          <Input placeholder="e.g. Display name" />
                        </Form.Item>
                      </Col>
                      <Col span={10}>
                        <Form.Item label="Options">
                          <Space wrap size={[8, 8]}>
                            <Form.Item {...rest} name={[name, 'required']} valuePropName="checked" noStyle>
                              <Switch checkedChildren="Required" unCheckedChildren="Optional" size="small" />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'unique']} valuePropName="checked" noStyle>
                              <Switch checkedChildren="Unique" unCheckedChildren="Not Unique" size="small" />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'searchable']} valuePropName="checked" noStyle>
                              <Switch checkedChildren="Search" unCheckedChildren="No Search" size="small" />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'listable']} valuePropName="checked" noStyle>
                              <Switch checkedChildren="List" unCheckedChildren="No List" size="small" />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'creatable']} valuePropName="checked" noStyle>
                              <Switch checkedChildren="Create" unCheckedChildren="No Create" size="small" />
                            </Form.Item>
                            <Form.Item {...rest} name={[name, 'editable']} valuePropName="checked" noStyle>
                              <Switch checkedChildren="Edit" unCheckedChildren="No Edit" size="small" />
                            </Form.Item>
                            {pageType === 'grid' && (
                              <Form.Item {...rest} name={[name, 'fixed']} valuePropName="checked" noStyle>
                                <Switch checkedChildren="冻结" unCheckedChildren="不冻结" size="small" />
                              </Form.Item>
                            )}
                            {updateMode && (
                              <Form.Item noStyle shouldUpdate={(prev, cur) => prev.fields?.[name]?.removed !== cur.fields?.[name]?.removed}>
                                {({ getFieldValue }) => {
                                  const isRemoved = getFieldValue(['fields', name, 'removed']);
                                  return (
                                    <Form.Item {...rest} name={[name, 'removed']} valuePropName="checked" noStyle>
                                      <Switch
                                        checkedChildren="已停用"
                                        unCheckedChildren="停用"
                                        size="small"
                                        style={isRemoved ? { background: '#ff4d4f' } : undefined}
                                      />
                                    </Form.Item>
                                  );
                                }}
                              </Form.Item>
                            )}
                          </Space>
                        </Form.Item>
                      </Col>
                    </Row>
                    {/* Relation config — only visible when type === 'relation' */}
                    <Form.Item noStyle shouldUpdate={(prev, cur) => {
                      const prevType = prev.fields?.[name]?.type;
                      const curType = cur.fields?.[name]?.type;
                      return prevType !== curType;
                    }}>
                      {({ getFieldValue }) => {
                        const fieldType = getFieldValue(['fields', name, 'type']);
                        if (fieldType !== 'relation') return null;
                        return (
                          <>
                          <Row gutter={12} style={{ marginBottom: 0, padding: '0 0 8px 0', background: '#fafafa', borderRadius: 4, margin: '0 0 8px 0' }}>
                            <Col span={1} />
                            <Col span={7}>
                              <Form.Item
                                {...rest}
                                name={[name, 'relationType']}
                                label="Relation Type"
                                rules={[{ required: true, message: 'Required' }]}
                              >
                                <Select options={[
                                  { value: 'many-to-one', label: '多对一 (N:1)' },
                                  { value: 'many-to-many', label: '多对多 (N:N)' },
                                  { value: 'one-to-many', label: '一对多 (1:N) 主子表' },
                                ]} />
                              </Form.Item>
                            </Col>
                            <Col span={7}>
                              <Form.Item
                                noStyle
                                shouldUpdate={(prev, cur) =>
                                  prev?.fields?.[name as number]?.relationType !== cur?.fields?.[name as number]?.relationType
                                  || prev?.fields?.[name as number]?.detailMode !== cur?.fields?.[name as number]?.detailMode
                                }
                              >
                                {({ getFieldValue }) => {
                                  const rType = getFieldValue(['fields', name, 'relationType']);
                                  const detailMode = getFieldValue(['fields', name, 'detailMode']);
                                  // Hide Target Table for one-to-many + 新建子表
                                  if (rType === 'one-to-many' && detailMode !== 'existing') return null;
                                  return (
                                    <Form.Item
                                      {...rest}
                                      name={[name, 'relationTable']}
                                      label="Target Table"
                                      rules={[{ required: true, message: 'Required' }]}
                                    >
                                      <Select
                                        showSearch
                                        placeholder="搜索或选择表..."
                                        options={tableOptions.filter(o => o.value !== form.getFieldValue('tableName'))}
                                        filterOption={(input, option) =>
                                          (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                        }
                                        notFoundContent="暂无表，请先创建"
                                        onChange={async (tableName: string) => {
                                          form.setFieldValue(['fields', name, 'relationDisplayField'], undefined);
                                          if (!tableName) return;
                                          try {
                                            const latest = await getLatestVersion(tableName);
                                            const fields = (latest.fields as AutoCodeField[]) || [];
                                            const systemFields = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy'];
                                            // Include ALL user-defined fields (including relation fields)
                                            // so that FK columns like "course" appear in O2M detailForms
                                            const allUserFields = fields.filter(f => !systemFields.includes(f.name));
                                            // Cache field options for Display Field Select (non-relation columns only)
                                            const colOpts = allUserFields
                                              .filter(f => f.type !== 'relation')
                                              .map(f => ({ value: f.name, label: `${f.name}${f.description ? ` (${f.description})` : ''}` }));
                                            relationTableColumnsCache.current.set(tableName, colOpts);
                                            // Write into form so shouldUpdate fires and Display Field re-renders
                                            form.setFieldValue(['fields', name, 'relationTableFieldOpts'], colOpts);
                                            // For one-to-many + existing mode: auto-populate detailFields
                                            if (rType === 'one-to-many' && detailMode === 'existing') {
                                              // Mark this field as referencing an existing table
                                              form.setFieldValue(['fields', name, 'relationExistingTable'], true);

                                              // Include ALL user fields (including relation/FK fields) so that
                                              // FK columns like "course" can be shown/edited in the O2M child form
                                              form.setFieldValue(['fields', name, 'detailFields'], allUserFields.map(f => ({
                                                name: f.name, type: f.type, description: f.description || '',
                                                required: f.required || false, unique: false,
                                                searchable: false, listable: true, creatable: true, editable: true,
                                                // Preserve relation metadata for FK columns
                                                ...(f.type === 'relation' ? {
                                                  relationType: f.relationType,
                                                  relationTable: f.relationTable,
                                                  relationDisplayField: f.relationDisplayField,
                                                } : {}),
                                              })));
                                              // Auto-detect FK column: find a relation field (M2O or M2M→FK) on the
                                              // target table that references the current master table
                                              const masterTable = form.getFieldValue('tableName');
                                              const fkField = fields.find(f =>
                                                f.type === 'relation' &&
                                                (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') &&
                                                f.relationTable === masterTable
                                              );
                                              if (fkField) {
                                                form.setFieldValue(['fields', name, 'relationFkColumn'], fkField.name);
                                              } else {
                                                console.warn('[autocode] Could not auto-detect FK column on table', tableName, '→ master:', masterTable);
                                                console.warn('[autocode] Available fields:', fields.filter(f => f.type === 'relation').map(f => ({ name: f.name, relationType: f.relationType, relationTable: f.relationTable })));
                                              }
                                            }
                                            form.setFieldValue(['fields', name, 'relationDisplayField'], undefined);
                                          } catch {
                                            message.error('加载表字段失败');
                                          }
                                        }}
                                      />
                                    </Form.Item>
                                  );
                                }}
                              </Form.Item>
                            </Col>
                            <Col span={7}>
                              <Form.Item
                                noStyle
                                shouldUpdate={(prev, cur) =>
                                  prev?.fields?.[name as number]?.relationType !== cur?.fields?.[name as number]?.relationType
                                  || prev?.fields?.[name as number]?.detailMode !== cur?.fields?.[name as number]?.detailMode
                                  || prev?.fields?.[name as number]?.detailFields !== cur?.fields?.[name as number]?.detailFields
                                  || prev?.fields?.[name as number]?.relationTable !== cur?.fields?.[name as number]?.relationTable
                                  || prev?.fields?.[name as number]?.relationTableFieldOpts !== cur?.fields?.[name as number]?.relationTableFieldOpts
                                }
                              >
                                {({ getFieldValue }) => {
                                  const rType = getFieldValue(['fields', name, 'relationType']);
                                  const detailMode = getFieldValue(['fields', name, 'detailMode']);
                                  const relationTable = getFieldValue(['fields', name, 'relationTable']);
                                  // Hide Display Field for one-to-many + 新建子表
                                  if (rType === 'one-to-many' && detailMode !== 'existing') return null;
                                  // Build options: for one-to-many+existing use detailFields; for others use form value (triggers re-render)
                                  let fieldOpts: { value: string; label: string }[] = [];
                                  if (rType === 'one-to-many' && detailMode === 'existing') {
                                    const loadedFields: AutoCodeField[] = getFieldValue(['fields', name, 'detailFields']) || [];
                                    fieldOpts = loadedFields.map(f => ({ value: f.name, label: `${f.name}${f.description ? ` (${f.description})` : ''}` }));
                                  } else if (relationTable) {
                                    fieldOpts = getFieldValue(['fields', name, 'relationTableFieldOpts']) || relationTableColumnsCache.current.get(relationTable) || [];
                                  }
                                  return (
                                    <Form.Item
                                      {...rest}
                                      name={[name, 'relationDisplayField']}
                                      label="Display Field"
                                      rules={[{ required: true, message: '请选择展示字段' }]}
                                      tooltip="目标表中用于显示的字段名"
                                    >
                                      <Select
                                        showSearch
                                        placeholder={fieldOpts.length === 0 ? '请先选择目标表' : '选择展示字段...'}
                                        options={fieldOpts}
                                        disabled={fieldOpts.length === 0}
                                        allowClear
                                        filterOption={(input, option) =>
                                          (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                        }
                                      />
                                    </Form.Item>
                                  );
                                }}
                              </Form.Item>
                            </Col>
                          </Row>
                          {/* One-to-many: detail mode selector + fields editor */}
                          <Form.Item
                            noStyle
                            shouldUpdate={(prev, cur) =>
                              prev?.fields?.[name as number]?.relationType !== cur?.fields?.[name as number]?.relationType
                              || prev?.fields?.[name as number]?.detailMode !== cur?.fields?.[name as number]?.detailMode
                            }
                          >
                            {({ getFieldValue }) => {
                              const rType = getFieldValue(['fields', name, 'relationType']);
                              if (rType !== 'one-to-many') return null;
                              const detailMode = getFieldValue(['fields', name, 'detailMode']) || 'new';
                              return (
                                <div style={{ margin: '0 0 8px 24px', padding: 12, background: '#f5f5f5', borderRadius: 4 }}>
                                  <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <span style={{ fontWeight: 500 }}>明细表字段</span>
                                    <Radio.Group
                                      size="small"
                                      value={detailMode}
                                      onChange={async (e) => {
                                        const mode = e.target.value;
                                        form.setFieldValue(['fields', name, 'detailMode'], mode);
                                        if (mode === 'new') {
                                          form.setFieldValue(['fields', name, 'detailFields'], []);
                                          form.setFieldValue(['fields', name, 'relationTable'], undefined);
                                          form.setFieldValue(['fields', name, 'relationFkColumn'], undefined);
                                          form.setFieldValue(['fields', name, 'relationExistingTable'], false);
                                        } else {
                                          form.setFieldValue(['fields', name, 'detailFields'], []);
                                          form.setFieldValue(['fields', name, 'relationExistingTable'], true);
                                          // If target table already selected, re-trigger FK auto-detection
                                          const existingTable = form.getFieldValue(['fields', name, 'relationTable']);
                                          if (existingTable) {
                                            try {
                                              const latest = await getLatestVersion(existingTable);
                                              const allFields = (latest.fields as AutoCodeField[]) || [];
                                              const systemFields = ['id', 'createdAt', 'updatedAt', 'deletedAt', 'createdBy', 'updatedBy'];
                                              const allUserFields2 = allFields.filter(f => !systemFields.includes(f.name));
                                              form.setFieldValue(['fields', name, 'detailFields'], allUserFields2.map(f => ({
                                                name: f.name, type: f.type, description: f.description || '',
                                                required: f.required || false, unique: false,
                                                searchable: false, listable: true, creatable: true, editable: true,
                                                ...(f.type === 'relation' ? {
                                                  relationType: f.relationType,
                                                  relationTable: f.relationTable,
                                                  relationDisplayField: f.relationDisplayField,
                                                } : {}),
                                              })));
                                              const masterTable = form.getFieldValue('tableName');
                                              const fkField = allFields.find(f =>
                                                f.type === 'relation' &&
                                                (f.relationType === 'many-to-one' || f.relationType === 'many-to-many') &&
                                                f.relationTable === masterTable
                                              );
                                              form.setFieldValue(['fields', name, 'relationFkColumn'], fkField ? fkField.name : undefined);
                                            } catch { /* ignore */ }
                                          } else {
                                            form.setFieldValue(['fields', name, 'relationFkColumn'], undefined);
                                          }
                                        }
                                      }}
                                    >
                                      <Radio.Button value="new">新建子表</Radio.Button>
                                      <Radio.Button value="existing">引用已有表</Radio.Button>
                                    </Radio.Group>
                                  </div>
                                  {detailMode === 'existing' && (
                                    <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
                                      请在上方选择已有表和展示字段，选择后字段自动填充到下方列表
                                    </Text>
                                  )}
                                  <Form.List name={[name as number, 'detailFields']}>
                                    {(detailFields, { add: addDetail, remove: removeDetail }) => (
                                      <>
                                        {detailFields.map(({ name: dName, key: dKey, ...dRest }) => (
                                          <div key={dKey} style={{ border: '1px dashed #d9d9d9', borderRadius: 4, padding: '8px 8px 4px', marginBottom: 6, background: '#fff' }}>
                                            <Space align="baseline" wrap style={{ marginBottom: 0 }}>
                                              <Form.Item
                                                {...dRest}
                                                name={[dName, 'name']}
                                                rules={[{ required: true, pattern: /^[a-z][a-z0-9_]*$/, message: 'snake_case' }]}
                                                style={{ marginBottom: 0 }}
                                              >
                                                <Input placeholder="field_name" style={{ width: 130 }} />
                                              </Form.Item>
                                              <Form.Item {...dRest} name={[dName, 'type']} style={{ marginBottom: 0 }}>
                                                <Select
                                                  style={{ width: 150 }}
                                                  options={fieldTypeOptions.filter(o => o.value !== 'code')}
                                                  onChange={() => {
                                                    form.setFieldValue(['fields', name, 'detailFields', dName, 'relationType'], undefined);
                                                    form.setFieldValue(['fields', name, 'detailFields', dName, 'relationTable'], undefined);
                                                    form.setFieldValue(['fields', name, 'detailFields', dName, 'relationDisplayField'], undefined);
                                                    form.setFieldValue(['fields', name, 'detailFields', dName, 'dictType'], undefined);
                                                    form.setFieldValue(['fields', name, 'detailFields', dName, 'detailFields'], []);
                                                  }}
                                                />
                                              </Form.Item>
                                              <Form.Item {...dRest} name={[dName, 'description']} style={{ marginBottom: 0 }}>
                                                <Input placeholder="描述" style={{ width: 120 }} />
                                              </Form.Item>
                                              <Form.Item {...dRest} name={[dName, 'required']} valuePropName="checked" style={{ marginBottom: 0 }}>
                                                <Switch size="small" />
                                              </Form.Item>
                                              <DeleteOutlined onClick={() => removeDetail(dName)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                                            </Space>
                                            {/* Relation config for child detail field */}
                                            <Form.Item
                                              noStyle
                                              shouldUpdate={(prev, cur) => {
                                                const prevDf = prev.fields?.[name as number]?.detailFields?.[dName as number];
                                                const curDf = cur.fields?.[name as number]?.detailFields?.[dName as number];
                                                return prevDf?.type !== curDf?.type
                                                  || prevDf?.relationType !== curDf?.relationType
                                                  || prevDf?.relationTable !== curDf?.relationTable
                                                  || prevDf?.relationTableFieldOpts !== curDf?.relationTableFieldOpts;
                                              }}
                                            >
                                              {({ getFieldValue }) => {
                                                const dfType = getFieldValue(['fields', name, 'detailFields', dName, 'type']);
                                                if (dfType !== 'relation') return null;
                                                const dfRelType = getFieldValue(['fields', name, 'detailFields', dName, 'relationType']);
                                                const dfRelTable = getFieldValue(['fields', name, 'detailFields', dName, 'relationTable']);
                                                const dfFieldOpts = getFieldValue(['fields', name, 'detailFields', dName, 'relationTableFieldOpts'])
                                                  || (dfRelTable ? relationTableColumnsCache.current.get(dfRelTable) : []) || [];
                                                return (
                                                  <div style={{ marginTop: 6, paddingLeft: 8, borderLeft: '2px solid #1677ff44', paddingBottom: 4 }}>
                                                    <Space align="baseline" wrap style={{ marginBottom: dfRelType === 'one-to-many' ? 4 : 0 }}>
                                                      <Form.Item
                                                        {...dRest}
                                                        name={[dName, 'relationType']}
                                                        label="关系类型"
                                                        rules={[{ required: true, message: 'Required' }]}
                                                        style={{ marginBottom: 0 }}
                                                      >
                                                        <Select
                                                          style={{ width: 190 }}
                                                          options={[
                                                            { value: 'many-to-one', label: '多对一 (N:1)' },
                                                            { value: 'one-to-many', label: '一对多 (1:N) 子子表' },
                                                          ]}
                                                          onChange={() => {
                                                            form.setFieldValue(['fields', name, 'detailFields', dName, 'relationTable'], undefined);
                                                            form.setFieldValue(['fields', name, 'detailFields', dName, 'relationDisplayField'], undefined);
                                                            form.setFieldValue(['fields', name, 'detailFields', dName, 'detailFields'], []);
                                                          }}
                                                        />
                                                      </Form.Item>
                                                      {dfRelType === 'many-to-one' && (
                                                        <>
                                                          <Form.Item
                                                            {...dRest}
                                                            name={[dName, 'relationTable']}
                                                            label="目标表"
                                                            rules={[{ required: true, message: 'Required' }]}
                                                            style={{ marginBottom: 0 }}
                                                          >
                                                            <Select
                                                              showSearch
                                                              style={{ width: 140 }}
                                                              placeholder="选择表..."
                                                              options={tableOptions}
                                                              filterOption={(input, option) =>
                                                                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                                              }
                                                              onChange={async (tbl: string) => {
                                                                form.setFieldValue(['fields', name, 'detailFields', dName, 'relationDisplayField'], undefined);
                                                                if (!tbl) return;
                                                                try {
                                                                  const latest = await getLatestVersion(tbl);
                                                                  const cols = ((latest.fields as AutoCodeField[]) || [])
                                                                    .filter(f => !['id','createdAt','updatedAt','deletedAt','createdBy','updatedBy'].includes(f.name) && f.type !== 'relation')
                                                                    .map(f => ({ value: f.name, label: `${f.name}${f.description ? ` (${f.description})` : ''}` }));
                                                                  relationTableColumnsCache.current.set(tbl, cols);
                                                                  form.setFieldValue(['fields', name, 'detailFields', dName, 'relationTableFieldOpts'], cols);
                                                                } catch {
                                                                  message.error('加载表字段失败');
                                                                }
                                                              }}
                                                            />
                                                          </Form.Item>
                                                          <Form.Item
                                                            {...dRest}
                                                            name={[dName, 'relationDisplayField']}
                                                            label="展示字段"
                                                            rules={[{ required: true, message: '请选择展示字段' }]}
                                                            style={{ marginBottom: 0 }}
                                                          >
                                                            <Select
                                                              showSearch
                                                              style={{ width: 140 }}
                                                              placeholder={dfFieldOpts.length === 0 ? '请先选择目标表' : '选择字段...'}
                                                              options={dfFieldOpts}
                                                              disabled={dfFieldOpts.length === 0}
                                                              filterOption={(input, option) =>
                                                                (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                                              }
                                                            />
                                                          </Form.Item>
                                                        </>
                                                      )}
                                                    </Space>
                                                    {/* one-to-many: grandchild fields editor */}
                                                    {dfRelType === 'one-to-many' && (
                                                      <div style={{ paddingLeft: 8, borderLeft: '2px solid #52c41a44', marginTop: 4 }}>
                                                        <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>子子表字段</div>
                                                        <Form.List name={[dName as number, 'detailFields']}>
                                                          {(grandFields, { add: addGrand, remove: removeGrand }) => (
                                                            <>
                                                              {grandFields.map(({ name: gName, key: gKey, ...gRest }) => (
                                                                <Space key={gKey} align="baseline" wrap style={{ marginBottom: 4 }}>
                                                                  <Form.Item
                                                                    {...gRest}
                                                                    name={[gName, 'name']}
                                                                    rules={[{ required: true, pattern: /^[a-z][a-z0-9_]*$/, message: 'snake_case' }]}
                                                                    style={{ marginBottom: 0 }}
                                                                  >
                                                                    <Input placeholder="field_name" style={{ width: 120 }} />
                                                                  </Form.Item>
                                                                  <Form.Item {...gRest} name={[gName, 'type']} style={{ marginBottom: 0 }}>
                                                                    <Select
                                                                      style={{ width: 130 }}
                                                                      options={fieldTypeOptions.filter(o => o.value !== 'relation' && o.value !== 'code')}
                                                                      onChange={() => {
                                                                        form.setFieldValue(['fields', name, 'detailFields', dName, 'detailFields', gName, 'dictType'], undefined);
                                                                      }}
                                                                    />
                                                                  </Form.Item>
                                                                  <Form.Item {...gRest} name={[gName, 'description']} style={{ marginBottom: 0 }}>
                                                                    <Input placeholder="描述" style={{ width: 100 }} />
                                                                  </Form.Item>
                                                                  <Form.Item {...gRest} name={[gName, 'required']} valuePropName="checked" style={{ marginBottom: 0 }}>
                                                                    <Switch size="small" />
                                                                  </Form.Item>
                                                                  <Form.Item
                                                                    noStyle
                                                                    shouldUpdate={(prev, cur) =>
                                                                      prev.fields?.[name as number]?.detailFields?.[dName as number]?.detailFields?.[gName as number]?.type
                                                                        !== cur.fields?.[name as number]?.detailFields?.[dName as number]?.detailFields?.[gName as number]?.type
                                                                    }
                                                                  >
                                                                    {({ getFieldValue: gfv }) => {
                                                                      const gType = gfv(['fields', name, 'detailFields', dName, 'detailFields', gName, 'type']);
                                                                      if (gType !== 'dict') return null;
                                                                      return (
                                                                        <Form.Item {...gRest} name={[gName, 'dictType']} style={{ marginBottom: 0 }}>
                                                                          <Select
                                                                            showSearch
                                                                            placeholder="字典类型"
                                                                            style={{ width: 130 }}
                                                                            options={dictOptions}
                                                                            filterOption={(input, option) =>
                                                                              (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                                                            }
                                                                          />
                                                                        </Form.Item>
                                                                      );
                                                                    }}
                                                                  </Form.Item>
                                                                  <DeleteOutlined onClick={() => removeGrand(gName)} style={{ color: '#ff4d4f', cursor: 'pointer' }} />
                                                                </Space>
                                                              ))}
                                                              <Button
                                                                type="dashed"
                                                                size="small"
                                                                onClick={() => addGrand({ name: '', type: 'varchar', required: false, unique: false, description: '', searchable: false, listable: true, creatable: true, editable: true })}
                                                                style={{ marginTop: 4 }}
                                                              >
                                                                + 添加子子表字段
                                                              </Button>
                                                            </>
                                                          )}
                                                        </Form.List>
                                                      </div>
                                                    )}
                                                  </div>
                                                );
                                              }}
                                            </Form.Item>
                                            {/* Dict config for child detail field */}
                                            <Form.Item
                                              noStyle
                                              shouldUpdate={(prev, cur) =>
                                                prev.fields?.[name as number]?.detailFields?.[dName as number]?.type
                                                  !== cur.fields?.[name as number]?.detailFields?.[dName as number]?.type
                                              }
                                            >
                                              {({ getFieldValue }) => {
                                                const dfType = getFieldValue(['fields', name, 'detailFields', dName, 'type']);
                                                if (dfType !== 'dict') return null;
                                                return (
                                                  <Form.Item
                                                    {...dRest}
                                                    name={[dName, 'dictType']}
                                                    label="字典类型"
                                                    rules={[{ required: true, message: '请选择字典类型' }]}
                                                    style={{ marginBottom: 0, marginTop: 6 }}
                                                  >
                                                    <Select
                                                      showSearch
                                                      placeholder="请选择字典类型"
                                                      style={{ width: 220 }}
                                                      options={dictOptions}
                                                      filterOption={(input, option) =>
                                                        (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                                      }
                                                    />
                                                  </Form.Item>
                                                );
                                              }}
                                            </Form.Item>
                                          </div>
                                        ))}
                                        <Button
                                          type="dashed"
                                          size="small"
                                          onClick={() => addDetail({ name: '', type: 'varchar', required: false, unique: false, description: '', searchable: false, listable: true, creatable: true, editable: true })}
                                        >
                                          + 添加明细字段
                                        </Button>
                                      </>
                                    )}
                                  </Form.List>
                                </div>
                              );
                            }}
                          </Form.Item>
                          </>
                        );
                      }}
                    </Form.Item>
                    {/* Dict config — only visible when type === 'dict' */}
                    <Form.Item noStyle shouldUpdate={(prev, cur) => {
                      const prevType = prev.fields?.[name]?.type;
                      const curType = cur.fields?.[name]?.type;
                      return prevType !== curType;
                    }}>
                      {({ getFieldValue }) => {
                        const fieldType = getFieldValue(['fields', name, 'type']);
                        if (fieldType !== 'dict') return null;
                        return (
                          <Row gutter={12} style={{ marginBottom: 8, padding: '0 0 8px 0', background: '#fafafa', borderRadius: 4, margin: '0 0 8px 0' }}>
                            <Col span={1} />
                            <Col span={14}>
                              <Form.Item
                                name={[name, 'dictType']}
                                label="字典类型"
                                rules={[{ required: true, message: '请选择字典类型' }]}
                              >
                                <Select
                                  showSearch
                                  placeholder="请选择字典类型"
                                  options={dictOptions}
                                  filterOption={(input, option) =>
                                    (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
                                  }
                                />
                              </Form.Item>
                            </Col>
                          </Row>
                        );
                      }}
                    </Form.Item>
                    {/* Code config — only visible when type === 'code' */}
                    <Form.Item noStyle shouldUpdate={(prev, cur) => {
                      const prevType = prev.fields?.[name]?.type;
                      const curType = cur.fields?.[name]?.type;
                      return prevType !== curType;
                    }}>
                      {({ getFieldValue }) => {
                        const fieldType = getFieldValue(['fields', name, 'type']);
                        if (fieldType !== 'code') return null;
                        return (
                          <Row gutter={8} align="middle" style={{ marginBottom: 8, padding: '0 0 8px 0', background: '#fafafa', borderRadius: 4, margin: '0 0 8px 0' }}>
                            <Col span={1} />
                            <Col flex="auto">
                              <Form.Item
                                name={[name, 'ruleId']}
                                label="编码规则"
                                rules={[{ required: true, message: '请选择编码规则' }]}
                              >
                                <Select
                                  showSearch
                                  placeholder="选择编码规则"
                                  optionFilterProp="label"
                                  options={encodingRuleOptions}
                                  onDropdownVisibleChange={(open) => {
                                    if (open) loadEncodingRules();
                                  }}
                                />
                              </Form.Item>
                            </Col>
                            <Col flex="none" style={{ paddingTop: 4 }}>
                              <Button
                                type="dashed"
                                onClick={() => setQuickCreateRuleModalOpen(true)}
                              >
                                + 新建规则
                              </Button>
                            </Col>
                          </Row>
                        );
                      }}
                    </Form.Item>
                  </Card>
                    );
                  }}
                  </Form.Item>
                ))}
                <Button
                  type="dashed"
                  icon={<PlusOutlined />}
                  onClick={() => add({ ...DEFAULT_FIELD })}
                  block
                >
                  Add Field
                </Button>
              </>
            )}
          </Form.List>
        </Card>

        <div style={{ marginBottom: 24 }}>
          <Space>
            <Button
              type="primary"
              icon={<EyeOutlined />}
              loading={previewLoading}
              onClick={handlePreview}
            >
              Preview
            </Button>
            {isSuperAdmin && (
              <Button
                icon={<SaveOutlined />}
                onClick={async () => {
                  try {
                    const values = await form.validateFields();
                    const tableName = values.tableName?.trim();
                    const desc = values.description?.trim();
                    if (!tableName) {
                      message.warning('请先填写 Table Name');
                      return;
                    }
                    Modal.confirm({
                      title: '保存为模板包',
                      content: (
                        <div>
                          <p>将当前表单配置保存为模板包，并创建对应的目录菜单。</p>
                          <Input
                            id="save-pkg-name"
                            defaultValue={desc || tableName}
                            placeholder="模板包名称"
                            style={{ marginTop: 8 }}
                          />
                        </div>
                      ),
                      okText: '保存',
                      cancelText: '取消',
                      onOk: async () => {
                        const nameInput = document.querySelector('#save-pkg-name') as HTMLInputElement;
                        const pkgName = nameInput?.value?.trim() || desc || tableName;
                        try {
                          await saveFromConfig({
                            name: pkgName,
                            description: desc,
                            tableName,
                            fields: values.fields || [],
                            generateWeb,
                            generateTemplates: false,
                          });
                          message.success(`模板包 "${pkgName}" 已保存`);
                          // Refresh package list
                          const pkgs = await listAllPackages();
                          setPackageOptions(pkgs);
                        } catch (err: any) {
                          const errMsg = err?.response?.data?.msg || err?.message || '保存失败';
                          message.error(errMsg);
                        }
                      },
                    });
                  } catch {
                    message.warning('请先修正表单');
                  }
                }}
              >
                Save as Package
              </Button>
            )}
            {updateMode && isSuperAdmin && (
              <Button
                type="primary"
                icon={<RocketOutlined />}
                loading={generateLoading}
                style={{ background: '#fa8c16', borderColor: '#fa8c16' }}
                onClick={async () => {
                  try {
                    setGenerateLoading(true);
                    const values = await form.validateFields();
                    const dto: AutoCodeDto = {
                      tableName: values.tableName.trim(),
                      description: values.description.trim(),
                      fields: values.fields || [],
                      generateWeb,
                      ...(selectedPackageId ? { packageId: selectedPackageId } : {}),
                    };
                    try {
                      await startUpdateJob(dto);
                    } catch (err: any) {
                      // Axios errors put backend message in err.response.data.msg
                      const errMsg = err?.response?.data?.msg || err?.message || '';
                      // No structural changes — offer force regeneration
                      if (errMsg.includes('没有检测到表结构变更')) {
                        Modal.confirm({
                          title: '未检测到表结构变更',
                          icon: <ExclamationCircleOutlined />,
                          content: errMsg + '\n\n如果修改了代码生成器模板，可以强制重新生成以应用最新模板。',
                          okText: '强制重新生成',
                          cancelText: '取消',
                          onOk: async () => {
                            try {
                              setGenerateLoading(true);
                              await startUpdateJob({ ...dto, force: true });
                            } catch (err2: any) {
                              const err2Msg = err2?.response?.data?.msg || err2?.message || 'Update failed';
                              message.error(err2Msg);
                            } finally {
                              setGenerateLoading(false);
                            }
                          },
                        });
                        return;
                      }
                      // Field removal detected — ask for confirmation
                      if (errMsg.includes('硬删除')) {
                        Modal.confirm({
                          title: '⚠️ 检测到字段硬删除',
                          icon: <ExclamationCircleOutlined />,
                          width: 520,
                          content: (
                            <div>
                              <p>{errMsg}</p>
                              <p style={{ marginTop: 8 }}>确认后该列数据将<strong>永久丢失</strong>，无法恢复。</p>
                            </div>
                          ),
                          okText: '确认移除字段',
                          okType: 'danger',
                          cancelText: '取消',
                          onOk: async () => {
                            try {
                              setGenerateLoading(true);
                              await startUpdateJob({ ...dto, force: true });
                            } catch (err2: any) {
                              const err2Msg = err2?.response?.data?.msg || err2?.message || 'Update failed';
                              message.error(err2Msg);
                            } finally {
                              setGenerateLoading(false);
                            }
                          },
                        });
                        return;
                      }
                      throw err;
                    }
                  } catch (err: any) {
                    if (err?.errorFields) {
                      message.error('Please fix the form errors first');
                      return;
                    }
                    const errMsg = err?.response?.data?.msg || err?.message || 'Update failed';
                    message.error(errMsg);
                  } finally {
                    setGenerateLoading(false);
                  }
                }}
              >
                Update Module (v{currentVersion ?? '?'} → v{(currentVersion ?? 0) + 1})
              </Button>
            )}
            {!updateMode && isSuperAdmin && (
              <Popconfirm
                title="确认代码生成"
                description="代码将被写入磁盘，包含后端服务、数据库表、前端页面和菜单。生成过程中后端会自动重启。"
                onConfirm={handleGenerate}
                okText="开始生成"
                cancelText="取消"
              >
                <Button
                  type="primary"
                  danger
                  icon={<CodeOutlined />}
                  loading={generateLoading}
                >
                  Generate to Disk
                </Button>
              </Popconfirm>
            )}
            {!isSuperAdmin && (
              <Tooltip title="Only Super Admin can generate code to disk">
                <Button disabled icon={<CodeOutlined />}>
                  Generate to Disk
                </Button>
              </Tooltip>
            )}
          </Space>
        </div>
      </Form>

      {Object.keys(previewFiles).length > 0 && (
        <Card
          title={`Generated Files (${Object.keys(previewFiles).length})`}
          bodyStyle={{ padding: 0 }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabPosition="left"
            style={{ minHeight: 400 }}
            items={tabItems}
          />
        </Card>
      )}
        </>
      )}

      {/* Quick-create encoding rule modal */}
      <ModalForm
        title="新建编码规则"
        open={quickCreateRuleModalOpen}
        onOpenChange={setQuickCreateRuleModalOpen}
        modalProps={{ destroyOnClose: true }}
        onFinish={async (values) => {
          try {
            const rule = await createEncodingRule(values);
            await loadEncodingRules();
            message.success(`编码规则 "${rule.name}" 已创建`);
            setQuickCreateRuleModalOpen(false);
          } catch (err: any) {
            message.error(err?.response?.data?.msg || err?.message || '创建失败');
          }
          return true;
        }}
      >
        <ProFormText name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} />
        <ProFormText name="prefix" label="前缀" placeholder="如 STU、CON" />
        <ProFormSelect
          name="dateFormat"
          label="日期格式"
          options={[
            { label: '无', value: 'none' },
            { label: 'yyyyMMdd', value: 'yyyyMMdd' },
            { label: 'yyMM', value: 'yyMM' },
            { label: 'yyyy', value: 'yyyy' },
          ]}
        />
        <ProFormText name="separator" label="分隔符" placeholder="-" initialValue="-" />
        <ProFormDigit name="sequenceDigits" label="序号位数" min={1} max={10} initialValue={4} />
        <ProFormSelect
          name="resetCycle"
          label="重置周期"
          rules={[{ required: true, message: '请选择重置周期' }]}
          options={[
            { label: '永不重置', value: 'never' },
            { label: '按年重置', value: 'yearly' },
            { label: '按月重置', value: 'monthly' },
          ]}
        />
      </ModalForm>

      {/* Generate progress modal — "前往新模块" button lives here */}
      <GenerateProgressModal
        open={progressOpen}
        jobId={progressJobId}
        tableName={progressTableName}
        mode={progressMode}
        onClose={() => { clearActiveJob(); setProgressOpen(false); }}
      />
    </div>
  );
}
