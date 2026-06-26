import request from './request';

// ===================== Enums =====================

export type ProcessStatus = 'draft' | 'published' | 'deployed' | 'disabled';

// ===================== Domain Types =====================

export interface BpmProcessDefinition {
  id: string;
  name: string;
  key: string;
  description: string | null;
  icon: string | null;
  status: ProcessStatus;
  category: string | null;
  currentVersionId: string | null;
  deployedVersionId: string | null;
  currentVersionLfJson?: LfGraphData | null;
  createdAt: string;
  updatedAt: string;
}

export interface BpmProcessVersion {
  id: string;
  definitionId: string;
  version: number;
  name: string;
  lfJson: LfGraphData | null;
  bpmnXml: string | null;
  changeLog: string | null;
  isDeployed: boolean;
  deployedAt: string | null;
  deploymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ===================== LogicFlow Graph Types =====================

export interface LfNodeProperties {
  [key: string]: unknown;
  nodeType?: string;
  label?: string;
  assignee?: string;
  candidateGroups?: string;
  formKey?: string;
  dueDate?: string;
  priority?: string;
  category?: string;
  conditionExpression?: string;
  defaultFlow?: boolean;
  documentation?: string;
  skipExpression?: string;
}

export interface LfNode {
  id: string;
  type: string;
  x: number;
  y: number;
  properties: LfNodeProperties;
  text?: string | { x: number; y: number; value: string };
}

export interface LfEdgeProperties {
  [key: string]: unknown;
  conditionExpression?: string;
  defaultFlow?: boolean;
  name?: string;
}

export interface LfEdge {
  id: string;
  type: string;
  sourceNodeId: string;
  targetNodeId: string;
  properties: LfEdgeProperties;
  text?: string | { x: number; y: number; value: string };
}

export interface LfGraphData {
  nodes: LfNode[];
  edges: LfEdge[];
}

// ===================== DTOs =====================

export interface CreateProcessDto {
  name: string;
  key: string;
  description?: string;
  category?: string;
  icon?: string;
}

export interface UpdateProcessDto {
  name?: string;
  key?: string;
  description?: string;
  category?: string;
  icon?: string;
  status?: ProcessStatus;
  lfJson?: LfGraphData;
}

export interface QueryProcessDto {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: ProcessStatus;
  category?: string;
  sortBy?: 'createdAt' | 'updatedAt' | 'name' | 'status';
  sortOrder?: 'asc' | 'desc';
}

export interface CreateVersionDto {
  lfJson: LfGraphData;
  name?: string;
  changeLog?: string;
}

// ===================== Deploy Types =====================

export interface DeployResult {
  deploymentId: string;
  processKey: string;
  version: number;
  changeLog?: string;
  message: string;
}

export interface DeployStatusResult {
  isDeployed: boolean;
  deployedVersionId: string | null;
  deployedVersionNumber: number | null;
  deployedAt: string | null;
  deploymentId: string | null;
  currentVersionId: string | null;
}

// ===================== Template Types =====================

export interface BpmTemplate {
  name: string;
  displayName: string;
  description?: string;
  category?: string;
  nodeTypes?: string[];
}

// ===================== Pagination =====================

export interface PaginatedList<T> {
  list: T[];
  total: number;
}

// ===================== CRUD =====================

export async function createProcess(
  dto: CreateProcessDto,
): Promise<BpmProcessDefinition> {
  return request.post('/bpm/definitions', dto);
}

export async function getProcessList(
  params?: QueryProcessDto,
): Promise<PaginatedList<BpmProcessDefinition>> {
  return request.get('/bpm/definitions', { params });
}

export async function getProcess(
  id: string,
): Promise<BpmProcessDefinition> {
  return request.get(`/bpm/definitions/${id}`);
}

export async function updateProcess(
  id: string,
  dto: UpdateProcessDto,
): Promise<BpmProcessDefinition> {
  return request.put(`/bpm/definitions/${id}`, dto);
}

export async function deleteProcess(id: string): Promise<void> {
  return request.delete(`/bpm/definitions/${id}`);
}

// ===================== Versions =====================

export async function getVersions(
  id: string,
): Promise<BpmProcessVersion[]> {
  return request.get(`/bpm/definitions/${id}/versions`);
}

export async function createVersion(
  id: string,
  dto: CreateVersionDto,
): Promise<BpmProcessVersion> {
  return request.post(`/bpm/definitions/${id}/versions`, dto);
}

export async function getVersion(
  id: string,
  versionId: string,
): Promise<BpmProcessVersion> {
  return request.get(`/bpm/definitions/${id}/versions/${versionId}`);
}

// ===================== Deploy =====================

export async function deployProcess(
  id: string,
  versionId?: string,
): Promise<DeployResult> {
  return request.post(`/bpm/definitions/${id}/deploy`, {
    versionId,
  });
}

export async function getDeployStatus(
  id: string,
): Promise<DeployStatusResult> {
  return request.get(`/bpm/definitions/${id}/deploy-status`);
}

// ===================== Import / Export =====================

export async function importBpmnXml(
  xml: string,
  metadata?: { name?: string; key?: string; category?: string },
): Promise<BpmProcessDefinition> {
  return request.post('/bpm/definitions/import', { xml, ...metadata });
}

export async function importBpmnFile(
  file: File,
): Promise<BpmProcessDefinition> {
  const formData = new FormData();
  formData.append('file', file);
  return request.post('/bpm/definitions/import/file', formData);
}

export async function exportBpmnXml(
  id: string,
  versionId?: string,
): Promise<string> {
  return request.get(`/bpm/definitions/${id}/export`, {
    params: versionId ? { versionId } : undefined,
    responseType: 'text',
  });
}

// ===================== Templates =====================

export async function getTemplates(): Promise<BpmTemplate[]> {
  return request.get('/bpm/templates');
}

export async function getTemplate(name: string): Promise<string> {
  return request.get(`/bpm/templates/${encodeURIComponent(name)}`, {
    responseType: 'text',
  });
}
