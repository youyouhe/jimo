import request from './request';

export interface StudentFamily {
  id: string;
  name: string | null;
  relation: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Score {
  id: string;
  student: string | null;
  course: string | null;
  myscore: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  name: string | null;
  age: number | null;
  family: StudentFamily[] | null;
  score: Score[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ScoreOption {
  id: string;
  myscore: string;
}

export interface StudentListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    ageMin?: string;
    ageMax?: string;
    family?: string[];
    score?: string[];
}

export interface StudentListResult {
  list: Student[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStudentDto {
    name?: string;
    age?: number;
    family?: StudentFamily[];
    score?: Score[];
}

export interface UpdateStudentDto {
    name?: string;
    age?: number;
    family?: StudentFamily[];
    score?: Score[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated student list.
 */
export async function getStudentList(params?: StudentListParams): Promise<StudentListResult> {
  return request.get('/lc/student', { params });
}

/**
 * Get a single student by ID.
 */
export async function getStudent(id: string): Promise<Student> {
  return request.get(`/lc/student/${id}`);
}

/**
 * Create a new student.
 */
export async function createStudent(dto: CreateStudentDto): Promise<Student> {
  return request.post('/lc/student', dto);
}

/**
 * Update an existing student.
 */
export async function updateStudent(id: string, dto: UpdateStudentDto): Promise<Student> {
  return request.patch(`/lc/student/${id}`, dto);
}

/**
 * Delete a student by ID (soft delete).
 */
export async function deleteStudent(id: string): Promise<void> {
  return request.delete(`/lc/student/${id}`);
}

/**
 * Batch delete student by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteStudent(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/student/batch', { data: { ids } });
}

/**
 * Get score options for select dropdown.
 */
export async function getScoreOptions(): Promise<ScoreOption[]> {
  const res = await request.get('/lc/score', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

export interface CourseOption {
  id: string;
  course: string;
}

/**
 * Get course options for select dropdown.
 */
export async function getCourseOptions(): Promise<CourseOption[]> {
  const res = await request.get('/lc/course', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

