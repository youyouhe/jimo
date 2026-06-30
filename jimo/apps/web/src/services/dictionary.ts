import request from './request';

/** Dictionary type (sys_dictionaries) */
export interface Dictionary {
  id: string;
  name: string;
  type: string;
  status: number;
  desc: string | null;
  parentId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

/** Dictionary tree node with recursive children */
export interface DictTreeNode extends Dictionary {
  children: DictTreeNode[];
}

/** Dictionary detail entry (sys_dictionary_details) */
export interface DictionaryDetail {
  id: string;
  dictId: string;
  label: string;
  value: string;
  status: number;
  sort: number;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dictionary detail tree node */
export interface DetailTreeNode extends DictionaryDetail {
  children: DetailTreeNode[];
}

/** Paginated list result */
export interface ListResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Create dictionary DTO */
export interface CreateDictDto {
  name: string;
  type: string;
  status?: number;
  desc?: string;
  parent_id?: string;
  sort?: number;
}

/** Update dictionary DTO */
export interface UpdateDictDto {
  name?: string;
  type?: string;
  status?: number;
  desc?: string;
  parent_id?: string;
  sort?: number;
}

/** Dictionary query params */
export interface DictQueryParams {
  page?: number;
  pageSize?: number;
  name?: string;
  type?: string;
  status?: number;
}

/** Create detail DTO */
export interface CreateDetailDto {
  dict_id: string;
  label: string;
  value: string;
  status?: number;
  sort?: number;
  parent_id?: string;
}

/** Update detail DTO */
export interface UpdateDetailDto {
  label?: string;
  value?: string;
  status?: number;
  sort?: number;
  parent_id?: string;
}

/** Detail query params */
export interface DetailQueryParams {
  page?: number;
  pageSize?: number;
  dict_id?: string;
  label?: string;
  status?: number;
}

/** Exported dictionary structure */
export interface ExportedDict {
  name: string;
  type: string;
  status: number;
  desc: string | null;
  details: Array<{
    label: string;
    value: string;
    status: number;
    sort: number;
    parent_id: string | null;
  }>;
}

// ── Dictionary APIs ──────────────────────────────────────────

/**
 * Get paginated dictionary list.
 */
export async function getDictionaries(params?: DictQueryParams): Promise<ListResult<Dictionary>> {
  return request.get('/dictionaries', { params });
}

/**
 * Get full dictionary tree (nested hierarchy).
 */
export async function getDictTree(): Promise<DictTreeNode[]> {
  return request.get('/dictionaries/tree');
}

/**
 * Get a single dictionary by ID.
 */
export async function getDict(id: string): Promise<Dictionary> {
  return request.get(`/dictionaries/${id}`);
}

/**
 * Create a new dictionary.
 */
export async function createDict(dto: CreateDictDto): Promise<Dictionary> {
  return request.post('/dictionaries', dto);
}

/**
 * Update an existing dictionary.
 */
export async function updateDict(id: string, dto: UpdateDictDto): Promise<Dictionary> {
  return request.patch(`/dictionaries/${id}`, dto);
}

/**
 * Soft-delete a dictionary (cascade deletes details).
 */
export async function deleteDict(id: string): Promise<void> {
  return request.delete(`/dictionaries/${id}`);
}

/**
 * Batch delete dictionaries by ids.
 */
export async function batchDeleteDicts(ids: string[]): Promise<{ count: number }> {
  return request.delete('/dictionaries/batch', { data: { ids } });
}

/**
 * Import a dictionary from JSON data.
 */
export async function importDict(json: Record<string, any>): Promise<Dictionary> {
  return request.post('/dictionaries/import', json);
}

/**
 * Export a dictionary as JSON object.
 */
export async function exportDict(id: string): Promise<ExportedDict> {
  return request.get(`/dictionaries/export/${id}`);
}

/**
 * Export a dictionary and trigger file download.
 * Uses the authenticated request instance to avoid 401 on JWT-protected routes.
 */
export async function downloadDict(id: string, type: string): Promise<void> {
  const data = await exportDict(id);
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `dictionary-${type}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Version / Snapshot APIs ──────────────────────────────────

export interface SnapshotListItem {
  id: string;
  version: number;
  changeType: string;
  operator: string | null;
  note: string | null;
  createdAt: string;
}

export interface DictionarySnapshot {
  id: string;
  dictId: string;
  version: number;
  snapshot: ExportedDict;
  changeType: string;
  operator: string | null;
  note: string | null;
  createdAt: string;
}

export async function listDictVersions(id: string): Promise<SnapshotListItem[]> {
  return request.get(`/dictionaries/${id}/versions`);
}

export async function getDictVersion(id: string, version: number): Promise<DictionarySnapshot> {
  return request.get(`/dictionaries/${id}/versions/${version}`);
}

export async function restoreDictVersion(id: string, version: number): Promise<Dictionary> {
  return request.post(`/dictionaries/${id}/restore/${version}`);
}

// ── Dictionary Detail APIs ───────────────────────────────────

/**
 * Get paginated dictionary details. Filter by dict_id.
 */
export async function getDetails(params?: DetailQueryParams): Promise<ListResult<DictionaryDetail>> {
  return request.get('/dictionary-details', { params });
}

/**
 * Get dictionary details as a nested tree by dict_id.
 */
export async function getDetailTree(dictId: string): Promise<DetailTreeNode[]> {
  return request.get('/dictionary-details/tree', { params: { dict_id: dictId } });
}

/**
 * Get a single detail by ID.
 */
export async function getDetail(id: string): Promise<DictionaryDetail> {
  return request.get(`/dictionary-details/${id}`);
}

/**
 * Create a new dictionary detail entry.
 */
export async function createDetail(dto: CreateDetailDto): Promise<DictionaryDetail> {
  return request.post('/dictionary-details', dto);
}

/**
 * Update a dictionary detail entry.
 */
export async function updateDetail(id: string, dto: UpdateDetailDto): Promise<DictionaryDetail> {
  return request.patch(`/dictionary-details/${id}`, dto);
}

/**
 * Soft-delete a dictionary detail (cascade deletes children).
 */
export async function deleteDetail(id: string): Promise<void> {
  return request.delete(`/dictionary-details/${id}`);
}

/**
 * Get all dictionary details for a given dictionary type string (e.g. 'sys_gender').
 * Returns a flat label+value array. Returns empty array if the type does not exist.
 */
export async function getDictDetailsByType(type: string): Promise<Array<{ label: string; value: string }>> {
  if (!type) return [];
  const res: any = await request.get(`/dictionary-details/by-type/${type}`);
  return (res || []).map((item: any) => ({ label: item.label, value: item.value }));
}
