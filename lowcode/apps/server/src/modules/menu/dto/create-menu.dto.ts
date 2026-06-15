import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsNumber,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateMenuDto {
  @ApiProperty({ example: 'Dashboard', maxLength: 64 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(64)
  name: string = '';

  @ApiPropertyOptional({ example: '/dashboard' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  path?: string;

  @ApiPropertyOptional({ example: './dashboard/index' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  component?: string;

  @ApiPropertyOptional({ example: 'DashboardOutlined' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @ApiPropertyOptional({ description: 'Parent menu UUID, null for root menus' })
  @IsOptional()
  @IsString()
  parent_id?: string;

  @ApiPropertyOptional({ example: 0, minimum: 0, maximum: 32767 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(32767)
  @Type(() => Number)
  sort?: number;

  @ApiPropertyOptional({ enum: [1, 2], default: 1, description: '1=visible, 2=hidden' })
  @IsOptional()
  @IsIn([1, 2])
  @Type(() => Number)
  is_visible?: number;

  @ApiPropertyOptional({ example: 'system:menu:list' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  permission?: string;

  @ApiPropertyOptional({ enum: [1, 2, 3], default: 1, description: '1=directory, 2=menu, 3=button' })
  @IsOptional()
  @IsIn([1, 2, 3])
  @Type(() => Number)
  menu_type?: number;
}
