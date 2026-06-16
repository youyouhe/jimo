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
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { AutocodeService, type GenerateJobStatus } from './autocode.service';
import { AutoCodeDto } from './dto/autocode.dto';
import { UpdateModuleDto } from './dto/update-module.dto';
import { CreatePackageDto, UpdatePackageDto, SaveFromConfigDto } from './dto/package.dto';
import type { ErGraph } from './er-graph.util';
import { ApiResponse as ApiResp, PaginatedResponse } from '@lowcode/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';
import { SysAutoCodeHistory } from '../../db/schema/auto-code-histories';
import { SysAutoCodePackage } from '../../db/schema/auto-code-packages';

@ApiTags('autocode')
@ApiBearerAuth()
@Controller('autocode')
export class AutocodeController {
  constructor(private readonly autocodeService: AutocodeService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Preview generated code without writing to disk' })
  @ApiResponse({ status: 200, description: 'Returns map of filepath to generated content' })
  @ApiResponse({ status: 400, description: 'Invalid table definition' })
  async preview(@Body() dto: AutoCodeDto): Promise<ApiResp<Record<string, string>>> {
    const data = this.autocodeService.preview(dto);
    return { code: 0, msg: 'success', data };
  }

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Start async code generation (returns jobId for progress tracking)' })
  @ApiResponse({ status: 200, description: 'Returns jobId for polling progress' })
  @ApiResponse({ status: 400, description: 'Invalid table definition' })
  async generate(@Body() dto: AutoCodeDto): Promise<ApiResp<{ jobId: string }>> {
    const jobId = await this.autocodeService.startGenerate(dto);
    return { code: 0, msg: 'success', data: { jobId } };
  }

  @Get('generate-status/:jobId')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Poll generation job status (survives backend restart)' })
  @ApiResponse({ status: 200, description: 'Returns current job status with step details' })
  async getGenerateStatus(@Param('jobId') jobId: string): Promise<ApiResp<GenerateJobStatus>> {
    const data = await this.autocodeService.getJobStatus(jobId);
    if (!data) {
      throw new NotFoundException(`Job ${jobId} not found (may have expired)`);
    }
    return { code: 0, msg: 'success', data };
  }

  @Get('templates')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get available field types and template metadata' })
  @ApiResponse({ status: 200, description: 'Returns template metadata' })
  async getTemplates(): Promise<ApiResp<Record<string, unknown>>> {
    const data = this.autocodeService.getTemplates();
    return { code: 0, msg: 'success', data };
  }

  @Get('tables')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get list of user tables in the database' })
  @ApiResponse({ status: 200, description: 'Returns table names' })
  async getTables(): Promise<ApiResp<string[]>> {
    const data = await this.autocodeService.getTables();
    return { code: 0, msg: 'success', data };
  }

  @Get('impact/:tableName')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Analyze impact of deleting a generated module' })
  @ApiQuery({ name: 'cascade', required: false, type: Boolean, description: 'Recursively analyze FK cascade chain' })
  @ApiResponse({ status: 200, description: 'Returns impact analysis' })
  async analyzeImpact(
    @Param('tableName') tableName: string,
    @Query('cascade') cascade?: string,
  ) {
    const data = await this.autocodeService.analyzeImpact(tableName, cascade === 'true');
    return { code: 0, msg: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // History endpoints
  // ---------------------------------------------------------------------------

  @Get('history')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of code generation history' })
  @ApiResponse({ status: 200, description: 'Returns paginated history records' })
  async getHistory(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('tableName') tableName?: string,
  ): Promise<PaginatedResponse<SysAutoCodeHistory>> {
    const data = await this.autocodeService.findAllHistory({ page, pageSize, tableName });
    return { code: 0, msg: 'success', data };
  }

  @Get('history/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get a single history record by id' })
  @ApiResponse({ status: 200, description: 'Returns the history record' })
  @ApiResponse({ status: 404, description: 'History record not found' })
  async getHistoryDetail(@Param('id') id: string): Promise<ApiResp<SysAutoCodeHistory>> {
    const data = await this.autocodeService.findOneHistory(id);
    return { code: 0, msg: 'success', data };
  }

  @Post('history/:id/rollback')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Rollback to a previous generation snapshot' })
  @ApiResponse({ status: 200, description: 'Files restored from history' })
  @ApiResponse({ status: 404, description: 'History record not found' })
  async rollbackHistory(@Param('id') id: string): Promise<ApiResp<{ restoredFiles: string[] }>> {
    const data = await this.autocodeService.rollbackHistory(id);
    return { code: 0, msg: 'success', data };
  }

  @Delete('history/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Start async deletion of a history record and all generated artifacts' })
  @ApiQuery({ name: 'cascade', required: false, type: Boolean, description: 'Also drop tables that reference this table via FK constraints' })
  @ApiResponse({ status: 200, description: 'Returns jobId for polling delete progress' })
  @ApiResponse({ status: 404, description: 'History record not found' })
  async deleteHistory(
    @Param('id') id: string,
    @Query('cascade') cascade?: string,
  ): Promise<ApiResp<{ jobId: string }>> {
    const jobId = await this.autocodeService.startDeleteHistory(id, cascade === 'true');
    return { code: 0, msg: 'success', data: { jobId } };
  }

  @Get('delete-status/:jobId')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Poll deletion job status' })
  async getDeleteStatus(@Param('jobId') jobId: string): Promise<ApiResp<GenerateJobStatus>> {
    const data = await this.autocodeService.getJobStatus(jobId);
    if (!data) {
      throw new NotFoundException(`Job ${jobId} not found (may have expired)`);
    }
    return { code: 0, msg: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // Version & Update endpoints
  // ---------------------------------------------------------------------------

  @Get('latest-version/:tableName')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get the latest version record for a table' })
  @ApiResponse({ status: 200, description: 'Returns latest version with field definitions' })
  @ApiResponse({ status: 404, description: 'No version found for this table' })
  async getLatestVersion(@Param('tableName') tableName: string): Promise<ApiResp<SysAutoCodeHistory>> {
    const data = await this.autocodeService.getLatestVersion(tableName);
    if (!data) {
      throw new NotFoundException(`No version found for table '${tableName}'`);
    }
    return { code: 0, msg: 'success', data };
  }

  @Get('history-versions/:tableName')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get all version records for a table' })
  @ApiResponse({ status: 200, description: 'Returns all versions ordered by version desc' })
  async getHistoryVersions(@Param('tableName') tableName: string): Promise<ApiResp<SysAutoCodeHistory[]>> {
    const data = await this.autocodeService.getHistoryVersions(tableName);
    return { code: 0, msg: 'success', data };
  }

  @Post('update')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Start async module update (returns jobId for progress tracking)' })
  @ApiResponse({ status: 200, description: 'Returns jobId for polling progress' })
  @ApiResponse({ status: 404, description: 'No existing version for this table' })
  async startUpdate(@Body() dto: UpdateModuleDto): Promise<ApiResp<{ jobId: string }>> {
    const jobId = await this.autocodeService.startUpdate(dto);
    return { code: 0, msg: 'success', data: { jobId } };
  }

  @Get('update-status/:jobId')
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Poll update job status' })
  async getUpdateStatus(@Param('jobId') jobId: string): Promise<ApiResp<GenerateJobStatus>> {
    const data = await this.autocodeService.getJobStatus(jobId);
    if (!data) {
      throw new NotFoundException(`Job ${jobId} not found (may have expired)`);
    }
    return { code: 0, msg: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // ER Graph endpoint
  // ---------------------------------------------------------------------------

  @Get('er-graph')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get ER graph of all generated entities and their relations' })
  @ApiQuery({ name: 'packageId', required: false, type: String, description: 'Filter entities by package ID' })
  @ApiResponse({ status: 200, description: 'Returns { nodes: ErGraphNode[], edges: ErGraphEdge[] }' })
  async getErGraph(@Query('packageId') packageId?: string): Promise<ApiResp<ErGraph>> {
    const data = await this.autocodeService.getErGraph(packageId);
    return { code: 0, msg: 'success', data };
  }

  // ---------------------------------------------------------------------------
  // Package template endpoints
  // ---------------------------------------------------------------------------

  @Get('packages')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of template packages' })
  @ApiResponse({ status: 200, description: 'Returns paginated packages' })
  async getPackages(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('name') name?: string,
  ): Promise<PaginatedResponse<SysAutoCodePackage>> {
    const data = await this.autocodeService.findAllPackages({ page, pageSize, name });
    return { code: 0, msg: 'success', data };
  }

  @Get('packages/list')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'List all packages (lightweight, no pagination) for dropdowns' })
  async listAllPackages(): Promise<ApiResp<Array<{ id: string; name: string; tableName: string; description: string }>>> {
    const data = await this.autocodeService.listAllPackages();
    return { code: 0, msg: 'success', data };
  }

  @Post('packages')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new template package' })
  @ApiResponse({ status: 201, description: 'Package created' })
  async createPackage(
    @Body() dto: CreatePackageDto,
  ): Promise<ApiResp<SysAutoCodePackage>> {
    const data = await this.autocodeService.createPackage(dto);
    return { code: 0, msg: 'success', data };
  }

  @Post('packages/save-from-config')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Save current generator config as a template package with directory menu' })
  @ApiResponse({ status: 201, description: 'Package created with directory menu' })
  async saveFromConfig(
    @Body() dto: SaveFromConfigDto,
  ): Promise<ApiResp<SysAutoCodePackage>> {
    const data = await this.autocodeService.saveFromConfig(dto);
    return { code: 0, msg: 'success', data };
  }

  @Get('packages/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get a single template package by id' })
  @ApiResponse({ status: 200, description: 'Returns the package' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async getPackageDetail(@Param('id') id: string): Promise<ApiResp<SysAutoCodePackage>> {
    const data = await this.autocodeService.findOnePackage(id);
    return { code: 0, msg: 'success', data };
  }

  @Get('packages/:id/config')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get package generation config (for Load from Package)' })
  @ApiResponse({ status: 200, description: 'Returns package config' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async getPackageConfig(@Param('id') id: string): Promise<ApiResp<{
    tableName: string;
    description: string;
    fields: any[];
    generateWeb: boolean;
    name: string;
    menuId: string | null;
  }>> {
    const data = await this.autocodeService.getPackageConfig(id);
    return { code: 0, msg: 'success', data };
  }

  @Patch('packages/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update a template package' })
  @ApiResponse({ status: 200, description: 'Package updated' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async updatePackage(
    @Param('id') id: string,
    @Body() dto: UpdatePackageDto,
  ): Promise<ApiResp<SysAutoCodePackage>> {
    const data = await this.autocodeService.updatePackage(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('packages/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete a template package (soft delete) and its directory menu' })
  @ApiResponse({ status: 200, description: 'Package deleted' })
  @ApiResponse({ status: 404, description: 'Package not found' })
  async deletePackage(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.autocodeService.deletePackage(id);
    return { code: 0, msg: 'success', data: null };
  }
}
