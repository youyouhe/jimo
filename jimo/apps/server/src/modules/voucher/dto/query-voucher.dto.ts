import { IsOptional, IsString, IsUUID, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryVoucherDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voucher_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voucher_date?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  summary?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  prepared_by?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  voucher_items?: string;
}
