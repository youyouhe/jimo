import request from './request';

export interface AutoCodeField {
  name: string;
  type:
    | 'varchar' | 'text' | 'integer' | 'bigint' | 'decimal'
    | 'boolean' | 'timestamp' | 'uuid' | 'image' | 'file'
    | 'relation' | 'dict' | 'code' | 'point' | 'calculated';
  length?: number;
  required: boolean;
  unique: boolean;
  description: string;
  searchable: boolean;
  listable: boolean;
  creatable: boolean;
  editable: boolean;
  // Relation-specific
  relationType?: 'many-to-one' | 'many-to-many' | 'one-to-many';
  relationTable?: string;
  relationDisplayField?: string;
  // One-to-many: child detail fields
  detailFields?: AutoCodeField[];
  // One-to-many: 'new' creates a new child table; 'existing' auto-fills fields from selected table
  detailMode?: 'new' | 'existing';
  // One-to-many: use an existing table as the child table (maps to relationExistingTable)
  relationExistingTable?: boolean;
  // One-to-many with existing table: FK column name on the child table
  relationFkColumn?: string;
  // Dict-specific: dictionary type key (type === 'dict')
  dictType?: string;
  // Code-specific: encoding rule id (type === 'code')
  ruleId?: string;
  // Point (GIS) config (type === 'point')
  geoConfig?: { coordinateSystem?: string; mapProvider?: string };
  // Calculated (virtual) field — computed on read, never stored (type === 'calculated')
  formula?: string;
  resultType?: 'number' | 'string';
  // Soft-remove marker
  removed?: boolean;
}

export interface AutoCodeDto {
  tableName: string;
  description: string;
  fields: AutoCodeField[];
  generateWeb: boolean;
  force?: boolean;
  packageId?: string;
  packageName?: string;
  // Mock-data generation (opt-in). When absent the backend defaults to no mock rows.
  mockData?: { enabled: boolean; count: number };
  // Approval flow (opt-in). Enables BPM approval for this entity.
  approvalFlow?: { enabled: boolean; defaultChain: string[] };
  // Visibility strategy for this entity.
  visibilityStrategy?: 'private' | 'department' | 'shared' | 'public';
  // Agent configuration (opt-in). Enables an accompanying agent for the entity.
  agentConfig?: { enabled: boolean; tools?: ('query' | 'create' | 'update' | 'delete' | 'search' | 'mock')[]; systemPrompt?: string };
  // Page type: list=standard table+modal (default), document=list+dedicated detail page
  pageType?: 'list' | 'document';
}

export interface TemplateMetadata {
  fieldTypes: Array<{
    value: string;
    label: string;
    tsType: string;
    defaultLength?: number;
  }>;
  files: Array<{
    key: string;
    label: string;
    path: string;
  }>;
}

// ---------------------------------------------------------------------------
// Async generate progress types
// ---------------------------------------------------------------------------

export type GenerateStepStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface GenerateStep {
  key: string;
  label: string;
  status: GenerateStepStatus;
}

export interface GenerateJobStatus {
  jobId: string;
  status: 'processing' | 'completed' | 'failed';
  steps: GenerateStep[];
  progress: number;
  currentStepLabel: string;
  result?: Record<string, any>;
  error?: string;
  completedAt?: string;
}

/**
 * Preview generated code without writing files.
 * Returns a map of filepath -> source code content.
 */
export async function previewGenerate(dto: AutoCodeDto): Promise<Record<string, string>> {
  return request.post('/autocode/preview', dto);
}

/**
 * Get list of user tables in the database.
 * Returns array of table names.
 */
export async function getTables(): Promise<string[]> {
  return request.get('/autocode/tables');
}

// ---------------------------------------------------------------------------
// ER Graph
// ---------------------------------------------------------------------------

export interface ErFieldInfo {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  relationTable?: string;
  relationType?: string;
}

export interface ErGraphNode {
  id: string;
  table: string;
  description: string;
  packageName?: string | null;
  fields: ErFieldInfo[];
  /** 隐式子表(one-to-many 新建,无独立 history),前端用虚线边框区分 */
  isImplicit?: boolean;
  /** 角色:main 主表/独立 | child 1:N 子表 | junction N:N 关联表 */
  role?: ErNodeRole;
  // index signature: ReactFlow v12 requires Node data to extend Record<string, unknown>
  [key: string]: unknown;
}

export type ErRelationType = 'many-to-one' | 'many-to-many' | 'one-to-many';

/** 实体在 ER 图中的角色,决定边框颜色 */
export type ErNodeRole = 'main' | 'child' | 'junction' | 'child-junction';

