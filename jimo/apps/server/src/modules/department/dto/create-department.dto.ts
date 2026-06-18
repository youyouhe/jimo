import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ description: '部门名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiProperty({ description: '部门编码', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  code: string = '';

  @ApiPropertyOptional({ description: '部门描述' })
  @IsOptional()
  @IsString()
  description: string = '';

  @ApiPropertyOptional({ description: '上级部门' })
  @IsOptional()
  @IsUUID()
  parent_id: string | null = null;
}
