import { IsNotEmpty, IsOptional, IsString, IsNumber, IsBoolean, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ description: '部门编码', maxLength: 32 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(32)
  code!: string;

  @ApiProperty({ description: '部门名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ description: '排序' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sort_order?: number | undefined;

  @ApiPropertyOptional({ description: '是否启用' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_enabled?: boolean | undefined;
}
