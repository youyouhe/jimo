import {
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  IsIn,
  MaxLength,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDictDto {
  @ApiPropertyOptional({ description: 'Dictionary name', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  name?: string;

  @ApiPropertyOptional({
    description: 'Dictionary type (lowercase letters and underscores)',
    maxLength: 128,
    pattern: '^[a-z_]+$',
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Matches(/^[a-z_]+$/)
  type?: string;

  @ApiPropertyOptional({ description: 'Status: 1=active, 2=disabled', enum: [1, 2] })
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

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsInt()
  sort?: number;
}
