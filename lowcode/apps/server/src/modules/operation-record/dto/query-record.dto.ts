import { IsOptional, IsString, IsInt, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryRecordDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'HTTP method filter: GET/POST/PATCH/DELETE/PUT' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ description: 'Request path filter (like match)' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ description: 'HTTP status code filter' })
  @IsOptional()
  @IsInt()
  status?: number;

  @ApiPropertyOptional({ description: 'Start date filter (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
