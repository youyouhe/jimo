import {
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateDetailDto {
  @ApiPropertyOptional({ description: 'Label (display text)', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  label?: string;

  @ApiPropertyOptional({ description: 'Value (code)', maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  value?: string;

  @ApiPropertyOptional({ description: 'Status: 1=active, 2=disabled', enum: [1, 2] })
  @IsOptional()
  @IsIn([1, 2])
  status?: number;

  @ApiPropertyOptional({ description: 'Sort order' })
  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ description: 'Parent detail ID for nested options' })
  @IsOptional()
  @IsUUID()
  parent_id?: string;
}
