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
import { PurchaseOrderService } from './purchase-order.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { PurchaseOrders } from '../../db/schema/purchase-orders';

@ApiTags('lc/purchase-orders')
@ApiBearerAuth()
@Controller('lc/purchase-orders')
export class PurchaseOrderController {
  constructor(private readonly purchaseOrderService: PurchaseOrderService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of purchase-orders' })
  @ApiResponse({ status: 200, description: 'Returns paginated purchase-orders' })
  async findAll(@Query() query: QueryPurchaseOrderDto): Promise<PaginatedResponse<PurchaseOrders>> {
    const data = await this.purchaseOrderService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get purchase-order by id' })
  @ApiResponse({ status: 200, description: 'Returns the purchase-order' })
  @ApiResponse({ status: 404, description: 'PurchaseOrder not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<PurchaseOrders>> {
    const data = await this.purchaseOrderService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new purchase-order' })
  @ApiResponse({ status: 201, description: 'PurchaseOrder created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreatePurchaseOrderDto): Promise<ApiResp<PurchaseOrders>> {
    const data = await this.purchaseOrderService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update purchase-order by id' })
  @ApiResponse({ status: 200, description: 'PurchaseOrder updated successfully' })
  @ApiResponse({ status: 404, description: 'PurchaseOrder not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ): Promise<ApiResp<PurchaseOrders>> {
    const data = await this.purchaseOrderService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete purchase-orders by ids' })
  @ApiResponse({ status: 200, description: 'PurchaseOrders deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.purchaseOrderService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete purchase-order by id' })
  @ApiResponse({ status: 200, description: 'PurchaseOrder deleted successfully' })
  @ApiResponse({ status: 404, description: 'PurchaseOrder not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.purchaseOrderService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
