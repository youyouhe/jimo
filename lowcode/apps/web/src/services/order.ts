import request from './request';

export interface OrderDetail {
  id: string;
  name: string | null;
  number: string | null;
  price: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderPerformance {
  id: string;
  name: string | null;
  time: string | null;
  amount: number | null;
  memo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Order {
  id: string;
  name: string | null;
  price: string | null;
  details: OrderDetail[] | null;
  performance: OrderPerformance[] | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

export interface OrderListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  priceMin?: string;
  priceMax?: string;
}

export interface OrderListResult {
  list: Order[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateOrderDto {
    name?: string;
    price?: string;
    details?: OrderDetail[];
    performance?: OrderPerformance[];
}

export interface UpdateOrderDto {
    name?: string;
    price?: string;
    details?: OrderDetail[];
    performance?: OrderPerformance[];
}

export interface BatchDeleteDto {
  ids: string[];
}

/**
 * Get paginated order list.
 */
export async function getOrderList(params?: OrderListParams): Promise<OrderListResult> {
  return request.get('/lc/order', { params });
}

/**
 * Get a single order by ID.
 */
export async function getOrder(id: string): Promise<Order> {
  return request.get(`/lc/order/${id}`);
}

/**
 * Create a new order.
 */
export async function createOrder(dto: CreateOrderDto): Promise<Order> {
  return request.post('/lc/order', dto);
}

/**
 * Update an existing order.
 */
export async function updateOrder(id: string, dto: UpdateOrderDto): Promise<Order> {
  return request.patch(`/lc/order/${id}`, dto);
}

/**
 * Delete a order by ID (soft delete).
 */
export async function deleteOrder(id: string): Promise<void> {
  return request.delete(`/lc/order/${id}`);
}

/**
 * Batch delete order by IDs (soft delete).
 * Returns { count: number }.
 */
export async function batchDeleteOrder(ids: string[]): Promise<{ count: number }> {
  return request.delete('/lc/order/batch', { data: { ids } });
}

