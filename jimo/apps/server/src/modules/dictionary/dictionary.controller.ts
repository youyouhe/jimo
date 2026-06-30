import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { DictionaryService, DictTreeNode, ExportedDict } from './dictionary.service';
import { DictionarySnapshotService, SnapshotListItem } from './dictionary-snapshot.service';
import { SysDictionarySnapshot } from '../../db/schema/dictionary-snapshots';
import { CreateDictDto } from './dto/create-dict.dto';
import { UpdateDictDto } from './dto/update-dict.dto';
import { QueryDictDto } from './dto/query-dict.dto';
import { BatchDeleteDictDto } from './dto/batch-delete-dict.dto';
import { ApiResponse as ApiResp, PaginatedResponse } from '@jimo/shared';
import { SysDictionary } from '../../db/schema/dictionaries';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('dictionaries')
@ApiBearerAuth()
@Controller('dictionaries')
export class DictionaryController {
  constructor(
    private readonly dictionaryService: DictionaryService,
    private readonly snapshotService: DictionarySnapshotService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new dictionary' })
  @ApiResponse({ status: 201, description: 'Dictionary created successfully' })
  @ApiResponse({ status: 409, description: 'Dictionary type already exists' })
  async create(
    @Body() dto: CreateDictDto,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<SysDictionary>> {
    const data = await this.dictionaryService.create(dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of dictionaries' })
  @ApiResponse({ status: 200, description: 'Returns paginated dictionaries' })
  async findAll(@Query() query: QueryDictDto): Promise<PaginatedResponse<SysDictionary>> {
    const data = await this.dictionaryService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('tree')
  @ApiOperation({ summary: 'Get full dictionary tree' })
  @ApiResponse({ status: 200, description: 'Returns nested dictionary tree' })
  async findTree(): Promise<ApiResp<DictTreeNode[]>> {
    const data = await this.dictionaryService.findTree();
    return { code: 0, msg: 'success', data };
  }

  @Get('export/:id')
  @ApiOperation({ summary: 'Export dictionary with all details as JSON' })
  @ApiResponse({ status: 200, description: 'Returns dictionary export JSON' })
  @ApiResponse({ status: 404, description: 'Dictionary not found' })
  async exportDict(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ApiResp<ExportedDict>> {
    const data = await this.dictionaryService.exportDict(id);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="dictionary-${data.type}.json"`,
    );
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dictionary by id' })
  @ApiResponse({ status: 200, description: 'Returns the dictionary' })
  @ApiResponse({ status: 404, description: 'Dictionary not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysDictionary>> {
    const data = await this.dictionaryService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update dictionary by id' })
  @ApiResponse({ status: 200, description: 'Dictionary updated successfully' })
  @ApiResponse({ status: 400, description: 'Circular reference detected' })
  @ApiResponse({ status: 404, description: 'Dictionary not found' })
  @ApiResponse({ status: 409, description: 'Dictionary type already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDictDto,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<SysDictionary>> {
    const data = await this.dictionaryService.update(id, dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete dictionaries by ids' })
  @ApiResponse({ status: 200, description: 'Dictionaries deleted' })
  async batchRemove(
    @Body() dto: BatchDeleteDictDto,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<{ count: number }>> {
    const data = await this.dictionaryService.removeBatch(dto.ids, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete dictionary by id (cascade deletes details)' })
  @ApiResponse({ status: 200, description: 'Dictionary and its details deleted' })
  @ApiResponse({ status: 404, description: 'Dictionary not found' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<null>> {
    await this.dictionaryService.remove(id, user?.sub);
    return { code: 0, msg: 'success', data: null };
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Import a dictionary with details from JSON' })
  @ApiResponse({ status: 201, description: 'Dictionary imported successfully' })
  @ApiResponse({ status: 400, description: 'Invalid import data' })
  @ApiResponse({ status: 409, description: 'Dictionary type already exists' })
  async importDict(
    @Body() json: Record<string, any>,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<SysDictionary>> {
    const data = await this.dictionaryService.importDict(json, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/versions')
  @ApiOperation({ summary: 'List all snapshot versions for a dictionary' })
  @ApiResponse({ status: 200, description: 'Returns version history list' })
  @ApiResponse({ status: 404, description: 'Dictionary not found' })
  async listVersions(
    @Param('id') id: string,
  ): Promise<ApiResp<SnapshotListItem[]>> {
    await this.dictionaryService.findOne(id); // 404 guard
    const data = await this.snapshotService.listVersions(id);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id/versions/:version')
  @ApiOperation({ summary: 'Get a specific snapshot version' })
  @ApiResponse({ status: 200, description: 'Returns snapshot data' })
  @ApiResponse({ status: 404, description: 'Snapshot not found' })
  async getVersion(
    @Param('id') id: string,
    @Param('version') version: string,
  ): Promise<ApiResp<SysDictionarySnapshot>> {
    const data = await this.snapshotService.getVersion(id, Number(version));
    return { code: 0, msg: 'success', data };
  }

  @Post(':id/restore/:version')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Restore dictionary to a previous snapshot version' })
  @ApiResponse({ status: 200, description: 'Dictionary restored successfully' })
  @ApiResponse({ status: 404, description: 'Snapshot not found' })
  async restoreVersion(
    @Param('id') id: string,
    @Param('version') version: string,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<SysDictionary>> {
    const data = await this.dictionaryService.restoreVersion(id, Number(version), user?.sub);
    return { code: 0, msg: 'success', data };
  }
}
