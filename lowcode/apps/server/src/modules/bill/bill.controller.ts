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
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { QueryBillDto } from './dto/query-bill.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Bills } from '../../db/schema/bills';

@ApiTags('lc/bills')
@ApiBearerAuth()
@Controller('lc/bills')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of bills' })
  @ApiResponse({ status: 200, description: 'Returns paginated bills' })
  async findAll(@Query() query: QueryBillDto): Promise<PaginatedResponse<Bills>> {
    const data = await this.billService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get bill by id' })
  @ApiResponse({ status: 200, description: 'Returns the bill' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Bills>> {
    const data = await this.billService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new bill' })
  @ApiResponse({ status: 201, description: 'Bill created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateBillDto): Promise<ApiResp<Bills>> {
    const data = await this.billService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update bill by id' })
  @ApiResponse({ status: 200, description: 'Bill updated successfully' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBillDto,
  ): Promise<ApiResp<Bills>> {
    const data = await this.billService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete bills by ids' })
  @ApiResponse({ status: 200, description: 'Bills deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.billService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete bill by id' })
  @ApiResponse({ status: 200, description: 'Bill deleted successfully' })
  @ApiResponse({ status: 404, description: 'Bill not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.billService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
