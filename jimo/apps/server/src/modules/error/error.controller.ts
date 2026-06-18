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
import { ErrorService } from './error.service';
import { ReportErrorDto } from './dto/report-error.dto';
import { UpdateErrorDto } from './dto/update-error.dto';
import { QueryErrorDto } from './dto/query-error.dto';
import { BatchDeleteErrorDto } from './dto/batch-delete-error.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { SysError } from '../../db/schema/error';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('errors')
@Controller('errors')
export class ErrorController {
  constructor(private readonly errorService: ErrorService) {}

  @Get()
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of error logs' })
  @ApiResponse({ status: 200, description: 'Returns paginated error logs' })
  async findAll(@Query() query: QueryErrorDto): Promise<PaginatedResponse<SysError>> {
    const data = await this.errorService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get error log detail by id' })
  @ApiResponse({ status: 200, description: 'Returns error log detail' })
  @ApiResponse({ status: 404, description: 'Error log not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysError>> {
    const data = await this.errorService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @Public()
  @ApiOperation({ summary: 'Report an error (public endpoint, no auth required)' })
  @ApiResponse({ status: 201, description: 'Error reported successfully' })
  async report(@Body() dto: ReportErrorDto): Promise<ApiResp<SysError>> {
    const data = await this.errorService.report(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiBearerAuth()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update error log (solution/status)' })
  @ApiResponse({ status: 200, description: 'Error log updated successfully' })
  @ApiResponse({ status: 404, description: 'Error log not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateErrorDto,
  ): Promise<ApiResp<SysError>> {
    const data = await this.errorService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete error logs by ids' })
  @ApiResponse({ status: 200, description: 'Error logs deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteErrorDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.errorService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete error log by id' })
  @ApiResponse({ status: 200, description: 'Error log deleted successfully' })
  @ApiResponse({ status: 404, description: 'Error log not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.errorService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