export interface ErGraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: ErRelationType;
  label: string;
}

export interface ErGraphData {
  nodes: ErGraphNode[];
  edges: ErGraphEdge[];
}

/**
 * Get ER graph of all generated entities and their relations.
 * Optional packageId filters to a single template package.
 */
export async function getErGraph(packageId?: string): Promise<ErGraphData> {
  return request.get('/autocode/er-graph', { params: packageId ? { packageId } : {} });
}

// ---------------------------------------------------------------------------
// AI generator config test
// ---------------------------------------------------------------------------

export interface AiTestConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/**
 * 测试 BYOC 配置连通性(经后端代理,避免浏览器 CORS)。
 * 后端用极简 ping 请求验证 baseUrl/apiKey/model。
 */
export async function testAiConfig(
  config: AiTestConfig,
): Promise<{ ok: boolean; message: string }> {
  return request.post(
    '/autocode/ai-test',
    {},
    {
      headers: {
        'X-AI-Api-Key': config.apiKey,
        'X-AI-Base-URL': config.baseUrl,
        'X-AI-Model': config.model,
      },
    },
  );
}

export interface CascadeChainEntry {
  autocodeTable: string;
  dbTable: string;
  recordCount: number;
  files: string[];
  menus: Array<{ id: string; name: string; path: string }>;
  hasHistory: boolean;
}

export interface ImpactAnalysis {
  tableName: string;
  dbTableName: string;
  recordCount: number;
  referencedBy: Array<{ table: string; column: string; constraint: string }>;
  menus: Array<{ id: string; name: string; path: string }>;
  roleMenuCount: number;
  files: string[];
  hasHistory: boolean;
  cascadeChain?: CascadeChainEntry[];
}

/**
 * Analyze impact of deleting a generated module.
 * Set cascade=true to also analyze FK-dependent tables.
 */
export async function analyzeImpact(tableName: string, cascade = false): Promise<ImpactAnalysis> {
  return request.get(`/autocode/impact/${tableName}`, { params: { cascade } });
}

/**
 * Start async code generation. Returns jobId for progress tracking.
 */
export async function executeGenerate(dto: AutoCodeDto): Promise<{ jobId: string }> {
  return request.post('/autocode/generate', dto);
}

/**
 * Poll generation job status. Survives backend restarts.
 */
export async function getGenerateStatus(jobId: string): Promise<GenerateJobStatus> {
  return request.get(`/autocode/generate-status/${jobId}`);
}

/**
 * Get available field types and template metadata.
 */
export async function getTemplates(): Promise<TemplateMetadata> {
  return request.get('/autocode/templates');
}

// ---------------------------------------------------------------------------
// History types and API
// ---------------------------------------------------------------------------

export interface AutoCodeHistory {
  id: string;
  packageName: string;
  tableName: string;
  businessDB: string;
  templates: Record<string, string>;
  createdAt: string;
  // Version management fields
  version?: number;
  fields?: AutoCodeField[];
  changeLog?: string;
  operation?: 'create' | 'update' | 'rollback';
  parentId?: string;
  visibilityStrategy?: 'private' | 'department' | 'shared' | 'public';
  hasApprovalFlow?: boolean;
  hasAgent?: boolean;
}

export interface AutoCodeHistoryListParams {
  page?: number;
  pageSize?: number;
  tableName?: string;
}

