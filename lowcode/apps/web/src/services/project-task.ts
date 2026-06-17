import request from './request';

export interface ProjectTask {
  id: string;
  project_id: string;
  project_id_display: string | null;
  task_name: string;
  assignee: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface ProjectTaskListParams {
  page?: number;
  pageSize?: number;
    project_id?: string;
    task_name?: string;
    assignee?: string;
    status?: string;
}

export interface ProjectTaskListResult {
  list: ProjectTask[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateProjectTaskDto {
    project_id: string;
    task_name: string;
    assignee?: string;
    status: string;
}

export interface UpdateProjectTaskDto {
    project_id?: string;
    task_name?: string;
    assignee?: string;
    status?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated project-tasks list.
 */
export async function getProjectTasksList(params?: ProjectTaskListParams): Promise<ProjectTaskListResult> {
  return request.get('/lc/project-tasks', { params });
}

/**
 * Get a single project-task by ID.
 */
export async function getProjectTask(id: string): Promise<ProjectTask> {
  return request.get(`/lc/project-tasks/${id}`);
}

/**
 * Create a new project-task.
 */
export async function createProjectTask(dto: CreateProjectTaskDto): Promise<ProjectTask> {
  return request.post('/lc/project-tasks', dto);
}

/**
 * Update an existing project-task.
 */
export async function updateProjectTask(id: string, dto: UpdateProjectTaskDto): Promise<ProjectTask> {
  return request.patch(`/lc/project-tasks/${id}`, dto);
}

/**
 * Delete a project-task by ID (soft delete).
 */
export async function deleteProjectTask(id: string): Promise<void> {
  return request.delete(`/lc/project-tasks/${id}`);
}

/**
 * Batch delete project-tasks by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteProjectTasks(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/project-tasks/batch', { data: { ids } });
}

/**
 * Get projects options for select dropdown.
 */
export async function getProjectOptions(): Promise<ProjectOption[]> {
  const res = await request.get('/lc/projects', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

