import request from './request';

export interface SystemConfig {
  id: string;
  key: string;
  value: string;
  desc: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SystemConfigListParams {
  page?: number;
  pageSize?: number;
  key?: string;
}

export interface SystemConfigListResult {
  list: SystemConfig[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSystemConfigDto {
  key: string;
  value: string;
  desc?: string;
}

export interface UpdateSystemConfigDto {
  key?: string;
  value?: string;
  desc?: string;
}

export interface ServerInfo {
  platform: string;
  hostname: string;
  arch: string;
  release: string;
  uptime: number;
  cpus: {
    model: string;
    cores: number;
    speed: number;
  };
  memory: {
    total: number;
    free: number;
    used: number;
  };
  nodeVersion: string;
  loadavg: number[];
}

/**
 * Get paginated system config list.
 */
export async function getSystemConfigs(params?: SystemConfigListParams): Promise<SystemConfigListResult> {
  return request.get('/system/config', { params });
}

/**
 * Get a single system config by ID.
 */
export async function getSystemConfig(id: string): Promise<SystemConfig> {
  return request.get(`/system/config/${id}`);
}

/**
 * Create a new system config.
 */
export async function createSystemConfig(dto: CreateSystemConfigDto): Promise<SystemConfig> {
  return request.post('/system/config', dto);
}

/**
 * Update an existing system config.
 */
export async function updateSystemConfig(id: string, dto: UpdateSystemConfigDto): Promise<SystemConfig> {
  return request.patch(`/system/config/${id}`, dto);
}

/**
 * Delete a system config by ID (soft delete).
 */
export async function deleteSystemConfig(id: string): Promise<void> {
  return request.delete(`/system/config/${id}`);
}

/**
 * Batch delete system configs by IDs (soft delete).
 */
export async function batchDeleteSystemConfigs(ids: string[]): Promise<{ count: number }> {
  return request.delete('/system/config/batch', { data: { ids } });
}

/**
 * Get live server information (OS, CPU, RAM, Uptime).
 */
export async function getServerInfo(): Promise<ServerInfo> {
  return request.get('/system/server-info');
}

export interface MinioConfig {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
}

export interface SaveMinioConfigDto {
  endpoint: string;
  port: number;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSSL: boolean;
}

export interface DatabaseInfo {
  host: string;
  port: number;
  database: string;
  username: string;
  status: string;
}

export async function getMinioConfig(): Promise<MinioConfig> {
  return request.get('/system/config/minio');
}

export async function saveMinioConfig(dto: SaveMinioConfigDto): Promise<MinioConfig> {
  return request.post('/system/config/minio/save', dto);
}

export async function getDatabaseConfig(): Promise<DatabaseInfo> {
  return request.get('/system/config/database');
}

export interface CleanupJobItem {
  id: string;
  tableName: string;
  jobType: string;
  createdAt: string;
  error?: string | null;
}

export interface CleanupQueueStatus {
  pending: number;
  running: number;
  failed: number;
  done: number;
  pendingJobs: CleanupJobItem[];
  failedJobs: CleanupJobItem[];
}

export async function getCleanupQueueStatus(): Promise<CleanupQueueStatus> {
  return request.get('/system/cleanup-queue-status');
}
