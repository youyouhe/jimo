import request from '../request';

export interface Student {
  id: string;
  student_no: string;
  name: string;
  gender: string | null;
  birth_date: string | null;
  class_name: string | null;
  phone: string | null;
  email: string | null;
  enrollment_status: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface StudentListParams {
  page?: number;
  pageSize?: number;
    student_no?: string;
    name?: string;
    gender?: string;
    class_name?: string;
    enrollment_status?: string;
}

export interface StudentListResult {
  list: Student[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateStudentDto {
    student_no: string;
    name: string;
    gender?: string;
    birth_date?: string;
    class_name?: string;
    phone?: string;
    email?: string;
    enrollment_status?: string;
    address?: string;
}

export interface UpdateStudentDto {
    student_no?: string;
    name?: string;
    gender?: string;
    birth_date?: string;
    class_name?: string;
    phone?: string;
    email?: string;
    enrollment_status?: string;
    address?: string;
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

