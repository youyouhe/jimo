import request from './request';

export interface Supplier {
  id: string;
  supplier_name: string;
  contact_phone: string | null;
  balance: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SupplierListParams {
  page?: number;
  pageSize?: number;
    supplier_name?: string;
    contact_phone?: string;
}

export interface SupplierListResult {
  list: Supplier[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateSupplierDto {
    supplier_name: string;
    contact_phone?: string;
    balance: string;
}

export interface UpdateSupplierDto {
    supplier_name?: string;
    contact_phone?: string;
    balance?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated suppliers list.
 */
export async function getSuppliers(params?: SupplierListParams): Promise<SupplierListResult> {
  return request.get('/suppliers', { params });
}

/**
 * Get a single supplier by ID.
 */
export async function getSupplier(id: string): Promise<Supplier> {
  return request.get(`/suppliers/${id}`);
}

/**
 * Create a new supplier.
 */
export async function createSupplier(dto: CreateSupplierDto): Promise<Supplier> {
  return request.post('/suppliers', dto);
}

/**
 * Update an existing supplier.
 */
export async function updateSupplier(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
  return request.patch(`/suppliers/${id}`, dto);
}

/**
 * Delete a supplier by ID (soft delete).
 */
export async function deleteSupplier(id: string): Promise<void> {
  return request.delete(`/suppliers/${id}`);
}

/**
 * Batch delete suppliers by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteSuppliers(ids: string[]): Promise<{ count: number }> {
  return request.delete('/suppliers/batch', { data: { ids } });
}
