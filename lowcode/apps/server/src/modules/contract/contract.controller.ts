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
import { ContractService } from './contract.service';
import { CreateContractDto } from './dto/create-contract.dto';
import { UpdateContractDto } from './dto/update-contract.dto';
import { QueryContractDto } from './dto/query-contract.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Contract } from '../../db/schema/contract';

@ApiTags('lc/contract')
@ApiBearerAuth()
@Controller('lc/contract')
export class ContractController {
  constructor(private readonly contractService: ContractService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of contract' })
  @ApiResponse({ status: 200, description: 'Returns paginated contract' })
  async findAll(@Query() query: QueryContractDto): Promise<PaginatedResponse<Contract>> {
    const data = await this.contractService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get contract by id' })
  @ApiResponse({ status: 200, description: 'Returns the contract' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Contract>> {
    const data = await this.contractService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new contract' })
  @ApiResponse({ status: 201, description: 'Contract created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateContractDto): Promise<ApiResp<Contract>> {
    const data = await this.contractService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update contract by id' })
  @ApiResponse({ status: 200, description: 'Contract updated successfully' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateContractDto,
  ): Promise<ApiResp<Contract>> {
    const data = await this.contractService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete contract by ids' })
  @ApiResponse({ status: 200, description: 'Contract deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.contractService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete contract by id' })
  @ApiResponse({ status: 200, description: 'Contract deleted successfully' })
  @ApiResponse({ status: 404, description: 'Contract not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.contractService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
