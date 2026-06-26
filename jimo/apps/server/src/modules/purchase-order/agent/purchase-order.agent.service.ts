import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, DrizzleDb } from '../../../db/connection';
import { PurchaseOrderService } from '../purchase-order.service';
import { AutocodeService } from '../../autocode/autocode.service';

/**
 * Entity agent service for purchase-orders.
 * Wraps CRUD operations as AI-callable tool definitions.

 */
@Injectable()
export class PurchaseOrderAgentService {
  constructor(
    private readonly purchaseOrderService: PurchaseOrderService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly autocodeService: AutocodeService,
  ) {}

  /**
   * Return AI-callable tool definitions scoped to the given user.
   * Tools are compatible with the Vercel AI SDK streamText() tools parameter.
   */
  getTools(userId: string): Record<string, any> {
    return {
    query_purchaseOrders: {
      description: 'Get a purchase-order record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        return this.purchaseOrderService.findOne(args.id, userId, true);
      },
    },

    create_purchaseOrders: {
      description: 'Create a new purchase-order record',
      parameters: {
        type: 'object',
        properties: {
        order_no: { type: 'string', description: '订单编号' },
        supplier_id: { type: 'string', description: '供应商' },
        order_date: { type: 'string', description: '订单日期' },
        expected_arrival: { type: 'string', description: '预计到货日期' },
        order_status: { type: 'string', description: '订单状态（业务流转状态，与审批状态无关）' },
        remarks: { type: 'string', description: '备注' },
        },
        required: ['order_no', 'supplier_id', 'order_date', 'order_status'],
      },
      execute: async (args: any) => {
        return this.purchaseOrderService.create(args, userId);
      },
    },

    update_purchaseOrders: {
      description: 'Update a purchase-order record',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record UUID' },
        supplier_id: { type: 'string', description: '供应商' },
        order_date: { type: 'string', description: '订单日期' },
        expected_arrival: { type: 'string', description: '预计到货日期' },
        order_status: { type: 'string', description: '订单状态（业务流转状态，与审批状态无关）' },
        remarks: { type: 'string', description: '备注' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        return this.purchaseOrderService.update(args.id, args, userId, true);
      },
    },

    delete_purchaseOrders: {
      description: 'Soft-delete a purchase-order record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        await this.purchaseOrderService.remove(args.id, userId, true);
        return { deleted: args.id };
      },
    },

    search_purchaseOrders: {
      description: 'Search purchase-orders with filters and pagination',
      parameters: {
        type: 'object',
        properties: {
        page: { type: 'number', description: 'Page number (1-based)' },
        pageSize: { type: 'number', description: 'Items per page' },
        order_no: { type: 'string', description: '订单编号' },
        order_status: { type: 'string', description: '订单状态（业务流转状态，与审批状态无关）' },
        },
      },
      execute: async (args: any) => {
        return this.purchaseOrderService.findAll(args, userId, true);
      },
    },

    mock_purchaseOrders: {
      description: 'Generate mock data rows for purchase-orders',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'Number of mock rows (1-100)' } },
      },
      execute: async (args: { count?: number }) => {
        const result = await this.autocodeService.generateMockForTable('purchase_orders', args.count ?? 10);
        return { ok: true, inserted: result.inserted };
      },
    },
    };
  }
}
