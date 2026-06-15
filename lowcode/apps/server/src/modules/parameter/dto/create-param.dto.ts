import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateParamDto {
  @ApiProperty({ example: 'Site Name', minLength: 1, maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  name: string = '';

  @ApiProperty({ example: 'site.name', minLength: 1, maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  key: string = '';

  @ApiProperty({ example: 'My Platform' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(4096)
  value: string = '';

  @ApiPropertyOptional({ example: 'Main site title displayed in header' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  desc?: string;
}
