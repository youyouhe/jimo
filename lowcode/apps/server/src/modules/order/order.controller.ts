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
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Order } from '../../db/schema/order';

@ApiTags('lc/order')
@ApiBearerAuth()
@Controller('lc/order')
export class OrderController {
  private readonly logger = new Logger(OrderController.name);
  constructor(private readonly orderService: OrderService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of order' })
  @ApiResponse({ status: 200, description: 'Returns paginated order' })
  async findAll(@Query() query: QueryOrderDto): Promise<PaginatedResponse<Order>> {
    const data = await this.orderService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get order by id' })
  @ApiResponse({ status: 200, description: 'Returns the order' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Order>> {
    const data = await this.orderService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new order' })
  @ApiResponse({ status: 201, description: 'Order created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateOrderDto): Promise<ApiResp<Order>> {
    this.logger.log(`create order: name=${dto.name} price=${dto.price} details=${JSON.stringify(dto.details)} performance=${JSON.stringify(dto.performance)}`);
    const data = await this.orderService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update order by id' })
  @ApiResponse({ status: 200, description: 'Order updated successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrderDto,
  ): Promise<ApiResp<Order>> {
    this.logger.log(`update order: id=${id} name=${dto.name} price=${dto.price} details=${JSON.stringify(dto.details)} performance=${JSON.stringify(dto.performance)}`);
    const data = await this.orderService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete order by ids' })
  @ApiResponse({ status: 200, description: 'Order deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    this.logger.log(`batchRemove order: ids=${dto.ids.join(',')}`);
    const data = await this.orderService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete order by id' })
  @ApiResponse({ status: 200, description: 'Order deleted successfully' })
  @ApiResponse({ status: 404, description: 'Order not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    this.logger.log(`remove order: id=${id}`);
    await this.orderService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