export interface AutoCodeHistoryListResult {
  list: AutoCodeHistory[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Get paginated list of code generation history records.
 */
export async function getAutoCodeHistory(params?: AutoCodeHistoryListParams): Promise<AutoCodeHistoryListResult> {
  return request.get('/autocode/history', { params });
}

/**
 * Get a single history record by ID.
 */
export async function getAutoCodeHistoryDetail(id: string): Promise<AutoCodeHistory> {
  return request.get(`/autocode/history/${id}`);
}

/**
 * Rollback to a previous generation snapshot.
 */
export async function rollbackAutoCodeHistory(id: string): Promise<{ restoredFiles: string[] }> {
  return request.post(`/autocode/history/${id}/rollback`);
}

/**
 * Start async deletion of a history record and all generated artifacts.
 * Returns jobId for progress tracking.
 */
export async function deleteAutoCodeHistory(id: string, cascade = false): Promise<{ jobId: string }> {
  return request.delete(`/autocode/history/${id}`, { params: { cascade } });
}

/**
 * Poll deletion job status.
 */
export async function getDeleteStatus(jobId: string): Promise<GenerateJobStatus> {
  return request.get(`/autocode/delete-status/${jobId}`);
}

// ---------------------------------------------------------------------------
// Version & Update types and API
// ---------------------------------------------------------------------------

export interface UpdateModuleDto {
  tableName: string;
  description?: string;
  fields: AutoCodeField[];
  generateWeb?: boolean;
  force?: boolean;
}

/**
 * Get the latest version record for a table (includes fields snapshot).
 */
export async function getLatestVersion(tableName: string): Promise<AutoCodeHistory> {
  return request.get(`/autocode/latest-version/${tableName}`);
}

/**
 * Get all version records for a table, ordered by version desc.
 */
export async function getHistoryVersions(tableName: string): Promise<AutoCodeHistory[]> {
  return request.get(`/autocode/history-versions/${tableName}`);
}

/**
 * Start async module update. Returns jobId for progress tracking.
 */
export async function startModuleUpdate(dto: UpdateModuleDto): Promise<{ jobId: string }> {
  return request.post('/autocode/update', dto);
}

/**
 * Poll update job status.
 */
export async function getUpdateStatus(jobId: string): Promise<GenerateJobStatus> {
  return request.get(`/autocode/update-status/${jobId}`);
}

// ---------------------------------------------------------------------------
// Package types and API
// ---------------------------------------------------------------------------

export interface AutoCodePackage {
  id: string;
  name: string;
  description: string;
  templates: Record<string, string>;
  // Generation config snapshot
  tableName: string;
  fields: AutoCodeField[] | null;
  generateWeb: boolean;
  menuId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface AutoCodePackageListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  includeDeleted?: boolean;
}

export interface AutoCodePackageListResult {
  list: AutoCodePackage[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateAutoCodePackageDto {
  name: string;
  description?: string;
  templates: Record<string, string>;
  tableName?: string;
  fields?: AutoCodeField[];
  generateWeb?: boolean;
}

export interface UpdateAutoCodePackageDto {
  name?: string;
  description?: string;
  templates?: Record<string, string>;
  tableName?: string;
  fields?: AutoCodeField[];
  generateWeb?: boolean;
}

export interface SaveFromConfigDto {
  name: string;
  description?: string;
  tableName: string;
  fields: AutoCodeField[];
  generateWeb: boolean;
  generateTemplates?: boolean;
}

export interface PackageConfig {
  tableName: string;
  description: string;
  fields: AutoCodeField[];
  generateWeb: boolean;
  name: string;
  menuId: string | null;
}

export interface PackageListItem {
  id: string;
  name: string;
  tableName: string;
  description: string;
}

/**
 * Get paginated list of template packages.
 */
export async function getAutoCodePackages(params?: AutoCodePackageListParams): Promise<AutoCodePackageListResult> {
  return request.get('/autocode/packages', { params });
}

/**
 * List all packages (lightweight, no pagination) for dropdowns.
 */
export async function listAllPackages(): Promise<PackageListItem[]> {
  return request.get('/autocode/packages/list');
}

/**
 * Create a new template package.
 */
export async function createAutoCodePackage(dto: CreateAutoCodePackageDto): Promise<AutoCodePackage> {
  return request.post('/autocode/packages', dto);
}

/**
 * Save current generator config as a template package with directory menu.
 */
export async function saveFromConfig(dto: SaveFromConfigDto): Promise<AutoCodePackage> {
  return request.post('/autocode/packages/save-from-config', dto);
}

/**
 * Get a single template package by ID.
 */
export async function getAutoCodePackageDetail(id: string): Promise<AutoCodePackage> {
  return request.get(`/autocode/packages/${id}`);
}

/**
 * Get a package's generation config (for "Load from Package").
 */
export async function getPackageConfig(id: string): Promise<PackageConfig> {
  return request.get(`/autocode/packages/${id}/config`);
}

/**
 * Update a template package.
 */
export async function updateAutoCodePackage(id: string, dto: UpdateAutoCodePackageDto): Promise<AutoCodePackage> {
  return request.patch(`/autocode/packages/${id}`, dto);
}

/**
 * Delete a template package (soft delete).
 */
export async function deleteAutoCodePackage(id: string): Promise<void> {
  return request.delete(`/autocode/packages/${id}`);
}

// ── Reserved names ──

export interface ReservedNamesResult {
  reserved: string[];
  pagesOnDisk: string[];
  missing: string[];
}

export async function getReservedNames(): Promise<ReservedNamesResult> {
  return request.get('/autocode/reserved-names');
}

export async function syncReservedNames(names: string[]): Promise<{ added: string[] }> {
  return request.post('/autocode/reserved-names/sync', { names });
}
