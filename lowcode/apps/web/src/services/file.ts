import request from './request';

export interface FileInfo {
  id: string;
  name: string;
  url: string;
  key: string;
  tag: string;
  ext: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

export interface FileListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  tag?: string;
}

export interface FileListResult {
  list: FileInfo[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UpdateFileDto {
  name?: string;
}

/**
 * Get paginated file list.
 */
export async function getFiles(params?: FileListParams): Promise<FileListResult> {
  return request.get('/files', { params });
}

/**
 * Get a single file by ID.
 */
export async function getFile(id: string): Promise<FileInfo> {
  return request.get(`/files/${id}`);
}

/**
 * Get file info by ID.
 */
export async function getFileInfo(id: string): Promise<FileInfo> {
  return request.get(`/files/info/${id}`);
}

/**
 * Upload a file. Uses FormData for multipart upload.
 */
export async function uploadFile(file: File): Promise<FileInfo> {
  const formData = new FormData();
  formData.append('file', file);
  return request.post('/files/upload', formData);
}

/**
 * Update file name.
 */
export async function updateFile(id: string, dto: UpdateFileDto): Promise<FileInfo> {
  return request.patch(`/files/${id}`, dto);
}

/**
 * Delete a file by ID (soft delete).
 */
export async function deleteFile(id: string): Promise<void> {
  return request.delete(`/files/${id}`);
}
