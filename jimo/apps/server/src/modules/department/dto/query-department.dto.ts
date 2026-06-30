import { IsOptional, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryDepartmentDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '排序最小值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_orderMin?: number;

  @ApiPropertyOptional({ description: '排序最大值' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sort_orderMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  is_enabled?: string;
}
