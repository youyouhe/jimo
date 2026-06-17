import request from './request';

export interface StudentClub {
  id: string;
  student_id: string;
  student_id_display: string | null;
  club_id: string;
  club_id_display: string | null;
  join_date: string;
  role: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StudentOption {
  id: string;
  name: string;
}

export interface ClubOption {
  id: string;
  name: string;
}

export interface StudentClubListParams {
  page?: number;
  pageSize?: number;
    student_id?: string;
    club_id?: string;
}

export interface StudentClubListResult {
  list: StudentClub[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStudentClubDto {
    student_id: string;
    club_id: string;
    join_date: string;
    role?: string;
}

export interface UpdateStudentClubDto {
    student_id?: string;
    club_id?: string;
    join_date?: string;
    role?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated student-clubs list.
 */
export async function getStudentClubsList(params?: StudentClubListParams): Promise<StudentClubListResult> {
  return request.get('/lc/student-clubs', { params });
}

/**
 * Get a single student-club by ID.
 */
export async function getStudentClub(id: string): Promise<StudentClub> {
  return request.get(`/lc/student-clubs/${id}`);
}

/**
 * Create a new student-club.
 */
export async function createStudentClub(dto: CreateStudentClubDto): Promise<StudentClub> {
  return request.post('/lc/student-clubs', dto);
}

/**
 * Update an existing student-club.
 */
export async function updateStudentClub(id: string, dto: UpdateStudentClubDto): Promise<StudentClub> {
  return request.patch(`/lc/student-clubs/${id}`, dto);
}

/**
 * Delete a student-club by ID (soft delete).
 */
export async function deleteStudentClub(id: string): Promise<void> {
  return request.delete(`/lc/student-clubs/${id}`);
}

/**
 * Batch delete student-clubs by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteStudentClubs(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/student-clubs/batch', { data: { ids } });
}

/**
 * Get students options for select dropdown.
 */
export async function getStudentOptions(): Promise<StudentOption[]> {
  const res = await request.get('/lc/students', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

/**
 * Get clubs options for select dropdown.
 */
export async function getClubOptions(): Promise<ClubOption[]> {
  const res = await request.get('/lc/clubs', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

