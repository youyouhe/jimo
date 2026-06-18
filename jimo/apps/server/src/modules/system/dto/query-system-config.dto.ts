import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QuerySystemConfigDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  key?: string;
}
