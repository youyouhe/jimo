import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsObject,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVersionDto {
  @ApiProperty({ example: 'System Snapshot v1.0', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  versionName: string = '';

  @ApiProperty({ example: '1.0.0', maxLength: 32 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(32)
  versionNumber: string = '';

  @ApiPropertyOptional({ example: 'Initial system configuration snapshot' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: { config: {}, roles: [] } })
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;
}
