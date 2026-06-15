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
  UseInterceptors,
  UploadedFile,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ExportTemplateService } from './export-template.service';
import { CreateExportTemplateDto } from './dto/create-export-template.dto';
import { UpdateExportTemplateDto } from './dto/update-export-template.dto';
import { QueryExportTemplateDto } from './dto/query-export-template.dto';
import { BatchDeleteExportTemplateDto } from './dto/batch-delete-export-template.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { SysExportTemplate } from '../../db/schema/export-templates';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('export-templates')
@ApiBearerAuth()
@Controller('export-templates')
export class ExportTemplateController {
  constructor(private readonly exportTemplateService: ExportTemplateService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of export templates' })
  @ApiResponse({ status: 200, description: 'Returns paginated export templates' })
  async findAll(@Query() query: QueryExportTemplateDto): Promise<PaginatedResponse<SysExportTemplate>> {
    const data = await this.exportTemplateService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get export template by id' })
  @ApiResponse({ status: 200, description: 'Returns the export template' })
  @ApiResponse({ status: 404, description: 'Export template not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysExportTemplate>> {
    const data = await this.exportTemplateService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new export template' })
  @ApiResponse({ status: 201, description: 'Export template created successfully' })
  @ApiResponse({ status: 409, description: 'Template name already exists' })
  async create(@Body() dto: CreateExportTemplateDto): Promise<ApiResp<SysExportTemplate>> {
    const data = await this.exportTemplateService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update export template by id' })
  @ApiResponse({ status: 200, description: 'Export template updated successfully' })
  @ApiResponse({ status: 404, description: 'Export template not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateExportTemplateDto,
  ): Promise<ApiResp<SysExportTemplate>> {
    const data = await this.exportTemplateService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete export templates by ids' })
  @ApiResponse({ status: 200, description: 'Export templates deleted successfully' })
  async batchRemove(
    @Body() dto: BatchDeleteExportTemplateDto,
  ): Promise<ApiResp<{ count: number }>> {
    const data = await this.exportTemplateService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete export template by id' })
  @ApiResponse({ status: 200, description: 'Export template deleted successfully' })
  @ApiResponse({ status: 404, description: 'Export template not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.exportTemplateService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }

  @Get(':id/preview-sql')
  @ApiOperation({ summary: 'Preview generated SQL for export template' })
  @ApiResponse({ status: 200, description: 'Returns the preview SQL' })
  @ApiResponse({ status: 404, description: 'Export template not found' })
  async previewSql(
    @Param('id') id: string,
  ): Promise<ApiResp<{ sql: string; tableName: string }>> {
    const data = await this.exportTemplateService.previewSql(id);
    return { code: 0, msg: 'success', data };
  }

  @Post(':id/export')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Export data using template' })
  @ApiResponse({ status: 200, description: 'Returns exported data' })
  @ApiResponse({ status: 404, description: 'Export template not found' })
  async exportData(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.exportTemplateService.exportData(id);
    const jsonStr = JSON.stringify(result.data, null, 2);
    const filename = `${result.templateName}-export.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(jsonStr);
  }

  @Post('import')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Import data from file' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 200, description: 'Data imported successfully' })
  @UseInterceptors(FileInterceptor('file'))
  async importData(
    @UploadedFile() file: Express.Multer.File,
    @Body('templateId') templateId?: string,
  ): Promise<ApiResp<{ imported: number; tableName: string }>> {
    const data = await this.exportTemplateService.importData(file, templateId);
    return { code: 0, msg: 'success', data };
  }
}
