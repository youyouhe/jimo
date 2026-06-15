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
import { ScoreService } from './score.service';
import { CreateScoreDto } from './dto/create-score.dto';
import { UpdateScoreDto } from './dto/update-score.dto';
import { QueryScoreDto } from './dto/query-score.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Score } from '../../db/schema/score';

@ApiTags('lc/score')
@ApiBearerAuth()
@Controller('lc/score')
export class ScoreController {
  constructor(private readonly scoreService: ScoreService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of score' })
  @ApiResponse({ status: 200, description: 'Returns paginated score' })
  async findAll(@Query() query: QueryScoreDto): Promise<PaginatedResponse<Score>> {
    const data = await this.scoreService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get score by id' })
  @ApiResponse({ status: 200, description: 'Returns the score' })
  @ApiResponse({ status: 404, description: 'Score not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Score>> {
    const data = await this.scoreService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new score' })
  @ApiResponse({ status: 201, description: 'Score created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateScoreDto): Promise<ApiResp<Score>> {
    const data = await this.scoreService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update score by id' })
  @ApiResponse({ status: 200, description: 'Score updated successfully' })
  @ApiResponse({ status: 404, description: 'Score not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateScoreDto,
  ): Promise<ApiResp<Score>> {
    const data = await this.scoreService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete score by ids' })
  @ApiResponse({ status: 200, description: 'Score deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.scoreService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete score by id' })
  @ApiResponse({ status: 200, description: 'Score deleted successfully' })
  @ApiResponse({ status: 404, description: 'Score not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.scoreService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
