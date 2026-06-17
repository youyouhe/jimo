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
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Suppliers } from '../../db/schema/suppliers';

@ApiTags('lc/suppliers')
@ApiBearerAuth()
@Controller('lc/suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of suppliers' })
  @ApiResponse({ status: 200, description: 'Returns paginated suppliers' })
  async findAll(@Query() query: QuerySupplierDto): Promise<PaginatedResponse<Suppliers>> {
    const data = await this.supplierService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier by id' })
  @ApiResponse({ status: 200, description: 'Returns the supplier' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Suppliers>> {
    const data = await this.supplierService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new supplier' })
  @ApiResponse({ status: 201, description: 'Supplier created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateSupplierDto): Promise<ApiResp<Suppliers>> {
    const data = await this.supplierService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update supplier by id' })
  @ApiResponse({ status: 200, description: 'Supplier updated successfully' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierDto,
  ): Promise<ApiResp<Suppliers>> {
    const data = await this.supplierService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete suppliers by ids' })
  @ApiResponse({ status: 200, description: 'Suppliers deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.supplierService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete supplier by id' })
  @ApiResponse({ status: 200, description: 'Supplier deleted successfully' })
  @ApiResponse({ status: 404, description: 'Supplier not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.supplierService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
