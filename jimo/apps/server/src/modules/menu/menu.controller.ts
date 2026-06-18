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
import { MenuService, MenuTreeNode } from './menu.service';
import { CreateMenuDto } from './dto/create-menu.dto';
import { UpdateMenuDto } from './dto/update-menu.dto';
import { QueryMenuDto } from './dto/query-menu.dto';
import { ApiResponse as ApiResp } from '@jimo/shared';
import { SysMenu } from '../../db/schema/menus';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../db/schema/users';
import { JwtPayload } from '../../core/auth/auth.service';

@ApiTags('menus')
@ApiBearerAuth()
@Controller('menus')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get()
  @ApiOperation({ summary: 'Get flat list of menus with optional filters' })
  @ApiResponse({ status: 200, description: 'Returns flat menu list' })
  async findAll(@Query() query: QueryMenuDto): Promise<ApiResp<SysMenu[]>> {
    const data = await this.menuService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('tree')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get full menu tree (admin only)' })
  @ApiResponse({ status: 200, description: 'Returns full nested menu tree' })
  @ApiResponse({ status: 403, description: 'Forbidden' })
  async findTree(): Promise<ApiResp<MenuTreeNode[]>> {
    const data = await this.menuService.findTree();
    return { code: 0, msg: 'success', data };
  }

  @Get('accessible')
  @ApiOperation({ summary: 'Get accessible menu tree for current user (JWT required)' })
  @ApiResponse({ status: 200, description: 'Returns filtered menu tree based on user role-menu assignments' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAccessible(
    @CurrentUser() user: JwtPayload,
  ): Promise<ApiResp<MenuTreeNode[]>> {
    const data = await this.menuService.findAccessible(user.sub, user.role);
    return { code: 0, msg: 'success', data };
  }

  @Post('sync-routes')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Sync DB menu names to .umirc.ts route config' })
  @ApiResponse({ status: 200, description: 'Returns count of updated routes' })
  async syncRoutes(): Promise<ApiResp<{ updated: number }>> {
    const data = await this.menuService.syncRoutesToUmirc();
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get menu by id' })
  @ApiResponse({ status: 200, description: 'Returns the menu' })
  @ApiResponse({ status: 404, description: 'Menu not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysMenu>> {
    const data = await this.menuService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new menu' })
  @ApiResponse({ status: 201, description: 'Menu created successfully' })
  async create(@Body() dto: CreateMenuDto): Promise<ApiResp<SysMenu>> {
    const data = await this.menuService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update menu by id' })
  @ApiResponse({ status: 200, description: 'Menu updated successfully' })
  @ApiResponse({ status: 404, description: 'Menu not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
  ): Promise<ApiResp<SysMenu>> {
    const data = await this.menuService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Soft delete menu by id (super_admin only)' })
  @ApiResponse({ status: 200, description: 'Menu deleted successfully' })
  @ApiResponse({ status: 400, description: 'Menu has children' })
  @ApiResponse({ status: 404, description: 'Menu not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.menuService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
