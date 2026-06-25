import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, DrizzleDb } from '../../../db/connection';
import { VoucherService } from '../voucher.service';
import { AutocodeService } from '../../autocode/autocode.service';

/**
 * Entity agent service for vouchers.
 * Wraps CRUD operations as AI-callable tool definitions.

 */
@Injectable()
export class VoucherAgentService {
  constructor(
    private readonly voucherService: VoucherService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly autocodeService: AutocodeService,
  ) {}

  /**
   * Return AI-callable tool definitions scoped to the given user.
   * Tools are compatible with the Vercel AI SDK streamText() tools parameter.
   */
  getTools(userId: string): Record<string, any> {
    return {
    query_vouchers: {
      description: 'Get a voucher record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        return this.voucherService.findOne(args.id, userId, true);
      },
    },

    create_vouchers: {
      description: 'Create a new voucher record',
      parameters: {
        type: 'object',
        properties: {
        voucher_number: { type: 'string', description: '凭证号' },
        voucher_date: { type: 'string', description: '凭证日期' },
        summary: { type: 'string', description: '凭证摘要' },
        status: { type: 'string', description: '凭证状态' },
        attachment: { type: 'string', description: '附件' },
        },
        required: ['voucher_number', 'voucher_date', 'summary', 'status'],
      },
      execute: async (args: any) => {
        return this.voucherService.create(args, userId);
      },
    },

    update_vouchers: {
      description: 'Update a voucher record',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record UUID' },
        voucher_number: { type: 'string', description: '凭证号' },
        voucher_date: { type: 'string', description: '凭证日期' },
        summary: { type: 'string', description: '凭证摘要' },
        status: { type: 'string', description: '凭证状态' },
        attachment: { type: 'string', description: '附件' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        return this.voucherService.update(args.id, args, userId, true);
      },
    },

    delete_vouchers: {
      description: 'Soft-delete a voucher record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        await this.voucherService.remove(args.id, userId, true);
        return { deleted: args.id };
      },
    },

    search_vouchers: {
      description: 'Search vouchers with filters and pagination',
      parameters: {
        type: 'object',
        properties: {
        page: { type: 'number', description: 'Page number (1-based)' },
        pageSize: { type: 'number', description: 'Items per page' },
        voucher_number: { type: 'string', description: '凭证号' },
        voucher_date: { type: 'string', description: '凭证日期' },
        summary: { type: 'string', description: '凭证摘要' },
        status: { type: 'string', description: '凭证状态' },
        },
      },
      execute: async (args: any) => {
        return this.voucherService.findAll(args, userId, true);
      },
    },

    mock_vouchers: {
      description: 'Generate mock data rows for vouchers',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'Number of mock rows (1-100)' } },
      },
      execute: async (args: { count?: number }) => {
        const result = await this.autocodeService.generateMockForTable('vouchers', args.count ?? 10);
        return { ok: true, inserted: result.inserted };
      },
    },
    };
  }
}
