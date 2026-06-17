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
import { ClubService } from './club.service';
import { CreateClubDto } from './dto/create-club.dto';
import { UpdateClubDto } from './dto/update-club.dto';
import { QueryClubDto } from './dto/query-club.dto';
import { BatchDeleteDto } from '../../common/dto/batch-delete.dto';
import {
  ApiResponse as ApiResp,
  PaginatedResponse,
} from '@lowcode/shared';
import { Clubs } from '../../db/schema/clubs';

@ApiTags('lc/clubs')
@ApiBearerAuth()
@Controller('lc/clubs')
export class ClubController {
  constructor(private readonly clubService: ClubService) {}

  @Get()
  @ApiOperation({ summary: 'Get paginated list of clubs' })
  @ApiResponse({ status: 200, description: 'Returns paginated clubs' })
  async findAll(@Query() query: QueryClubDto): Promise<PaginatedResponse<Clubs>> {
    const data = await this.clubService.findAll(query);
    return { code: 0, msg: 'success', data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get club by id' })
  @ApiResponse({ status: 200, description: 'Returns the club' })
  @ApiResponse({ status: 404, description: 'Club not found' })
  async findOne(@Param('id') id: string): Promise<ApiResp<Clubs>> {
    const data = await this.clubService.findOne(id);
    return { code: 0, msg: 'success', data };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new club' })
  @ApiResponse({ status: 201, description: 'Club created successfully' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async create(@Body() dto: CreateClubDto): Promise<ApiResp<Clubs>> {
    const data = await this.clubService.create(dto);
    return { code: 0, msg: 'success', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update club by id' })
  @ApiResponse({ status: 200, description: 'Club updated successfully' })
  @ApiResponse({ status: 404, description: 'Club not found' })
  @ApiResponse({ status: 409, description: 'Unique constraint conflict' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateClubDto,
  ): Promise<ApiResp<Clubs>> {
    const data = await this.clubService.update(id, dto);
    return { code: 0, msg: 'success', data };
  }

  @Delete('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batch delete clubs by ids' })
  @ApiResponse({ status: 200, description: 'Clubs deleted successfully' })
  async batchRemove(@Body() dto: BatchDeleteDto): Promise<ApiResp<{ count: number }>> {
    const data = await this.clubService.batchRemove(dto.ids);
    return { code: 0, msg: 'success', data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete club by id' })
  @ApiResponse({ status: 200, description: 'Club deleted successfully' })
  @ApiResponse({ status: 404, description: 'Club not found' })
  async remove(@Param('id') id: string): Promise<ApiResp<null>> {
    await this.clubService.remove(id);
    return { code: 0, msg: 'success', data: null };
  }
}
