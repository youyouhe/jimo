import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryVersionDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'System Snapshot' })
  @IsOptional()
  @IsString()
  versionName?: string;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  versionNumber?: string;
}
