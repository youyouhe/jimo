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
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { QueryCompanyDto } from './dto/query-company.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Companies } from '../../db/schema/companies';

@ApiTags('lc/companies')
@ApiBearerAuth()
@Controller('lc/companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of companies' })
  @ApiResponse({ status: 200, description: 'Returns paginated companies' })
  async findAll(@Query() query: QueryCompanyDto): Promise<PaginatedResponse<Companies>> {
    const data = await this.companyService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get company by id' })
  @ApiResponse({ status: 200, description: 'Returns the company' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Companies>> {
    const data = await this.companyService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new company' })
  @ApiResponse({ status: 201, description: 'Company created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateCompanyDto): Promise<ApiResp<Companies>> {
    const data = await this.companyService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update company by id' })
  @ApiResponse({ status: 200, description: 'Company updated successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<ApiResp<Companies>> {
    const data = await this.companyService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete companies by ids' })
  @ApiResponse({ status: 200, description: 'Companies deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.companyService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete company by id' })
  @ApiResponse({ status: 200, description: 'Company deleted successfully' })
  @ApiResponse({ status: 404, description: 'Company not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.companyService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
