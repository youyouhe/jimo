import request from './request';

export interface ExportTemplate {
  id: string;
  name: string;
  tableName: string;
  templateType: string;
  config: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ExportTemplateListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  tableName?: string;
  templateType?: string;
}

export interface ExportTemplateListResult {
  list: ExportTemplate[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateExportTemplateDto {
  name: string;
  tableName: string;
  templateType: string;
  config?: Record<string, any>;
}

export interface UpdateExportTemplateDto {
  name?: string;
  tableName?: string;
  templateType?: string;
  config?: Record<string, any>;
}

export interface BatchDeleteDto {
  ids: string[];
}

export interface SqlPreviewResult {
  sql: string;
  tableName: string;
}

export interface ImportResult {
  imported: number;
  tableName: string;
}

/**
 * Get paginated export template list.
 */
export async function getExportTemplates(
  params?: ExportTemplateListParams,
): Promise<ExportTemplateListResult> {
  return request.get('/export-templates', { params });
}

/**
 * Get a single export template by ID.
 */
export async function getExportTemplate(id: string): Promise<ExportTemplate> {
  return request.get(`/export-templates/${id}`);
}

/**
 * Create a new export template.
 */
export async function createExportTemplate(
  dto: CreateExportTemplateDto,
): Promise<ExportTemplate> {
  return request.post('/export-templates', dto);
}

/**
 * Update an existing export template.
 */
export async function updateExportTemplate(
  id: string,
  dto: UpdateExportTemplateDto,
): Promise<ExportTemplate> {
  return request.patch(`/export-templates/${id}`, dto);
}

/**
 * Delete an export template by ID (soft delete).
 */
export async function deleteExportTemplate(id: string): Promise<void> {
  return request.delete(`/export-templates/${id}`);
}

/**
 * Batch delete export templates by IDs.
 */
export async function batchDeleteExportTemplates(
  ids: string[],
): Promise<{ count: number }> {
  return request.delete('/export-templates/batch', { data: { ids } });
}

/**
 * Preview generated SQL for an export template.
 */
export async function previewSql(id: string): Promise<SqlPreviewResult> {
  return request.get(`/export-templates/${id}/preview-sql`);
}

/**
 * Export data using a template — returns a Blob for download.
 */
export async function exportData(id: string): Promise<Blob> {
  const response = await fetch(`/api/v1/export-templates/${id}/export`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${localStorage.getItem('accessToken') || ''}`,
    },
  });
  if (!response.ok) throw new Error('Export failed');
  return response.blob();
}

/**
 * Import data from a file.
 */
export async function importData(
  file: File,
  templateId?: string,
): Promise<ImportResult> {
  const formData = new FormData();
  formData.append('file', file);
  if (templateId) {
    formData.append('templateId', templateId);
  }
  return request.post('/export-templates/import', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}
