import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryApiDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'GET' })
  @IsOptional()
  @IsString()
  method?: string;

  @ApiPropertyOptional({ example: '/api/v1/users' })
  @IsOptional()
  @IsString()
  path?: string;

  @ApiPropertyOptional({ example: 'User Management' })
  @IsOptional()
  @IsString()
  apiGroup?: string;
}
