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
import { StudentClubService } from './student-club.service';
import { CreateStudentClubDto } from './dto/create-student-club.dto';
import { UpdateStudentClubDto } from './dto/update-student-club.dto';
import { QueryStudentClubDto } from './dto/query-student-club.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { StudentClubs } from '../../db/schema/student-clubs';

@ApiTags('lc/student-clubs')
@ApiBearerAuth()
@Controller('lc/student-clubs')
export class StudentClubController {
  constructor(private readonly studentClubService: StudentClubService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of student-clubs' })
  @ApiResponse({ status: 200, description: 'Returns paginated student-clubs' })
  async findAll(@Query() query: QueryStudentClubDto): Promise<PaginatedResponse<StudentClubs>> {
    const data = await this.studentClubService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get student-club by id' })
  @ApiResponse({ status: 200, description: 'Returns the student-club' })
  @ApiResponse({ status: 404, description: 'StudentClub not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<StudentClubs>> {
    const data = await this.studentClubService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new student-club' })
  @ApiResponse({ status: 201, description: 'StudentClub created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateStudentClubDto): Promise<ApiResp<StudentClubs>> {
    const data = await this.studentClubService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update student-club by id' })
  @ApiResponse({ status: 200, description: 'StudentClub updated successfully' })
  @ApiResponse({ status: 404, description: 'StudentClub not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateStudentClubDto,
  ): Promise<ApiResp<StudentClubs>> {
    const data = await this.studentClubService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete student-clubs by ids' })
  @ApiResponse({ status: 200, description: 'StudentClubs deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.studentClubService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete student-club by id' })
  @ApiResponse({ status: 200, description: 'StudentClub deleted successfully' })
  @ApiResponse({ status: 404, description: 'StudentClub not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.studentClubService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
