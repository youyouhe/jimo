import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryRoleDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'admin', description: 'Filter by role name (partial match)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ example: 'admin', description: 'Filter by role code (partial match)' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  code?: string;
}
