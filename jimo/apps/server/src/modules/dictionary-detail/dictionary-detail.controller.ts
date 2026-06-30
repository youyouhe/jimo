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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
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
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<SysDictionaryDetail>> {
    const data = await this.dictionaryDetailService.create(dto, user?.sub);
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

  @Get('tree')
  @ApiOperation({ summary: 'Get dictionary details as a nested tree by dict_id' })
  @ApiResponse({ status: 200, description: 'Returns nested tree of details for the given dict_id' })
  async findTree(
    @Query('dict_id') dictId: string,
  ): Promise<ApiResp<DetailTreeNode[]>> {
    const data = await this.dictionaryDetailService.findTreeByDictId(dictId);
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
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<SysDictionaryDetail>> {
    const data = await this.dictionaryDetailService.update(id, dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete dictionary detail by id (cascade deletes children)' })
  @ApiResponse({ status: 200, description: 'Detail and children deleted' })
  @ApiResponse({ status: 404, description: 'Detail not found' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user?: { sub: string },
  ): Promise<ApiResp<null>> {
    await this.dictionaryDetailService.remove(id, user?.sub);
    return { code: 0, msg: 'success', data: null };
  }
}
