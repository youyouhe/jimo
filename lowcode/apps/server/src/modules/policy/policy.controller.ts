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
import { PolicyService } from './policy.service';
import { CreatePolicyDto } from './dto/create-policy.dto';
import { UpdatePolicyDto } from './dto/update-policy.dto';
import { QueryPolicyDto } from './dto/query-policy.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Policies } from '../../db/schema/policies';

@ApiTags('lc/policies')
@ApiBearerAuth()
@Controller('lc/policies')
export class PolicyController {
  constructor(private readonly policyService: PolicyService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of policies' })
  @ApiResponse({ status: 200, description: 'Returns paginated policies' })
  async findAll(@Query() query: QueryPolicyDto): Promise<PaginatedResponse<Policies>> {
    const data = await this.policyService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get policy by id' })
  @ApiResponse({ status: 200, description: 'Returns the policy' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Policies>> {
    const data = await this.policyService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new policy' })
  @ApiResponse({ status: 201, description: 'Policy created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreatePolicyDto): Promise<ApiResp<Policies>> {
    const data = await this.policyService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update policy by id' })
  @ApiResponse({ status: 200, description: 'Policy updated successfully' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePolicyDto,
  ): Promise<ApiResp<Policies>> {
    const data = await this.policyService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete policies by ids' })
  @ApiResponse({ status: 200, description: 'Policies deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.policyService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete policy by id' })
  @ApiResponse({ status: 200, description: 'Policy deleted successfully' })
  @ApiResponse({ status: 404, description: 'Policy not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.policyService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
