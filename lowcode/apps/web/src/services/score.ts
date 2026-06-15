import request from './request';
import { getDictDetailsByType } from './dictionary';

export interface Score {
  id: string;
  student: string | null;
  student_display: string | null;
  course: string | null;
  course_display: string | null;
  myscore: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StudentOption {
  id: string;
  name: string;
}

export interface CourseOption {
  id: string;
  course: string;
}

export interface ScoreListParams {
  page?: number;
  pageSize?: number;
    student?: string;
    course?: string;
    myscoreMin?: string;
    myscoreMax?: string;
    memo?: string;
}

export interface ScoreListResult {
  list: Score[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateScoreDto {
    student?: string;
    course?: string;
    myscore?: string;
    memo?: string;
}

export interface UpdateScoreDto {
    student?: string;
    course?: string;
    myscore?: string;
    memo?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated score list.
 */
export async function getScoreList(params?: ScoreListParams): Promise<ScoreListResult> {
  return request.get('/lc/score', { params });
}

/**
 * Get a single score by ID.
 */
export async function getScore(id: string): Promise<Score> {
  return request.get(`/lc/score/${id}`);
}

/**
 * Create a new score.
 */
export async function createScore(dto: CreateScoreDto): Promise<Score> {
  return request.post('/lc/score', dto);
}

/**
 * Update an existing score.
 */
export async function updateScore(id: string, dto: UpdateScoreDto): Promise<Score> {
  return request.patch(`/lc/score/${id}`, dto);
}

/**
 * Delete a score by ID (soft delete).
 */
export async function deleteScore(id: string): Promise<void> {
  return request.delete(`/lc/score/${id}`);
}

/**
 * Batch delete score by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteScore(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/score/batch', { data: { ids } });
}

/**
 * Get student options for select dropdown (multi-select).
 */
export async function getStudentOptions(): Promise<StudentOption[]> {
  const res = await request.get('/lc/student', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

/**
 * Get course options for select dropdown (multi-select).
 * `course` is a dict code from course_type — resolved to human-readable label.
 */
export async function getCourseOptions(): Promise<CourseOption[]> {
  const [res, dictItems] = await Promise.all([
    request.get('/lc/course', { params: { pageSize: 100 } }),
    getDictDetailsByType('course_type'),
  ]);
  const dictMap: Record<string, string> = {};
  dictItems.forEach((d: { label: string; value: string }) => { dictMap[d.value] = d.label; });
  const list: any[] = res.list || res.data || [];
  return list.map((item: any) => ({ ...item, course: dictMap[item.course] ?? item.course }));
}

