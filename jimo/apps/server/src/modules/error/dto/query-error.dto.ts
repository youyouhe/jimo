import { IsOptional, IsString, IsInt, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ErrorLevel, ErrorStatus } from '../../../db/schema/error';

export class QueryErrorDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'error', enum: ['fatal', 'error', 'warn', 'info'] })
  @IsOptional()
  @IsString()
  @IsIn([ErrorLevel.FATAL, ErrorLevel.ERROR, ErrorLevel.WARN, ErrorLevel.INFO])
  level?: string;

  @ApiPropertyOptional({ example: 'web-frontend' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: 0, description: '0=未处理, 1=处理中, 2=已解决, 3=已忽略' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}
