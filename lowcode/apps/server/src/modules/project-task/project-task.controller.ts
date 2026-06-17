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
import { ProjectTaskService } from './project-task.service';
import { CreateProjectTaskDto } from './dto/create-project-task.dto';
import { UpdateProjectTaskDto } from './dto/update-project-task.dto';
import { QueryProjectTaskDto } from './dto/query-project-task.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { ProjectTasks } from '../../db/schema/project-tasks';

@ApiTags('lc/project-tasks')
@ApiBearerAuth()
@Controller('lc/project-tasks')
export class ProjectTaskController {
  constructor(private readonly projectTaskService: ProjectTaskService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of project-tasks' })
  @ApiResponse({ status: 200, description: 'Returns paginated project-tasks' })
  async findAll(@Query() query: QueryProjectTaskDto): Promise<PaginatedResponse<ProjectTasks>> {
    const data = await this.projectTaskService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project-task by id' })
  @ApiResponse({ status: 200, description: 'Returns the project-task' })
  @ApiResponse({ status: 404, description: 'ProjectTask not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<ProjectTasks>> {
    const data = await this.projectTaskService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new project-task' })
  @ApiResponse({ status: 201, description: 'ProjectTask created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateProjectTaskDto): Promise<ApiResp<ProjectTasks>> {
    const data = await this.projectTaskService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update project-task by id' })
  @ApiResponse({ status: 200, description: 'ProjectTask updated successfully' })
  @ApiResponse({ status: 404, description: 'ProjectTask not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectTaskDto,
  ): Promise<ApiResp<ProjectTasks>> {
    const data = await this.projectTaskService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete project-tasks by ids' })
  @ApiResponse({ status: 200, description: 'ProjectTasks deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.projectTaskService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete project-task by id' })
  @ApiResponse({ status: 200, description: 'ProjectTask deleted successfully' })
  @ApiResponse({ status: 404, description: 'ProjectTask not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.projectTaskService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
