import { IsOptional, IsString, IsUUID, IsArray, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryStudentDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '年龄最小值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ageMin?: number;

  @ApiPropertyOptional({ description: '年龄最大值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  ageMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  family?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  score?: string;
}
