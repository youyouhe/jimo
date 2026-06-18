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
import { DictionaryDetailService, DetailTreeNode } from './dictionary-detail.service';
import { CreateDetailDto } from './dto/create-detail.dto';
import { UpdateDetailDto } from './dto/update-detail.dto';
import { QueryDetailDto } from './dto/query-detail.dto';
import { ApiResponse as ApiResp, PaginatedResponse } from '@jimo/shared';
import { SysDictionaryDetail } from '../../db/schema/dictionary-details';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('dictionary-details')
@ApiBearerAuth()
@Controller('dictionary-details')
export class DictionaryDetailController {
  constructor(
    private readonly dictionaryDetailService: DictionaryDetailService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new dictionary detail' })
  @ApiResponse({ status: 201, description: 'Detail created successfully' })
  async create(
    @Body() dto: CreateDetailDto,
  ): Promise<ApiResp<SysDictionaryDetail>> {
    const data = await this.dictionaryDetailService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of dictionary details' })
  @ApiResponse({ status: 200, description: 'Returns paginated details, optionally filtered by dict_id' })
  async findAll(
    @Query() query: QueryDetailDto,
  ): Promise<PaginatedResponse<SysDictionaryDetail>> {
    const data = await this.dictionaryDetailService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('by-type/:type')
  @ApiOperation({ summary: 'Get all dictionary details by dictionary type string' })
  @ApiResponse({ status: 200, description: 'Returns details for the given dictionary type, empty array if type not found' })
  async findByType(
    @Param('type') type: string,
  ): Promise<ApiResp<SysDictionaryDetail[]>> {
    const data = await this.dictionaryDetailService.findByDictType(type);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get dictionary detail by id' })
  @ApiResponse({ status: 200, description: 'Returns the detail' })
  @ApiResponse({ status: 404, description: 'Detail not found' })
  async findOne(
    @Param('id') id: string,
  ): Promise<ApiResp<SysDictionaryDetail>> {
    const data = await this.dictionaryDetailService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update dictionary detail by id' })
  @ApiResponse({ status: 200, description: 'Detail updated successfully' })
  @ApiResponse({ status: 400, description: 'Circular reference detected' })
  @ApiResponse({ status: 404, description: 'Detail not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDetailDto,
  ): Promise<ApiResp<SysDictionaryDetail>> {
    const data = await this.dictionaryDetailService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete dictionary detail by id (cascade deletes children)' })
  @ApiResponse({ status: 200, description: 'Detail and children deleted' })
  @ApiResponse({ status: 404, description: 'Detail not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.dictionaryDetailService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
