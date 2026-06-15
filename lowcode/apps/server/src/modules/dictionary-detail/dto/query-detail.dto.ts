import { IsOptional, IsString, IsUUID, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryDetailDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Filter by dictionary ID' })
  @IsOptional()
  @IsUUID()
  dict_id?: string;

  @ApiPropertyOptional({ description: 'Filter by label (like)' })
  @IsOptional()
  @IsString()
  label?: string;

  @ApiPropertyOptional({ description: 'Filter by status: 1=active, 2=disabled', enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  status?: number;
}
