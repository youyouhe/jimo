import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { CreateCustomBtnDto, RemoveCustomBtnDto } from './dto/custom-btn.dto';

import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { AuthorityBtnService, BtnMatrixGroup, BtnPermsDetail, BtnPermsEntry } from './authority-btn.service';
import { CreateAuthorityBtnDto } from './dto/create-authority-btn.dto';
import { SetAuthorityBtnsDto } from './dto/set-authority-btns.dto';
import { ToggleBtnDto } from './dto/toggle-authority-btn.dto';
import { QueryAuthorityBtnDto } from './dto/query-authority-btn.dto';
import {
  ApiResponse as ApiResp,
} from '@jimo/shared';
import { SysAuthorityBtn } from '../../db/schema/authority-btns';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../core/auth/auth.service';
import { UserRole } from '../../db/schema/users';

@ApiTags('authority-btns')
@ApiBearerAuth()
@Controller('authority-btns')
export class AuthorityBtnController {
  constructor(private readonly authorityBtnService: AuthorityBtnService) {}

  @Get('my')
  @ApiOperation({ summary: 'Get current user button permissions: { component -> btnName[] }' })
  @ApiResponse({ status: 200, description: 'Returns button permissions map for the current user' })
  async getMyBtnPerms(
    @CurrentUser() user: JwtPayload,
  ): Promise<ApiResp<Record<string, BtnPermsEntry>>> {
    const data = await this.authorityBtnService.getMyBtnPerms(user.sub, user.roles ?? []);
    return { code: 0, msg: 'success', data };
  }

  @Get()
  @ApiOperation({ summary: 'Get authority buttons by authorityId and/or menuId' })
  @ApiResponse({ status: 200, description: 'Returns matching authority buttons' })
  async findByAuthority(@Query() query: QueryAuthorityBtnDto): Promise<ApiResp<SysAuthorityBtn[]>> {
    const data = await this.authorityBtnService.findByAuthority(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('matrix')
  @ApiOperation({ summary: '按钮权限矩阵（按菜单分组，对接运行时 button 子菜单 + sys_role_menus）' })
  @ApiResponse({ status: 200, description: 'Returns button-permission groups' })
  async getMatrix(): Promise<ApiResp<BtnMatrixGroup[]>> {
    const data = await this.authorityBtnService.getMatrix();
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get authority button by id' })
  @ApiResponse({ status: 200, description: 'Returns the authority button' })
  @ApiResponse({ status: 404, description: 'Authority button not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysAuthorityBtn>> {
    const data = await this.authorityBtnService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a single authority button' })
  @ApiResponse({ status: 201, description: 'Authority button created successfully' })
  @ApiResponse({ status: 409, description: 'Button already exists for this role and menu' })
  async create(@Body() dto: CreateAuthorityBtnDto): Promise<ApiResp<SysAuthorityBtn>> {
    const data = await this.authorityBtnService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Post('set')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Set (replace) all buttons for a role+menu pair' })
  @ApiResponse({ status: 200, description: 'Authority buttons set successfully' })
  async set(@Body() dto: SetAuthorityBtnsDto): Promise<ApiResp<SysAuthorityBtn[]>> {
    const data = await this.authorityBtnService.set(dto);
    return { code: 0, msg: 'success', data };
  }

  @Post('toggle')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '授予/撤销某个按钮权限（role × button 子菜单，写 sys_role_menus）' })
  @ApiResponse({ status: 200, description: 'Toggled' })
  async toggle(@Body() dto: ToggleBtnDto): Promise<ApiResp<null>> {
    await this.authorityBtnService.toggleBtn(dto.roleId, dto.buttonMenuId, dto.assigned);
    return { code: 0, msg: 'success', data: null };
  }

  @Get('by-table/:tableName')
  @ApiOperation({ summary: '查询某张表的所有按钮及角色授权状态（agent 用）' })
  @ApiResponse({ status: 200, description: 'Returns button list with role assignments' })
  async listBtnPermsByTable(
    @Param('tableName') tableName: string,
  ): Promise<ApiResp<BtnPermsDetail[]>> {
    const data = await this.authorityBtnService.listBtnPerms(tableName);
    return { code: 0, msg: 'success', data };
  }

  @Post('custom')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '为已生成的业务表创建自定义导航按钮并授权给指定角色' })
  @ApiResponse({ status: 201, description: 'Custom button created' })
  @ApiResponse({ status: 409, description: 'Button name already exists on this table' })
  async createCustomBtn(
    @Body() dto: CreateCustomBtnDto,
  ): Promise<ApiResp<{ id: string; name: string }>> {
    const data = await this.authorityBtnService.createCustomBtn(dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('custom')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: '删除自定义按钮（系统按钮不可删除）' })
  @ApiResponse({ status: 200, description: 'Custom button removed' })
  @ApiResponse({ status: 400, description: 'System button cannot be removed via this API' })
  @ApiResponse({ status: 404, description: 'Button not found' })
  async removeCustomBtn(
    @Body() dto: RemoveCustomBtnDto,
  ): Promise<ApiResp<null>> {
    await this.authorityBtnService.removeCustomBtn(dto.tableName, dto.btnName);
    return { code: 0, msg: 'success', data: null };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete authority button by id' })
  @ApiResponse({ status: 200, description: 'Authority button deleted successfully' })
  @ApiResponse({ status: 404, description: 'Authority button not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.authorityBtnService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
