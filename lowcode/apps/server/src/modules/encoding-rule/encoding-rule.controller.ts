import {
  Controller,
  Get,
  Post,
  Put,
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
import { EncodingRuleService } from './encoding-rule.service.js';
import { CreateEncodingRuleDto } from './dto/create-encoding-rule.dto.js';
import { UpdateEncodingRuleDto } from './dto/update-encoding-rule.dto.js';
import { QueryEncodingRuleDto } from './dto/query-encoding-rule.dto.js';
import { ApiResponse as ApiResp, PaginatedResponse } from '@lowcode/shared';
import { SysEncodingRule } from '../../db/schema/encoding-rules.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../../db/schema/users.js';

@ApiTags('encoding-rules')
@ApiBearerAuth()
@Controller('encoding-rules')
export class EncodingRuleController {
  constructor(private readonly encodingRuleService: EncodingRuleService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new encoding rule' })
  @ApiResponse({ status: 201, description: 'Encoding rule created successfully' })
  @ApiResponse({ status: 409, description: 'Encoding rule name already exists' })
  async create(@Body() dto: CreateEncodingRuleDto): Promise<ApiResp<SysEncodingRule>> {
    const data = await this.encodingRuleService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Get()
  @ApiOperation({ summary: 'Get paginated list of encoding rules' })
  @ApiResponse({ status: 200, description: 'Returns paginated encoding rules' })
  async findAll(@Query() query: QueryEncodingRuleDto): Promise<PaginatedResponse<SysEncodingRule>> {
    const data = await this.encodingRuleService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get encoding rule by id' })
  @ApiResponse({ status: 200, description: 'Returns the encoding rule' })
  @ApiResponse({ status: 404, description: 'Encoding rule not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysEncodingRule>> {
    const data = await this.encodingRuleService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Put(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update encoding rule by id' })
  @ApiResponse({ status: 200, description: 'Encoding rule updated successfully' })
  @ApiResponse({ status: 404, description: 'Encoding rule not found' })
  @ApiResponse({ status: 409, description: 'Encoding rule name already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateEncodingRuleDto,
  ): Promise<ApiResp<SysEncodingRule>> {
    const data = await this.encodingRuleService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete encoding rule by id' })
  @ApiResponse({ status: 200, description: 'Encoding rule deleted' })
  @ApiResponse({ status: 404, description: 'Encoding rule not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.encodingRuleService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
