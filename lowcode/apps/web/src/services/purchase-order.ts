import request from './request';

export interface PurchaseOrderItem {
  id: string;
  material_name: string;
  specification: string | null;
  quantity: number;
  unit_price: string;
  amount: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrder {
  id: string;
  order_no: string;
  supplier_id: string;
  supplier_id_display: string | null;
  order_date: string;
  status: string;
  total_amount: string | null;
  remark: string | null;
  items: PurchaseOrderItem[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface SupplierOption {
  id: string;
  name: string;
}

export interface PurchaseOrderListParams {
  page?: number;
  pageSize?: number;
    order_no?: string;
    supplier_id?: string;
    status?: string;
}

export interface PurchaseOrderListResult {
  list: PurchaseOrder[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreatePurchaseOrderDto {
    order_no: string;
    supplier_id: string;
    order_date: string;
    status: string;
    remark?: string;
    items?: PurchaseOrderItem[];
}

export interface UpdatePurchaseOrderDto {
    supplier_id?: string;
    order_date?: string;
    status?: string;
    remark?: string;
    items?: PurchaseOrderItem[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated purchase-orders list.
 */
export async function getPurchaseOrdersList(params?: PurchaseOrderListParams): Promise<PurchaseOrderListResult> {
  return request.get('/lc/purchase-orders', { params });
}

/**
 * Get a single purchase-order by ID.
 */
export async function getPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return request.get(`/lc/purchase-orders/${id}`);
}

/**
 * Create a new purchase-order.
 */
export async function createPurchaseOrder(dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
  return request.post('/lc/purchase-orders', dto);
}

/**
 * Update an existing purchase-order.
 */
export async function updatePurchaseOrder(id: string, dto: UpdatePurchaseOrderDto): Promise<PurchaseOrder> {
  return request.patch(`/lc/purchase-orders/${id}`, dto);
}

/**
 * Delete a purchase-order by ID (soft delete).
 */
export async function deletePurchaseOrder(id: string): Promise<void> {
  return request.delete(`/lc/purchase-orders/${id}`);
}

/**
 * Batch delete purchase-orders by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeletePurchaseOrders(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/purchase-orders/batch', { data: { ids } });
}

/**
 * Get suppliers options for select dropdown.
 */
export async function getSupplierOptions(): Promise<SupplierOption[]> {
  const res = await request.get('/lc/suppliers', { params: { pageSize: 100 } });
  return res.list || res.data || [];
}

