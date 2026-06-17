import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryCompanyDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  short_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  credit_code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
