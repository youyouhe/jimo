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
import { AccountService } from './account.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { QueryAccountDto } from './dto/query-account.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { Accounts } from '../../db/schema/accounts';

@ApiTags('lc/accounts')
@ApiBearerAuth()
@Controller('lc/accounts')
export class AccountController {
  constructor(private readonly accountService: AccountService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of accounts' })
  @ApiResponse({ status: 200, description: 'Returns paginated accounts' })
  async findAll(@Query() query: QueryAccountDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<PaginatedResponse<Accounts>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.accountService.findAll(query, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get account by id' })
  @ApiResponse({ status: 200, description: 'Returns the account' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<Accounts>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.accountService.findOne(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new account' })
  @ApiResponse({ status: 201, description: 'Account created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateAccountDto, @CurrentUser() user: { sub: string }): Promise<ApiResp<Accounts>> {
    const data = await this.accountService.create(dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update account by id' })
  @ApiResponse({ status: 200, description: 'Account updated successfully' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
    @CurrentUser() user: { sub: string; roles: string[] },
  ): Promise<ApiResp<Accounts>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.accountService.update(id, dto, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete accounts by ids' })
  @ApiResponse({ status: 200, description: 'Accounts deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<{ count: number }>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.accountService.batchRemove(dto.ids, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete account by id' })
  @ApiResponse({ status: 200, description: 'Account deleted successfully' })
  @ApiResponse({ status: 404, description: 'Account not found' })
  async remove(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<null>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    await this.accountService.remove(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data: null };
  }
}
