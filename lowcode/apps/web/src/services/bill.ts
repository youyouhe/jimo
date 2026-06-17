import request from './request';

export interface BillBillItem {
  id: string;
  item_name: string;
  quantity: number;
  unit_price: string;
  amount: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Bill {
  id: string;
  bill_no: string;
  bill_name: string;
  bill_date: string;
  amount: string;
  status: string;
  project_id: string;
  project_id_display: string | null;
  remark: string | null;
  bill_items: BillBillItem[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface ProjectOption {
  id: string;
  name: string;
}

export interface BillItemOption {
  id: string;
  name: string;
}

export interface BillListParams {
  page?: number;
  pageSize?: number;
    bill_no?: string;
    bill_name?: string;
    status?: string;
    project_id?: string;
    bill_items?: string[];
}

export interface BillListResult {
  list: Bill[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateBillDto {
    bill_no: string;
    bill_name: string;
    bill_date: string;
    amount: string;
    status: string;
    project_id: string;
    remark?: string;
    bill_items?: BillBillItem[];
}

export interface UpdateBillDto {
    bill_no?: string;
    bill_name?: string;
    bill_date?: string;
    status?: string;
    project_id?: string;
    remark?: string;
    bill_items?: BillBillItem[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated bills list.
 */
export async function getBillsList(params?: BillListParams): Promise<BillListResult> {
  return request.get('/lc/bills', { params });
}

/**
 * Get a single bill by ID.
 */
export async function getBill(id: string): Promise<Bill> {
  return request.get(`/lc/bills/${id}`);
}

/**
 * Create a new bill.
 */
export async function createBill(dto: CreateBillDto): Promise<Bill> {
  return request.post('/lc/bills', dto);
}

/**
 * Update an existing bill.
 */
export async function updateBill(id: string, dto: UpdateBillDto): Promise<Bill> {
  return request.patch(`/lc/bills/${id}`, dto);
}

/**
 * Delete a bill by ID (soft delete).
 */
export async function deleteBill(id: string): Promise<void> {
  return request.delete(`/lc/bills/${id}`);
}

/**
 * Batch delete bills by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteBills(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/bills/batch', { data: { ids } });
}

/**
 * Get projects options for select dropdown.
 */
export async function getProjectOptions(): Promise<ProjectOption[]> {
  const res = await request.get('/lc/projects', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

/**
 * Get bill-items options for select dropdown.
 */
export async function getBillItemOptions(): Promise<BillItemOption[]> {
  const res = await request.get('/lc/bill-items', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

