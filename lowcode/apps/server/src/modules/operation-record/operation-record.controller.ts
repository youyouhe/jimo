import {
  Controller,
  Get,
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
import { OperationRecordService } from './operation-record.service';
import { QueryRecordDto } from './dto/query-record.dto';
import { BatchDeleteRecordDto } from './dto/batch-delete-record.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { SysOperationRecord } from '../../db/schema/operation-records';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('operation-records')
@ApiBearerAuth()
@Controller('operation-records')
export class OperationRecordController {
  constructor(private readonly operationRecordService: OperationRecordService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of operation records' })
  @ApiResponse({ status: 200, description: 'Returns paginated operation records' })
  async findAll(@Query() query: QueryRecordDto): Promise<PaginatedResponse<SysOperationRecord>> {
    const data = await this.operationRecordService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get operation record by id' })
  @ApiResponse({ status: 200, description: 'Returns the operation record' })
  @ApiResponse({ status: 404, description: 'Operation record not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysOperationRecord>> {
    const data = await this.operationRecordService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  // IMPORTANT: DELETE /batch must be declared BEFORE DELETE /:id
  // to prevent NestJS from matching "batch" as an :id parameter.
  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete operation records by ids' })
  @ApiResponse({ status: 200, description: 'Operation records deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteRecordDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.operationRecordService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete operation record by id' })
  @ApiResponse({ status: 200, description: 'Operation record deleted successfully' })
  @ApiResponse({ status: 404, description: 'Operation record not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.operationRecordService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
