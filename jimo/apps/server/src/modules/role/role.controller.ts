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
import { RoleService } from './role.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { QueryRoleDto } from './dto/query-role.dto';
import { AssignRolesDto } from './dto/assign-roles.dto';
import { SetRoleMenusDto } from './dto/set-role-menus.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { SysRole } from '../../db/schema/roles';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../db/schema/users';
import { JwtPayload } from '../../core/auth/auth.service';

@ApiTags('roles')
@ApiBearerAuth()
@Controller('roles')
export class RoleController {
  constructor(private readonly roleService: RoleService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of roles' })
  @ApiResponse({ status: 200, description: 'Returns paginated roles' })
  async findAll(@Query() query: QueryRoleDto): Promise<PaginatedResponse<SysRole>> {
    const data = await this.roleService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  // ── Role-Menu Permission Association ──
  // These MUST come before :id catch-all to avoid route conflicts

  @Get(':id/menus')
  @ApiOperation({ summary: 'Get menu IDs assigned to a role' })
  @ApiResponse({ status: 200, description: 'Returns array of menu IDs' })
  async getRoleMenus(@Param('id') roleId: string): Promise<ApiResp<string[]>> {
    const data = await this.roleService.getRoleMenuIds(roleId);
    return { code: 0, msg: 'success', data };
  }

  @Post(':id/menus')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Set menus for a role (full replacement)' })
  @ApiResponse({ status: 200, description: 'Menus assigned successfully' })
  async setRoleMenus(
    @Param('id') roleId: string,
    @Body() dto: SetRoleMenusDto,
  ): Promise<ApiResp<null>> {
    await this.roleService.setRoleMenus(roleId, dto.menuIds);
    return { code: 0, msg: 'success', data: null };
  }

  // ── Standard CRUD ──

  @Get(':id')
  @ApiOperation({ summary: 'Get role by id' })
  @ApiResponse({ status: 200, description: 'Returns the role' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysRole>> {
    const data = await this.roleService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new role' })
  @ApiResponse({ status: 201, description: 'Role created successfully' })
  @ApiResponse({ status: 409, description: 'Role code already exists' })
  async create(@Body() dto: CreateRoleDto): Promise<ApiResp<SysRole>> {
    const data = await this.roleService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Update role by id' })
  @ApiResponse({ status: 200, description: 'Role updated successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
  ): Promise<ApiResp<SysRole>> {
    const data = await this.roleService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete role by id' })
  @ApiResponse({ status: 200, description: 'Role deleted successfully' })
  @ApiResponse({ status: 404, description: 'Role not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.roleService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @ApiOperation({ summary: 'Assign roles to a user' })
  @ApiResponse({ status: 200, description: 'Roles assigned successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or deleted roleId supplied' })
  @ApiResponse({ status: 403, description: 'ADMIN attempted to assign super_admin role' })
  async assignRoles(
    @Body() dto: AssignRolesDto,
    @CurrentUser() caller: JwtPayload,
  ): Promise<ApiResp<null>> {
    await this.roleService.assignRoles(dto, caller.roles ?? []);
    return { code: 0, msg: 'success', data: null };
  }

  @Get(':id/users-roles')
  @ApiOperation({ summary: 'Get roles for a user' })
  @ApiResponse({ status: 200, description: 'Returns roles for the user' })
  async getRolesForUser(@Param('id') userId: string): Promise<ApiResp<SysRole[]>> {
    const data = await this.roleService.getRolesForUser(userId);
    return { code: 0, msg: 'success', data };
  }
}
