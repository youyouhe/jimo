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
import { PolicyDetailService } from './policy-detail.service';
import { CreatePolicyDetailDto } from './dto/create-policy-detail.dto';
import { UpdatePolicyDetailDto } from './dto/update-policy-detail.dto';
import { QueryPolicyDetailDto } from './dto/query-policy-detail.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { PolicyDetails } from '../../db/schema/policy-details';

@ApiTags('lc/policy-details')
@ApiBearerAuth()
@Controller('lc/policy-details')
export class PolicyDetailController {
  constructor(private readonly policyDetailService: PolicyDetailService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of policy-details' })
  @ApiResponse({ status: 200, description: 'Returns paginated policy-details' })
  async findAll(@Query() query: QueryPolicyDetailDto): Promise<PaginatedResponse<PolicyDetails>> {
    const data = await this.policyDetailService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get policy-detail by id' })
  @ApiResponse({ status: 200, description: 'Returns the policy-detail' })
  @ApiResponse({ status: 404, description: 'PolicyDetail not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<PolicyDetails>> {
    const data = await this.policyDetailService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new policy-detail' })
  @ApiResponse({ status: 201, description: 'PolicyDetail created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreatePolicyDetailDto): Promise<ApiResp<PolicyDetails>> {
    const data = await this.policyDetailService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update policy-detail by id' })
  @ApiResponse({ status: 200, description: 'PolicyDetail updated successfully' })
  @ApiResponse({ status: 404, description: 'PolicyDetail not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePolicyDetailDto,
  ): Promise<ApiResp<PolicyDetails>> {
    const data = await this.policyDetailService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete policy-details by ids' })
  @ApiResponse({ status: 200, description: 'PolicyDetails deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.policyDetailService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete policy-detail by id' })
  @ApiResponse({ status: 200, description: 'PolicyDetail deleted successfully' })
  @ApiResponse({ status: 404, description: 'PolicyDetail not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.policyDetailService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
