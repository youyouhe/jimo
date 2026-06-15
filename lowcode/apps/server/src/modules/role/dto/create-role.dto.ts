import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateRoleDto {
  @ApiProperty({ example: 'Administrator', maxLength: 64 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(64)
  name: string = '';

  @ApiProperty({ example: 'admin', maxLength: 64, description: 'Unique role code' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(64)
  code: string = '';

  @ApiPropertyOptional({ example: 'Full system access', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ enum: [0, 1], default: 0, description: '1 = assigned to new users by default' })
  @IsOptional()
  @IsIn([0, 1])
  @Type(() => Number)
  is_default?: number;
}
