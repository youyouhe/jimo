import request from './request';

export interface EmployeeRow {
  id: string;
  employeeNo: string;
  name: string;
  departmentId: string | null;
  position: string | null;
  phone: string | null;
  email: string | null;
  status: number;
  entryDate: string | null;
  leaveDate: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  departmentName: string | null;
}

export interface EmployeeOption {
  id: string;
  name: string;
  employeeNo: string;
}

export interface EmployeeListParams {
  page?: number;
  pageSize?: number;
  keyword?: string;
  departmentId?: string;
  status?: number;
}

export interface EmployeeListResult {
  list: EmployeeRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateEmployeeDto {
  employeeNo: string;
  name: string;
  departmentId?: string;
  position?: string;
  phone?: string;
  email?: string;
  status?: number;
  entryDate?: string;
  leaveDate?: string;
}

export interface UpdateEmployeeDto {
  employeeNo?: string;
  name?: string;
  departmentId?: string;
  position?: string;
  phone?: string;
  email?: string;
  status?: number;
  entryDate?: string;
  leaveDate?: string;
}

export async function getEmployeesList(params?: EmployeeListParams): Promise<EmployeeListResult> {
  return request.get('/system/employees', { params });
}

export async function getEmployeeOptions(keyword?: string): Promise<EmployeeOption[]> {
  return request.get('/system/employees/options', { params: { keyword } });
}

export async function createEmployee(dto: CreateEmployeeDto): Promise<EmployeeRow> {
  return request.post('/system/employees', dto);
}

export async function updateEmployee(id: string, dto: UpdateEmployeeDto): Promise<EmployeeRow> {
  return request.patch(`/system/employees/${id}`, dto);
}

export async function deleteEmployee(id: string): Promise<void> {
  return request.delete(`/system/employees/${id}`);
}
