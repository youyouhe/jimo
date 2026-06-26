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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RegionService } from './region.service';
import { CreateRegionDto } from './dto/create-region.dto';
import { UpdateRegionDto } from './dto/update-region.dto';
import { QueryRegionDto } from './dto/query-region.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { Regions } from '../../db/schema/regions';

@ApiTags('lc/regions')
@ApiBearerAuth()
@Controller('lc/regions')
export class RegionController {
  constructor(private readonly regionService: RegionService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of regions' })
  @ApiResponse({ status: 200, description: 'Returns paginated regions' })
  async findAll(@Query() query: QueryRegionDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<PaginatedResponse<Regions>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.regionService.findAll(query, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get region by id' })
  @ApiResponse({ status: 200, description: 'Returns the region' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<Regions>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.regionService.findOne(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new region' })
  @ApiResponse({ status: 201, description: 'Region created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateRegionDto, @CurrentUser() user: { sub: string }): Promise<ApiResp<Regions>> {
    const data = await this.regionService.create(dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update region by id' })
  @ApiResponse({ status: 200, description: 'Region updated successfully' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRegionDto,
    @CurrentUser() user: { sub: string; roles: string[] },
  ): Promise<ApiResp<Regions>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.regionService.update(id, dto, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete regions by ids' })
  @ApiResponse({ status: 200, description: 'Regions deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<{ count: number }>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.regionService.batchRemove(dto.ids, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete region by id' })
  @ApiResponse({ status: 200, description: 'Region deleted successfully' })
  @ApiResponse({ status: 404, description: 'Region not found' })
  async remove(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<null>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    await this.regionService.remove(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data: null };
  }
}
