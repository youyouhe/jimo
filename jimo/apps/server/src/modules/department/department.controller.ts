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
import { DepartmentService } from './department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentDto } from './dto/query-department.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { Departments } from '../../db/schema/departments';

@ApiTags('lc/departments')
@ApiBearerAuth()
@Controller('lc/departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of departments' })
  @ApiResponse({ status: 200, description: 'Returns paginated departments' })
  async findAll(@Query() query: QueryDepartmentDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<PaginatedResponse<Departments>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.departmentService.findAll(query, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get department by id' })
  @ApiResponse({ status: 200, description: 'Returns the department' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<Departments>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.departmentService.findOne(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new department' })
  @ApiResponse({ status: 201, description: 'Department created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: { sub: string }): Promise<ApiResp<Departments>> {
    const data = await this.departmentService.create(dto, user?.sub);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update department by id' })
  @ApiResponse({ status: 200, description: 'Department updated successfully' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateDepartmentDto,
    @CurrentUser() user: { sub: string; roles: string[] },
  ): Promise<ApiResp<Departments>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.departmentService.update(id, dto, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete departments by ids' })
  @ApiResponse({ status: 200, description: 'Departments deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<{ count: number }>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    const data = await this.departmentService.batchRemove(dto.ids, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete department by id' })
  @ApiResponse({ status: 200, description: 'Department deleted successfully' })
  @ApiResponse({ status: 404, description: 'Department not found' })
  async remove(@Param('id') id: string, @CurrentUser() user: { sub: string; roles: string[] }): Promise<ApiResp<null>> {
    const roles = user?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('admin');
    await this.departmentService.remove(id, user?.sub, isAdmin);
    return { code: 0, msg: 'success', data: null };
  }
}
