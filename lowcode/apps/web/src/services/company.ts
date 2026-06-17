import request from './request';

export interface Company {
  id: string;
  name: string;
  short_name: string | null;
  logo: string | null;
  credit_code: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  established_date: string | null;
  status: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface CompanyListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    short_name?: string;
    credit_code?: string;
    status?: string;
}

export interface CompanyListResult {
  list: Company[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateCompanyDto {
    name: string;
    short_name?: string;
    logo?: string;
    credit_code?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    description?: string;
    established_date?: string;
    status?: string;
}

export interface UpdateCompanyDto {
    name?: string;
    short_name?: string;
    logo?: string;
    credit_code?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    description?: string;
    established_date?: string;
    status?: string;
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

