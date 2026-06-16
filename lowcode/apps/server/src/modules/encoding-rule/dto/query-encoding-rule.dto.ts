import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto.js';

export class QueryEncodingRuleDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by encoding rule name (like)' })
  @IsOptional()
  @IsString()
  name?: string;
}
