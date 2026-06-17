import { IsOptional, IsString, IsUUID, IsArray, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryStudentDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  student_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional({ description: '入学年份最小值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  enrollment_yearMin?: number;

  @ApiPropertyOptional({ description: '入学年份最大值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  enrollment_yearMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  club_records?: string;
}
