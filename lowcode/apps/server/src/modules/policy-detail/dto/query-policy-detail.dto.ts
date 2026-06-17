import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryPolicyDetailDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  chapter_number?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  title?: string;
}
