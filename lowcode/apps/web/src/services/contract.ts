import request from './request';

export interface ContractDetail {
  id: string;
  name: string | null;
  price: string | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contract {
  id: string;
  name: string | null;
  detail: ContractDetail[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ContractListParams {
  page?: number;
  pageSize?: number;
    name?: string;
    detail?: string[];
}

export interface ContractListResult {
  list: Contract[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateContractDto {
    name?: string;
    detail?: ContractDetail[];
}

export interface UpdateContractDto {
    name?: string;
    detail?: ContractDetail[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated contract list.
 */
export async function getContractList(params?: ContractListParams): Promise<ContractListResult> {
  return request.get('/lc/contract', { params });
}

/**
 * Get a single contract by ID.
 */
export async function getContract(id: string): Promise<Contract> {
  return request.get(`/lc/contract/${id}`);
}

/**
 * Create a new contract.
 */
export async function createContract(dto: CreateContractDto): Promise<Contract> {
  return request.post('/lc/contract', dto);
}

/**
 * Update an existing contract.
 */
export async function updateContract(id: string, dto: UpdateContractDto): Promise<Contract> {
  return request.patch(`/lc/contract/${id}`, dto);
}

/**
 * Delete a contract by ID (soft delete).
 */
export async function deleteContract(id: string): Promise<void> {
  return request.delete(`/lc/contract/${id}`);
}

/**
 * Batch delete contract by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteContract(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/contract/batch', { data: { ids } });
}

