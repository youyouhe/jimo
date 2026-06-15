import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSystemConfigDto {
  @ApiProperty({ example: 'site.title', minLength: 1, maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key: string = '';

  @ApiProperty({ example: 'LowCode Admin' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  value: string = '';

  @ApiPropertyOptional({ example: 'Site title displayed in header' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  desc?: string;
}
