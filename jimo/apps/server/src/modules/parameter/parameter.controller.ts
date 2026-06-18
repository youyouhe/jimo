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
import { ParameterService } from './parameter.service';
import { CreateParamDto } from './dto/create-param.dto';
import { UpdateParamDto } from './dto/update-param.dto';
import { QueryParamDto } from './dto/query-param.dto';
import { BatchDeleteDto } from './dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@jimo/shared';
import { SysParam } from '../../db/schema/parameters';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../db/schema/users';

@ApiTags('parameters')
@ApiBearerAuth()
@Controller('parameters')
export class ParameterController {
  constructor(private readonly parameterService: ParameterService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of parameters' })
  @ApiResponse({ status: 200, description: 'Returns paginated parameters' })
  async findAll(@Query() query: QueryParamDto): Promise<PaginatedResponse<SysParam>> {
    const data = await this.parameterService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get('key/:key')
  @ApiOperation({ summary: 'Get parameter by key' })
  @ApiResponse({ status: 200, description: 'Returns the parameter' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  async findByKey(@Param('key') key: string): Promise<ApiResp<SysParam>> {
    const data = await this.parameterService.findByKey(key);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get parameter by id' })
  @ApiResponse({ status: 200, description: 'Returns the parameter' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<SysParam>> {
    const data = await this.parameterService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a new parameter' })
  @ApiResponse({ status: 201, description: 'Parameter created successfully' })
  @ApiResponse({ status: 409, description: 'Parameter key already exists' })
  async create(@Body() dto: CreateParamDto): Promise<ApiResp<SysParam>> {
    const data = await this.parameterService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Update parameter by id' })
  @ApiResponse({ status: 200, description: 'Parameter updated successfully' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  @ApiResponse({ status: 409, description: 'Parameter key already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateParamDto,
  ): Promise<ApiResp<SysParam>> {
    const data = await this.parameterService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Batch delete parameters by ids' })
  @ApiResponse({ status: 200, description: 'Parameters deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.parameterService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @ApiOperation({ summary: 'Delete parameter by id' })
  @ApiResponse({ status: 200, description: 'Parameter deleted successfully' })
  @ApiResponse({ status: 404, description: 'Parameter not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.parameterService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
