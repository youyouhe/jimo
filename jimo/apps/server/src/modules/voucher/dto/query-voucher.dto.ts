import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryVoucherDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  voucher_number?: string;

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
  status?: string;
}
