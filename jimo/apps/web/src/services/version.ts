import request from './request';

export interface Version {
  id: string;
  versionName: string;
  versionNumber: string;
  description: string | null;
  data: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface VersionListParams {
  page?: number;
  pageSize?: number;
  versionName?: string;
  versionNumber?: string;
}

export interface VersionListResult {
  list: Version[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateVersionDto {
  versionName: string;
  versionNumber: string;
  description?: string;
  data?: Record<string, any>;
}

export interface UpdateVersionDto {
  versionName?: string;
  versionNumber?: string;
  description?: string;
  data?: Record<string, any>;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated version list.
 */
export async function getVersions(
  params?: VersionListParams,
): Promise<VersionListResult> {
  return request.get('/versions', { params });
}

/**
 * Get a single version by ID.
 */
export async function getVersion(id: string): Promise<Version> {
  return request.get(`/versions/${id}`);
}

/**
 * Create a new version.
 */
export async function createVersion(dto: CreateVersionDto): Promise<Version> {
  return request.post('/versions', dto);
}

/**
 * Update an existing version.
 */
export async function updateVersion(
  id: string,
  dto: UpdateVersionDto,
): Promise<Version> {
  return request.patch(`/versions/${id}`, dto);
}

/**
 * Delete a version by ID (soft delete).
 */
export async function deleteVersion(id: string): Promise<void> {
  return request.delete(`/versions/${id}`);
}

/**
 * Batch delete versions by IDs.
 */
export async function batchDeleteVersions(
  ids: string[],
): Promise<{ count: number }> {
  return request.delete('/versions/batch', { data: { ids } });
}

/**
 * Export a version as a downloadable JSON blob.
 */
export async function exportVersion(id: string): Promise<Blob> {
  const response = await fetch(`/api/v1/versions/${id}/export`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
    },
  });
  if (!response.ok) throw new Error('Export failed');
  return response.blob();
}

/**
 * Import a version from a JSON file.
 */
export async function importVersion(file: File): Promise<Version> {
  const formData = new FormData();
  formData.append('file', file);
  return request.post('/versions/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
