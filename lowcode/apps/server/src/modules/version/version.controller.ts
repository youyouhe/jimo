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
  UseInterceptors,
  UploadedFile,
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
import { VersionService } from './version.service';
import { CreateVersionDto } from './dto/create-version.dto';
import { UpdateVersionDto } from './dto/update-version.dto';
import { QueryVersionDto } from './dto/query-version.dto';
import { BatchDeleteVersionDto } from './dto/batch-delete-version.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { SysVersion } from '../../db/schema/versions';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('versions')
@ApiBearerAuth()
@Controller('versions')
export class VersionController {
  constructor(private readonly versionService: VersionService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of versions' })
  @ApiResponse({ status: 200, description: 'Returns paginated versions' })
  async findAll(@Query() query: QueryVersionDto): Promise<PaginatedResponse<SysVersion>> {
    const data = await this.versionService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get version by id' })
  @ApiResponse({ status: 200, description: 'Returns the version' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysVersion>> {
    const data = await this.versionService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new version' })
  @ApiResponse({ status: 201, description: 'Version created successfully' })
  @ApiResponse({ status: 409, description: 'Version number already exists' })
  async create(@Body() dto: CreateVersionDto): Promise<ApiResp<SysVersion>> {
    const data = await this.versionService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update version by id' })
  @ApiResponse({ status: 200, description: 'Version updated successfully' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVersionDto,
  ): Promise<ApiResp<SysVersion>> {
    const data = await this.versionService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete versions by ids' })
  @ApiResponse({ status: 200, description: 'Versions deleted successfully' })
  async batchRemove(
    @Body() dto: BatchDeleteVersionDto,
  ): Promise<ApiResp<{ count: number }>> {
    const data = await this.versionService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete version by id' })
  @ApiResponse({ status: 200, description: 'Version deleted successfully' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.versionService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }

  @Get(':id/export')
  @ApiOperation({ summary: 'Export version as JSON file' })
  @ApiResponse({ status: 200, description: 'Version exported as JSON download' })
  @ApiResponse({ status: 404, description: 'Version not found' })
  async exportVersion(
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const data = await this.versionService.exportVersion(id);
    const jsonStr = JSON.stringify(data, null, 2);
    const filename = `version-${(data as any).versionNumber || id}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(jsonStr);
  }

  @Post('import')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Import version from JSON file' })
  @ApiConsumes('multipart/form-data')
  @ApiResponse({ status: 201, description: 'Version imported successfully' })
  @ApiResponse({ status: 400, description: 'Invalid JSON file' })
  @UseInterceptors(FileInterceptor('file'))
  async importVersion(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<ApiResp<SysVersion>> {
    let data: Record<string, any>;
    try {
      data = JSON.parse(file.buffer.toString('utf-8'));
    } catch {
      throw new Error('Invalid JSON file format');
    }
    const result = await this.versionService.importVersion(data);
    return { code: 0, msg: 'success', data: result };
  }
}
