import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateClubDto {
  @ApiProperty({ description: '社团名称', maxLength: 80 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(80)
  name: string = '';

  @ApiPropertyOptional({ description: '社团简介' })
  @IsOptional()
  @IsString()
  description: string = '';

  @ApiPropertyOptional({ description: '成立日期' })
  @IsOptional()
  @IsString()
  founded_date: string = '';
}
