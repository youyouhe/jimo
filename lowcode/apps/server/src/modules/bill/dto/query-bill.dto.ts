import { IsOptional, IsString, IsUUID, IsArray } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryBillDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bill_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bill_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  project_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bill_items?: string;
}
