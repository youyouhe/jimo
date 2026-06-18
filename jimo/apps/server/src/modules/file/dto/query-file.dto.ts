import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryFileDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Search by file name (fuzzy match)' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: 'Filter by file extension/tag' })
  @IsOptional()
  @IsString()
  tag?: string;
}
