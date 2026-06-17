import request from './request';

export interface StudentClubs {
  id: string;
  club_id: string;
  join_date: string;
  role: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Student {
  id: string;
  name: string;
  student_no: string;
  gender: string;
  enrollment_year: number;
  club_records: StudentClubs[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StudentClubOption {
  id: string;
  name: string;
}

export interface ClubOption {
  id: string;
  name: string;
}

export interface StudentListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    student_no?: string;
    gender?: string;
    enrollment_yearMin?: string;
    enrollment_yearMax?: string;
    club_records?: string[];
}

export interface StudentListResult {
  list: Student[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStudentDto {
    name: string;
    student_no: string;
    gender: string;
    enrollment_year: number;
    club_records?: StudentClubs[];
}

export interface UpdateStudentDto {
    name?: string;
    gender?: string;
    enrollment_year?: number;
    club_records?: StudentClubs[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated students list.
 */
export async function getStudentsList(params?: StudentListParams): Promise<StudentListResult> {
  return request.get('/lc/students', { params });
}

/**
 * Get a single student by ID.
 */
export async function getStudent(id: string): Promise<Student> {
  return request.get(`/lc/students/${id}`);
}

/**
 * Create a new student.
 */
export async function createStudent(dto: CreateStudentDto): Promise<Student> {
  return request.post('/lc/students', dto);
}

/**
 * Update an existing student.
 */
export async function updateStudent(id: string, dto: UpdateStudentDto): Promise<Student> {
  return request.patch(`/lc/students/${id}`, dto);
}

/**
 * Delete a student by ID (soft delete).
 */
export async function deleteStudent(id: string): Promise<void> {
  return request.delete(`/lc/students/${id}`);
}

/**
 * Batch delete students by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteStudents(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/students/batch', { data: { ids } });
}

/**
 * Get student-clubs options for select dropdown.
 */
export async function getStudentClubOptions(): Promise<StudentClubOption[]> {
  const res = await request.get('/lc/student-clubs', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

/**
 * Get clubs options for select dropdown.
 */
export async function getClubOptions(): Promise<ClubOption[]> {
  const res = await request.get('/lc/clubs', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

