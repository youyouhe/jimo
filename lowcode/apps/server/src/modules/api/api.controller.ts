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
import { ApiService } from './api.service';
import { CreateApiDto } from './dto/create-api.dto';
import { UpdateApiDto } from './dto/update-api.dto';
import { QueryApiDto } from './dto/query-api.dto';
import { BatchDeleteApiDto } from './dto/batch-delete-api.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { SysApi } from '../../db/schema/apis';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('apis')
@ApiBearerAuth()
@Controller('apis')
export class ApiController {
  constructor(private readonly apiService: ApiService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of APIs' })
  @ApiResponse({ status: 200, description: 'Returns paginated APIs' })
  async findAll(@Query() query: QueryApiDto): Promise<PaginatedResponse<SysApi>> {
    const data = await this.apiService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('groups')
  @ApiOperation({ summary: 'Get distinct API groups, optionally with counts' })
  @ApiResponse({ status: 200, description: 'Returns distinct api_group values' })
  async getApiGroups(
    @Query('withCount') withCount?: string,
  ): Promise<ApiResp<string[] | { group: string; count: number }[]>> {
    const data = await this.apiService.getApiGroups(withCount === 'true');
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get API by id' })
  @ApiResponse({ status: 200, description: 'Returns the API' })
  @ApiResponse({ status: 404, description: 'API not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysApi>> {
    const data = await this.apiService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new API' })
  @ApiResponse({ status: 201, description: 'API created successfully' })
  @ApiResponse({ status: 409, description: 'API method+path already exists' })
  async create(@Body() dto: CreateApiDto): Promise<ApiResp<SysApi>> {
    const data = await this.apiService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update API by id' })
  @ApiResponse({ status: 200, description: 'API updated successfully' })
  @ApiResponse({ status: 404, description: 'API not found' })
  @ApiResponse({ status: 409, description: 'API method+path already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateApiDto,
  ): Promise<ApiResp<SysApi>> {
    const data = await this.apiService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete APIs by ids' })
  @ApiResponse({ status: 200, description: 'APIs deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteApiDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.apiService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete API by id' })
  @ApiResponse({ status: 200, description: 'API deleted successfully' })
  @ApiResponse({ status: 404, description: 'API not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.apiService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
