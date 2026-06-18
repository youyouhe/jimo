import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ErrorLevel } from '../../../db/schema/error';

const LEVELS = [ErrorLevel.FATAL, ErrorLevel.ERROR, ErrorLevel.WARN, ErrorLevel.INFO] as const;

export class ReportErrorDto {
  @ApiProperty({ example: 'error', enum: LEVELS })
  @IsNotEmpty()
  @IsString()
  @IsIn(LEVELS)
  level: string = ErrorLevel.ERROR;

  @ApiProperty({ example: 'web-frontend', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  source: string = '';

  @ApiProperty({ example: 'Uncaught TypeError: Cannot read property x of undefined' })
  @IsNotEmpty()
  @IsString()
  message: string = '';

  @ApiPropertyOptional({ example: 'Error: ...\n    at ...' })
  @IsOptional()
  @IsString()
  stack?: string;
}
