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
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { SystemService, ServerInfo, CleanupQueueStatus } from './system.service';
import { DatabaseInfoDto } from './dto/database-info.dto';
import { MinioConfigDto, SaveMinioConfigDto } from './dto/minio-config.dto';
import { CreateSystemConfigDto } from './dto/create-system-config.dto';
import { UpdateSystemConfigDto } from './dto/update-system-config.dto';
import { QuerySystemConfigDto } from './dto/query-system-config.dto';
import { BatchDeleteDto } from '../parameter/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { SysSystemConfig } from '../../db/schema/system-configs';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('system')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(private readonly systemService: SystemService) {}

  @Get('server-info')
  @ApiOperation({ summary: 'Get server information (OS/CPU/RAM/Disk)' })
  @ApiResponse({ status: 200, description: 'Returns system metrics' })
  getServerInfo(): ApiResp<ServerInfo> {
    const data = this.systemService.getServerInfo();
    return { code: 0, msg: 'success', data };
  }

  @Get('config')
  @ApiOperation({ summary: 'Get paginated list of system configs' })
  @ApiResponse({ status: 200, description: 'Returns paginated system configs' })
  async findAll(@Query() query: QuerySystemConfigDto): Promise<PaginatedResponse<SysSystemConfig>> {
    const data = await this.systemService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('config/database')
  @ApiOperation({ summary: 'Get database connection info (read-only, no password)' })
  @ApiResponse({ status: 200, description: 'Returns database connection info' })
  getDatabaseInfo(): ApiResp<DatabaseInfoDto> {
    const data = this.systemService.getDatabaseInfo();
    return { code: 0, msg: 'success', data };
  }

  @Get('config/minio')
  @ApiOperation({ summary: 'Get MinIO configuration (secretKey always masked)' })
  @ApiResponse({ status: 200, description: 'Returns current MinIO config' })
  async getMinioConfig(): Promise<ApiResp<MinioConfigDto>> {
    const data = await this.systemService.getMinioConfig();
    return { code: 0, msg: 'success', data };
  }

  @Post('config/minio/save')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Save MinIO configuration and hot-reload the client' })
  @ApiResponse({ status: 200, description: 'MinIO config saved and client reinitialized' })
  async saveMinioConfig(@Body() dto: SaveMinioConfigDto): Promise<ApiResp<null>> {
    await this.systemService.saveMinioConfig(dto);
    return { code: 0, msg: 'success', data: null };
  }

  @Get('config/:id')
  @ApiOperation({ summary: 'Get system config by id' })
  @ApiResponse({ status: 200, description: 'Returns the system config' })
  @ApiResponse({ status: 404, description: 'System config not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysSystemConfig>> {
    const data = await this.systemService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post('config')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new system config' })
  @ApiResponse({ status: 201, description: 'System config created successfully' })
  @ApiResponse({ status: 409, description: 'System config key already exists' })
  async create(@Body() dto: CreateSystemConfigDto): Promise<ApiResp<SysSystemConfig>> {
    const data = await this.systemService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch('config/:id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update system config by id' })
  @ApiResponse({ status: 200, description: 'System config updated successfully' })
  @ApiResponse({ status: 404, description: 'System config not found' })
  @ApiResponse({ status: 409, description: 'System config key already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSystemConfigDto,
  ): Promise<ApiResp<SysSystemConfig>> {
    const data = await this.systemService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('config/batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete system configs by ids' })
  @ApiResponse({ status: 200, description: 'System configs deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.systemService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete('config/:id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete system config by id' })
  @ApiResponse({ status: 200, description: 'System config deleted successfully' })
  @ApiResponse({ status: 404, description: 'System config not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.systemService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }

  @Get('cleanup-queue-status')
  @ApiOperation({ summary: '清理工作队列状态（pending/running/failed/done 计数 + 近期异常job）' })
  async getCleanupQueueStatus(): Promise<ApiResp<CleanupQueueStatus>> {
    const data = await this.systemService.getCleanupQueueStatus();
    return { code: 0, msg: 'success', data };
  }
}
