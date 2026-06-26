import { Injectable, Inject } from '@nestjs/common';
import { DATABASE_CONNECTION, DrizzleDb } from '../../../db/connection';
import { RegionService } from '../region.service';
import { AutocodeService } from '../../autocode/autocode.service';

/**
 * Entity agent service for regions.
 * Wraps CRUD operations as AI-callable tool definitions.

 */
@Injectable()
export class RegionAgentService {
  constructor(
    private readonly regionService: RegionService,
    @Inject(DATABASE_CONNECTION) private readonly db: DrizzleDb,
    private readonly autocodeService: AutocodeService,
  ) {}

  /**
   * Return AI-callable tool definitions scoped to the given user.
   * Tools are compatible with the Vercel AI SDK streamText() tools parameter.
   */
  getTools(userId: string): Record<string, any> {
    return {
    query_regions: {
      description: 'Get a region record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        return this.regionService.findOne(args.id, userId, true);
      },
    },

    create_regions: {
      description: 'Create a new region record',
      parameters: {
        type: 'object',
        properties: {
        name: { type: 'string', description: '地区名称' },
        code: { type: 'string', description: '地区编码（如行政区划代码）' },
        parent_id: { type: 'string', description: '上级地区' },
        level: { type: 'string', description: '层级（国家/省/市/区县）' },
        remark: { type: 'string', description: '备注' },
        },
        required: ['name'],
      },
      execute: async (args: any) => {
        return this.regionService.create(args, userId);
      },
    },

    update_regions: {
      description: 'Update a region record',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Record UUID' },
        name: { type: 'string', description: '地区名称' },
        code: { type: 'string', description: '地区编码（如行政区划代码）' },
        parent_id: { type: 'string', description: '上级地区' },
        level: { type: 'string', description: '层级（国家/省/市/区县）' },
        remark: { type: 'string', description: '备注' },
        },
        required: ['id'],
      },
      execute: async (args: any) => {
        return this.regionService.update(args.id, args, userId, true);
      },
    },

    delete_regions: {
      description: 'Soft-delete a region record by ID',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Record UUID' } },
        required: ['id'],
      },
      execute: async (args: { id: string }) => {
        await this.regionService.remove(args.id, userId, true);
        return { deleted: args.id };
      },
    },

    search_regions: {
      description: 'Search regions with filters and pagination',
      parameters: {
        type: 'object',
        properties: {
        page: { type: 'number', description: 'Page number (1-based)' },
        pageSize: { type: 'number', description: 'Items per page' },
        name: { type: 'string', description: '地区名称' },
        code: { type: 'string', description: '地区编码（如行政区划代码）' },
        level: { type: 'string', description: '层级（国家/省/市/区县）' },
        },
      },
      execute: async (args: any) => {
        return this.regionService.findAll(args, userId, true);
      },
    },

    mock_regions: {
      description: 'Generate mock data rows for regions',
      parameters: {
        type: 'object',
        properties: { count: { type: 'number', description: 'Number of mock rows (1-100)' } },
      },
      execute: async (args: { count?: number }) => {
        const result = await this.autocodeService.generateMockForTable('regions', args.count ?? 10);
        return { ok: true, inserted: result.inserted };
      },
    },
    };
  }
}
