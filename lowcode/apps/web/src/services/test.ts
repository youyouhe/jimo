import request from './request';

export interface Test {
  id: string;
  name: string | null;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface TestListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    description?: string;
}

export interface TestListResult {
  list: Test[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateTestDto {
    name?: string;
    description?: string;
}

export interface UpdateTestDto {
    name?: string;
    description?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated test list.
 */
export async function getTestList(params?: TestListParams): Promise<TestListResult> {
  return request.get('/lc/test', { params });
}

/**
 * Get a single test by ID.
 */
export async function getTest(id: string): Promise<Test> {
  return request.get(`/lc/test/${id}`);
}

/**
 * Create a new test.
 */
export async function createTest(dto: CreateTestDto): Promise<Test> {
  return request.post('/lc/test', dto);
}

/**
 * Update an existing test.
 */
export async function updateTest(id: string, dto: UpdateTestDto): Promise<Test> {
  return request.patch(`/lc/test/${id}`, dto);
}

/**
 * Delete a test by ID (soft delete).
 */
export async function deleteTest(id: string): Promise<void> {
  return request.delete(`/lc/test/${id}`);
}

/**
 * Batch delete test by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteTest(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/test/batch', { data: { ids } });
}

