import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateDepartmentDto {
  @ApiProperty({ description: '部门名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({ description: '负责人', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  manager_name: string = '';

  @ApiPropertyOptional({ description: '联系电话', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone: string = '';

  @ApiPropertyOptional({ description: '部门描述' })
  @IsOptional()
  @IsString()
  description: string = '';
}
