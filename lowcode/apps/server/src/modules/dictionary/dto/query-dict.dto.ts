import { IsOptional, IsString, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryDictDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by dictionary name (like)' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Filter by dictionary type (like)' })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional({ description: 'Filter by status: 1=active, 2=disabled', enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  status?: number;
}
