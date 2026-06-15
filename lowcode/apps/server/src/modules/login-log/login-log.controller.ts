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
import { LoginLogService } from './login-log.service';
import { QueryLoginLogDto } from './dto/query-login-log.dto';
import { BatchDeleteLoginLogDto } from './dto/batch-delete-login-log.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { SysLoginLog } from '../../db/schema/login-logs';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('login-logs')
@ApiBearerAuth()
@Controller('login-logs')
export class LoginLogController {
  constructor(private readonly loginLogService: LoginLogService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of login logs' })
  @ApiResponse({ status: 200, description: 'Returns paginated login logs' })
  async findAll(@Query() query: QueryLoginLogDto): Promise<PaginatedResponse<SysLoginLog>> {
    const data = await this.loginLogService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete login logs by ids' })
  @ApiResponse({ status: 200, description: 'Login logs deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteLoginLogDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.loginLogService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete login log by id' })
  @ApiResponse({ status: 200, description: 'Login log deleted successfully' })
  @ApiResponse({ status: 404, description: 'Login log not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.loginLogService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
