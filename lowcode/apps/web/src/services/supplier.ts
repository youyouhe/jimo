import request from './request';

export interface Supplier {
  id: string;
  name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  is_active: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SupplierListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    contact_person?: string;
    phone?: string;
}

export interface SupplierListResult {
  list: Supplier[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSupplierDto {
    name: string;
    contact_person?: string;
    phone?: string;
    email?: string;
    address?: string;
    is_active: boolean;
}

export interface UpdateSupplierDto {
    name?: string;
    contact_person?: string;
    phone?: string;
    email?: string;
    address?: string;
    is_active?: boolean;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated suppliers list.
 */
export async function getSuppliersList(params?: SupplierListParams): Promise<SupplierListResult> {
  return request.get('/lc/suppliers', { params });
}

/**
 * Get a single supplier by ID.
 */
export async function getSupplier(id: string): Promise<Supplier> {
  return request.get(`/lc/suppliers/${id}`);
}

/**
 * Create a new supplier.
 */
export async function createSupplier(dto: CreateSupplierDto): Promise<Supplier> {
  return request.post('/lc/suppliers', dto);
}

/**
 * Update an existing supplier.
 */
export async function updateSupplier(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
  return request.patch(`/lc/suppliers/${id}`, dto);
}

/**
 * Delete a supplier by ID (soft delete).
 */
export async function deleteSupplier(id: string): Promise<void> {
  return request.delete(`/lc/suppliers/${id}`);
}

/**
 * Batch delete suppliers by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteSuppliers(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/suppliers/batch', { data: { ids } });
}

