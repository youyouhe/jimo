import request from '../request';

export interface Reimbursement {
  id: string;
  title: string;
  reimbursement_category: string;
  amount: string;
  description: string;
  attachments: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ReimbursementListParams {
  page?: number;
  pageSize?: number;
    title?: string;
    reimbursement_category?: string;
}

export interface ReimbursementListResult {
  list: Reimbursement[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateReimbursementDto {
    title: string;
    reimbursement_category: string;
    amount: string;
    description: string;
    attachments?: string;
}

export interface UpdateReimbursementDto {
    title?: string;
    reimbursement_category?: string;
    amount?: string;
    description?: string;
    attachments?: string;
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated reimbursements list.
 */
export async function getReimbursementsList(params?: ReimbursementListParams): Promise<ReimbursementListResult> {
  return request.get('/lc/reimbursements', { params });
}

/**
 * Get a single reimbursement by ID.
 */
export async function getReimbursement(id: string): Promise<Reimbursement> {
  return request.get(`/lc/reimbursements/${id}`);
}

/**
 * Create a new reimbursement.
 */
export async function createReimbursement(dto: CreateReimbursementDto): Promise<Reimbursement> {
  return request.post('/lc/reimbursements', dto);
}

/**
 * Update an existing reimbursement.
 */
export async function updateReimbursement(id: string, dto: UpdateReimbursementDto): Promise<Reimbursement> {
  return request.patch(`/lc/reimbursements/${id}`, dto);
}

/**
 * Delete a reimbursement by ID (soft delete).
 */
export async function deleteReimbursement(id: string): Promise<void> {
  return request.delete(`/lc/reimbursements/${id}`);
}

/**
 * Batch delete reimbursements by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteReimbursements(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/reimbursements/batch', { data: { ids } });
}

/**
 * Submit this reimbursement for approval. The chain is resolved dynamically server-side
 * from sys_approval_flows (business_type: 'reimbursements') + the record.
 */
export async function submitReimbursementApproval(id: string, record?: Record<string, any>): Promise<any> {
  return request.post('/approvals/start', { businessType: 'reimbursements', businessId: id, record });
}

