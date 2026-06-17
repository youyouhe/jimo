import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCompanyDto {
  @ApiProperty({ description: '公司全称', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name: string = '';

  @ApiPropertyOptional({ description: '公司简称', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  short_name: string = '';

  @ApiPropertyOptional({ description: '公司Logo', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  logo: string = '';

  @ApiPropertyOptional({ description: '统一社会信用代码', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  credit_code: string = '';

  @ApiPropertyOptional({ description: '公司地址', maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  address: string = '';

  @ApiPropertyOptional({ description: '联系电话', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone: string = '';

  @ApiPropertyOptional({ description: '公司邮箱', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  email: string = '';

  @ApiPropertyOptional({ description: '公司网站', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  website: string = '';

  @ApiPropertyOptional({ description: '公司描述' })
  @IsOptional()
  @IsString()
  description: string = '';

  @ApiPropertyOptional({ description: '成立日期' })
  @IsOptional()
  @IsString()
  established_date: string = '';

  @ApiPropertyOptional({ description: '公司状态' })
  @IsOptional()
  @IsString()
  status: string = '';
}
