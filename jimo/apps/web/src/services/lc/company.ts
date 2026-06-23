import request from '../request';

export interface Company {
  id: string;
  name: string;
  code: string;
  short_name: string | null;
  status: string | null;
  address: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  description: string | null;
  established_at: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CompanyListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    code?: string;
    short_name?: string;
    status?: string;
    contact_person?: string;
}

export interface CompanyListResult {
  list: Company[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateCompanyDto {
    name: string;
    code: string;
    short_name?: string;
    status?: string;
    address?: string;
    contact_person?: string;
    contact_phone?: string;
    description?: string;
    established_at?: string;
}

export interface UpdateCompanyDto {
    name?: string;
    code?: string;
    short_name?: string;
    status?: string;
    address?: string;
    contact_person?: string;
    contact_phone?: string;
    description?: string;
    established_at?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated companies list.
 */
export async function getCompaniesList(params?: CompanyListParams): Promise<CompanyListResult> {
  return request.get('/lc/companies', { params });
}

/**
 * Get a single company by ID.
 */
export async function getCompany(id: string): Promise<Company> {
  return request.get(`/lc/companies/${id}`);
}

/**
 * Create a new company.
 */
export async function createCompany(dto: CreateCompanyDto): Promise<Company> {
  return request.post('/lc/companies', dto);
}

/**
 * Update an existing company.
 */
export async function updateCompany(id: string, dto: UpdateCompanyDto): Promise<Company> {
  return request.patch(`/lc/companies/${id}`, dto);
}

/**
 * Delete a company by ID (soft delete).
 */
export async function deleteCompany(id: string): Promise<void> {
  return request.delete(`/lc/companies/${id}`);
}

/**
 * Batch delete companies by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteCompanies(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/companies/batch', { data: { ids } });
}

