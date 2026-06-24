import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, DrizzleDb } from '../../../db/connection';
import { AccountService } from '../account.service';
import { AutocodeService } from '../../autocode/autocode.service';

/**
 * Entity agent service for accounts.
 * Wraps CRUD operations as AI-callable tool definitions.

 */
@Injectable()
export class AccountAgentService {
  constructor(
    private readonly accountService: AccountService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly autocodeService: AutocodeService,
  ) {}

  /**
   * Return AI-callable tool definitions scoped to the given user.
   * Tools are compatible with the Vercel AI SDK streamText() tools parameter.
   */
  getTools(userId: string): Record<string, any> {
    return {
    query_accounts: {
      description: 'Get a account record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        return this.accountService.findOne(args.id, userId, true);
      },
    },

    create_accounts: {
      description: 'Create a new account record',
      parameters: {
        type: 'object',
        properties: {
        code: { type: 'string', description: '科目编码，如1001' },
        name: { type: 'string', description: '科目名称' },
        account_type: { type: 'string', description: '科目类型' },
        balance_direction: { type: 'string', description: '余额方向' },
        parent_account: { type: 'string', description: '上级科目' },
        is_active: { type: 'boolean', description: '是否启用' },
        remark: { type: 'string', description: '备注' },
        },
        required: ['code', 'name', 'account_type', 'balance_direction', 'is_active'],
      },
      execute: async (args: any) => {
        return this.accountService.create(args, userId);
      },
    },

    update_accounts: {
      description: 'Update a account record',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record UUID' },
        code: { type: 'string', description: '科目编码，如1001' },
        name: { type: 'string', description: '科目名称' },
        account_type: { type: 'string', description: '科目类型' },
        balance_direction: { type: 'string', description: '余额方向' },
        parent_account: { type: 'string', description: '上级科目' },
        is_active: { type: 'boolean', description: '是否启用' },
        remark: { type: 'string', description: '备注' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        return this.accountService.update(args.id, args, userId, true);
      },
    },

    delete_accounts: {
      description: 'Soft-delete a account record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        await this.accountService.remove(args.id, userId, true);
        return { deleted: args.id };
      },
    },

    search_accounts: {
      description: 'Search accounts with filters and pagination',
      parameters: {
        type: 'object',
        properties: {
        page: { type: 'number', description: 'Page number (1-based)' },
        pageSize: { type: 'number', description: 'Items per page' },
        code: { type: 'string', description: '科目编码，如1001' },
        name: { type: 'string', description: '科目名称' },
        account_type: { type: 'string', description: '科目类型' },
        },
      },
      execute: async (args: any) => {
        return this.accountService.findAll(args, userId, true);
      },
    },

    mock_accounts: {
      description: 'Generate mock data rows for accounts',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'Number of mock rows (1-100)' } },
      },
      execute: async (args: { count?: number }) => {
        const result = await this.autocodeService.generateMockForTable('accounts', args.count ?? 10);
        return { ok: true, inserted: result.inserted };
      },
    },
    };
  }
}
