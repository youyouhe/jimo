import { Controller, Get, Post, Patch, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SysDepartmentService } from './sys-department.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { QueryDepartmentDto } from './dto/query-department.dto';

@ApiTags('departments')
@ApiBearerAuth()
@Controller('departments')
export class SysDepartmentController {
  constructor(private readonly service: SysDepartmentService) {}

  @Get()
  @ApiOperation({ summary: 'List sys_departments (paginated)' })
  async findAll(@Query() query: QueryDepartmentDto) {
    return this.service.findAll(query);
  }

  @Get('tree')
  @ApiOperation({ summary: 'List departments as a tree structure (hierarchical)' })
  async tree() {
    const rows = await this.service.listTree();
    return { code: 0, msg: 'success', data: rows };
  }

  @Get('options')
  @ApiOperation({ summary: 'List all departments as dropdown options' })
  async options() {
    const rows = await this.service.listOptions();
    return { code: 0, msg: 'success', data: rows };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single department' })
  async findOne(@Param('id') id: string) {
    const data = await this.service.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @ApiOperation({ summary: 'Create a department' })
  async create(@Body() dto: CreateDepartmentDto) {
    const data = await this.service.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a department' })
  async update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    const data = await this.service.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a department' })
  async remove(@Param('id') id: string) {
    await this.service.remove(id);
    return { code: 0, msg: 'success' };
  }
}
