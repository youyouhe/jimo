import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryPurchaseOrderDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  order_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supplier_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}
