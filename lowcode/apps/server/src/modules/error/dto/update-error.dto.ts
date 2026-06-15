import {
  IsOptional,
  IsString,
  IsInt,
  IsIn,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorStatus } from '../../../db/schema/error';

export class UpdateErrorDto {
  @ApiPropertyOptional({ example: 'Fixed by updating the null check', description: 'Resolution notes' })
  @IsOptional()
  @IsString()
  solution?: string;

  @ApiPropertyOptional({ example: 2, description: '0=未处理, 1=处理中, 2=已解决, 3=已忽略' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsIn([ErrorStatus.UNRESOLVED, ErrorStatus.RESOLVING, ErrorStatus.RESOLVED, ErrorStatus.IGNORED])
  status?: number;
}
