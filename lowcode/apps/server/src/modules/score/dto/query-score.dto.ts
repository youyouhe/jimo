import { IsOptional, IsString, IsUUID, IsInt, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryScoreDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  student?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  course?: string;

  @ApiPropertyOptional({ description: '得分最小值' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  myscoreMin?: number;

  @ApiPropertyOptional({ description: '得分最大值' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  myscoreMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  memo?: string;
}
