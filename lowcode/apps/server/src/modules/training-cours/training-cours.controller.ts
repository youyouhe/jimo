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
import { TrainingCoursService } from './training-cours.service';
import { CreateTrainingCoursDto } from './dto/create-training-cours.dto';
import { UpdateTrainingCoursDto } from './dto/update-training-cours.dto';
import { QueryTrainingCoursDto } from './dto/query-training-cours.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { TrainingCourses } from '../../db/schema/training-courses';

@ApiTags('lc/training-courses')
@ApiBearerAuth()
@Controller('lc/training-courses')
export class TrainingCoursController {
  constructor(private readonly trainingCoursService: TrainingCoursService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of training-courses' })
  @ApiResponse({ status: 200, description: 'Returns paginated training-courses' })
  async findAll(@Query() query: QueryTrainingCoursDto): Promise<PaginatedResponse<TrainingCourses>> {
    const data = await this.trainingCoursService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get training-cours by id' })
  @ApiResponse({ status: 200, description: 'Returns the training-cours' })
  @ApiResponse({ status: 404, description: 'TrainingCours not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<TrainingCourses>> {
    const data = await this.trainingCoursService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new training-cours' })
  @ApiResponse({ status: 201, description: 'TrainingCours created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateTrainingCoursDto): Promise<ApiResp<TrainingCourses>> {
    const data = await this.trainingCoursService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update training-cours by id' })
  @ApiResponse({ status: 200, description: 'TrainingCours updated successfully' })
  @ApiResponse({ status: 404, description: 'TrainingCours not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTrainingCoursDto,
  ): Promise<ApiResp<TrainingCourses>> {
    const data = await this.trainingCoursService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete training-courses by ids' })
  @ApiResponse({ status: 200, description: 'TrainingCourses deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.trainingCoursService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete training-cours by id' })
  @ApiResponse({ status: 200, description: 'TrainingCours deleted successfully' })
  @ApiResponse({ status: 404, description: 'TrainingCours not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.trainingCoursService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
