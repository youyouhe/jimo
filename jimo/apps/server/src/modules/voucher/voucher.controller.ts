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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VoucherService } from './voucher.service';
import { CreateVoucherDto } from './dto/create-voucher.dto';
import { UpdateVoucherDto } from './dto/update-voucher.dto';
import { QueryVoucherDto } from './dto/query-voucher.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { Vouchers } from '../../db/schema/vouchers';

@ApiTags('lc/vouchers')
@ApiBearerAuth()
@Controller('lc/vouchers')
export class VoucherController {
  constructor(private readonly voucherService: VoucherService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of vouchers' })
  @ApiResponse({ status: 200, description: 'Returns paginated vouchers' })
  async findAll(@Query() query: QueryVoucherDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<PaginatedResponse<Vouchers>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.voucherService.findAll(query, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get voucher by id' })
  @ApiResponse({ status: 200, description: 'Returns the voucher' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<Vouchers>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.voucherService.findOne(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new voucher' })
  @ApiResponse({ status: 201, description: 'Voucher created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateVoucherDto, @CurrentUser() user: { sub: string }): Promise<ApiResp<Vouchers>> {
    const data = await this.voucherService.create(dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update voucher by id' })
  @ApiResponse({ status: 200, description: 'Voucher updated successfully' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateVoucherDto,
    @CurrentUser() user: { sub: string; roles: string[] },
  ): Promise<ApiResp<Vouchers>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.voucherService.update(id, dto, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete vouchers by ids' })
  @ApiResponse({ status: 200, description: 'Vouchers deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<{ count: number }>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.voucherService.batchRemove(dto.ids, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete voucher by id' })
  @ApiResponse({ status: 200, description: 'Voucher deleted successfully' })
  @ApiResponse({ status: 404, description: 'Voucher not found' })
  async remove(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<null>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    await this.voucherService.remove(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data: null };
  }
}
