import { IsNotEmpty, IsOptional, IsString, IsBoolean, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({ description: '供应商名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({ description: '联系人', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  contact_person: string = '';

  @ApiPropertyOptional({ description: '联系电话', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone: string = '';

  @ApiPropertyOptional({ description: '邮箱', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  email: string = '';

  @ApiPropertyOptional({ description: '地址' })
  @IsOptional()
  @IsString()
  address: string = '';

  @ApiProperty({ description: '是否启用' })
  @IsNotEmpty()
  @IsBoolean()
  @Type(() => Boolean)
  is_active: boolean = false;
}
