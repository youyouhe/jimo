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
import { TestService } from './test.service';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { QueryTestDto } from './dto/query-test.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Test } from '../../db/schema/test';

@ApiTags('lc/test')
@ApiBearerAuth()
@Controller('lc/test')
export class TestController {
  constructor(private readonly testService: TestService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of test' })
  @ApiResponse({ status: 200, description: 'Returns paginated test' })
  async findAll(@Query() query: QueryTestDto): Promise<PaginatedResponse<Test>> {
    const data = await this.testService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get test by id' })
  @ApiResponse({ status: 200, description: 'Returns the test' })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Test>> {
    const data = await this.testService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new test' })
  @ApiResponse({ status: 201, description: 'Test created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateTestDto): Promise<ApiResp<Test>> {
    const data = await this.testService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update test by id' })
  @ApiResponse({ status: 200, description: 'Test updated successfully' })
  @ApiResponse({ status: 404, description: 'Test not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTestDto,
  ): Promise<ApiResp<Test>> {
    const data = await this.testService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete test by ids' })
  @ApiResponse({ status: 200, description: 'Test deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.testService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete test by id' })
  @ApiResponse({ status: 200, description: 'Test deleted successfully' })
  @ApiResponse({ status: 404, description: 'Test not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.testService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
