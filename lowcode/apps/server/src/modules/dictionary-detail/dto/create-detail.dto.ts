import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsUUID,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDetailDto {
  @ApiProperty({ description: 'Parent dictionary ID' })
  @IsNotEmpty()
  @IsUUID()
  dict_id: string = '';

  @ApiProperty({ description: 'Label (display text)', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  label: string = '';

  @ApiProperty({ description: 'Value (code)', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  value: string = '';

  @ApiPropertyOptional({ description: 'Status: 1=active, 2=disabled', enum: [1, 2], default: 1 })
  @IsOptional()
  @IsIn([1, 2])
  status?: number;

  @ApiPropertyOptional({ description: 'Sort order', default: 0 })
  @IsOptional()
  @IsInt()
  sort?: number;

  @ApiPropertyOptional({ description: 'Parent detail ID for nested options' })
  @IsOptional()
  @IsUUID()
  parent_id?: string;
}
