import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  IsIn,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDictDto {
  @ApiProperty({ description: 'Dictionary name', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  name: string = '';

  @ApiProperty({
    description: 'Dictionary type (lowercase letters and underscores)',
    maxLength: 128,
    pattern: '^[a-z_]+$',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-z_]+$/)
  type: string = '';

  @ApiPropertyOptional({ description: 'Status: 1=active, 2=disabled', enum: [1, 2], default: 1 })
  @IsOptional()
  @IsIn([1, 2])
  status?: number;

  @ApiPropertyOptional({ description: 'Description', maxLength: 256 })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  desc?: string;

  @ApiPropertyOptional({ description: 'Parent dictionary ID for tree hierarchy' })
  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @ApiPropertyOptional({ description: 'Sort order', default: 0 })
  @IsOptional()
  @IsInt()
  sort?: number;
}
