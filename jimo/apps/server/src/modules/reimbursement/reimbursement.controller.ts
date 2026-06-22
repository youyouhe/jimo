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
import { ReimbursementService } from './reimbursement.service';
import { CreateReimbursementDto } from './dto/create-reimbursement.dto';
import { UpdateReimbursementDto } from './dto/update-reimbursement.dto';
import { QueryReimbursementDto } from './dto/query-reimbursement.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { Reimbursements } from '../../db/schema/reimbursements';

@ApiTags('lc/reimbursements')
@ApiBearerAuth()
@Controller('lc/reimbursements')
export class ReimbursementController {
  constructor(private readonly reimbursementService: ReimbursementService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of reimbursements' })
  @ApiResponse({ status: 200, description: 'Returns paginated reimbursements' })
  async findAll(@Query() query: QueryReimbursementDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<PaginatedResponse<Reimbursements>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.reimbursementService.findAll(query, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get reimbursement by id' })
  @ApiResponse({ status: 200, description: 'Returns the reimbursement' })
  @ApiResponse({ status: 404, description: 'Reimbursement not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Reimbursements>> {
    const data = await this.reimbursementService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new reimbursement' })
  @ApiResponse({ status: 201, description: 'Reimbursement created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateReimbursementDto, @CurrentUser() user: { sub: string }): Promise<ApiResp<Reimbursements>> {
    const data = await this.reimbursementService.create(dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update reimbursement by id' })
  @ApiResponse({ status: 200, description: 'Reimbursement updated successfully' })
  @ApiResponse({ status: 404, description: 'Reimbursement not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateReimbursementDto,
  ): Promise<ApiResp<Reimbursements>> {
    const data = await this.reimbursementService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete reimbursements by ids' })
  @ApiResponse({ status: 200, description: 'Reimbursements deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.reimbursementService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete reimbursement by id' })
  @ApiResponse({ status: 200, description: 'Reimbursement deleted successfully' })
  @ApiResponse({ status: 404, description: 'Reimbursement not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.reimbursementService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
