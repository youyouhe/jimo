import request from './request';

export interface TrainingCoursModuleTask {
  id: string;
  task_name: string;
  task_desc: string | null;
  due_hours: number | null;
  sort_order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingCoursModule {
  id: string;
  module_name: string;
  module_desc: string | null;
  sort_order: number;
  tasks: TrainingCoursModuleTask[];
  createdAt: string;
  updatedAt: string;
}

export interface TrainingCours {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string;
  is_published: boolean;
  modules: TrainingCoursModule[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface TrainingCoursListParams {
  page?: number;
  pageSize?: number;
    name?: string;
}

export interface TrainingCoursListResult {
  list: TrainingCours[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateTrainingCoursDto {
    name: string;
    description?: string;
    start_date: string;
    end_date: string;
    is_published: boolean;
    modules?: TrainingCoursModule[];
}

export interface UpdateTrainingCoursDto {
    name?: string;
    description?: string;
    start_date?: string;
    end_date?: string;
    is_published?: boolean;
    modules?: TrainingCoursModule[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated training-courses list.
 */
export async function getTrainingCoursesList(params?: TrainingCoursListParams): Promise<TrainingCoursListResult> {
  return request.get('/lc/training-courses', { params });
}

/**
 * Get a single training-cours by ID.
 */
export async function getTrainingCours(id: string): Promise<TrainingCours> {
  return request.get(`/lc/training-courses/${id}`);
}

/**
 * Create a new training-cours.
 */
export async function createTrainingCours(dto: CreateTrainingCoursDto): Promise<TrainingCours> {
  return request.post('/lc/training-courses', dto);
}

/**
 * Update an existing training-cours.
 */
export async function updateTrainingCours(id: string, dto: UpdateTrainingCoursDto): Promise<TrainingCours> {
  return request.patch(`/lc/training-courses/${id}`, dto);
}

/**
 * Delete a training-cours by ID (soft delete).
 */
export async function deleteTrainingCours(id: string): Promise<void> {
  return request.delete(`/lc/training-courses/${id}`);
}

/**
 * Batch delete training-courses by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteTrainingCourses(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/training-courses/batch', { data: { ids } });
}

