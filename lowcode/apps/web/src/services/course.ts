import request from './request';

export interface Course {
  id: string;
  course: string | null;
  teacher: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CourseListParams {
  page?: number;
  pageSize?: number;
    course?: string;
    teacher?: string;
}

export interface CourseListResult {
  list: Course[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateCourseDto {
    course?: string;
    teacher?: string;
}

export interface UpdateCourseDto {
    course?: string;
    teacher?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated course list.
 */
export async function getCourseList(params?: CourseListParams): Promise<CourseListResult> {
  return request.get('/lc/course', { params });
}

/**
 * Get a single course by ID.
 */
export async function getCourse(id: string): Promise<Course> {
  return request.get(`/lc/course/${id}`);
}

/**
 * Create a new course.
 */
export async function createCourse(dto: CreateCourseDto): Promise<Course> {
  return request.post('/lc/course', dto);
}

/**
 * Update an existing course.
 */
export async function updateCourse(id: string, dto: UpdateCourseDto): Promise<Course> {
  return request.patch(`/lc/course/${id}`, dto);
}

/**
 * Delete a course by ID (soft delete).
 */
export async function deleteCourse(id: string): Promise<void> {
  return request.delete(`/lc/course/${id}`);
}

/**
 * Batch delete course by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteCourse(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/course/batch', { data: { ids } });
}

