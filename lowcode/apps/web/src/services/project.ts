import request from './request';
import { getDictDetailsByType } from './dictionary';

export interface ProjectTasks {
  id: string;
  task_name: string;
  assignee: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string | null;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  tasks: ProjectTasks[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ProjectTaskOption {
  id: string;
  name: string;
}

export interface ProjectListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    tasks?: string[];
}

export interface ProjectListResult {
  list: Project[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateProjectDto {
    name: string;
    description?: string;
    start_date: string;
    end_date?: string;
    is_active: boolean;
    tasks?: ProjectTasks[];
}

export interface UpdateProjectDto {
    name?: string;
    description?: string;
    start_date?: string;
    end_date?: string;
    is_active?: boolean;
    tasks?: ProjectTasks[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated projects list.
 */
export async function getProjectsList(params?: ProjectListParams): Promise<ProjectListResult> {
  return request.get('/lc/projects', { params });
}

/**
 * Get a single project by ID.
 */
export async function getProject(id: string): Promise<Project> {
  return request.get(`/lc/projects/${id}`);
}

/**
 * Create a new project.
 */
export async function createProject(dto: CreateProjectDto): Promise<Project> {
  return request.post('/lc/projects', dto);
}

/**
 * Update an existing project.
 */
export async function updateProject(id: string, dto: UpdateProjectDto): Promise<Project> {
  return request.patch(`/lc/projects/${id}`, dto);
}

/**
 * Delete a project by ID (soft delete).
 */
export async function deleteProject(id: string): Promise<void> {
  return request.delete(`/lc/projects/${id}`);
}

/**
 * Batch delete projects by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteProjects(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/projects/batch', { data: { ids } });
}

/**
 * Get project-tasks options for select dropdown.
 */
export async function getProjectTaskOptions(): Promise<ProjectTaskOption[]> {
  const res = await request.get('/lc/project-tasks', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

