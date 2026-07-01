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
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { EmployeeService } from './employee.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { QueryEmployeeDto } from './dto/query-employee.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('system/employees')
@ApiBearerAuth()
@Controller('system/employees')
export class EmployeeController {
  constructor(private readonly employeeService: EmployeeService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get paginated list of employees' })
  async findAll(@Query() query: QueryEmployeeDto) {
    return this.employeeService.findAll(query);
  }

  @Get('options')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Lightweight employee list for dropdowns' })
  async listOptions(@Query('keyword') keyword?: string) {
    const rows = await this.employeeService.listOptions(keyword);
    return { code: 0, msg: 'success', data: rows };
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Get employee detail' })
  async findOne(@Param('id') id: string) {
    const data = await this.employeeService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create employee' })
  async create(@Body() dto: CreateEmployeeDto) {
    const data = await this.employeeService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update employee' })
  async update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    const data = await this.employeeService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete employee' })
  async remove(@Param('id') id: string) {
    await this.employeeService.remove(id);
    return { code: 0, msg: 'success' };
  }
}
