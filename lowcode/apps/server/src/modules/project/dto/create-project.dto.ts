import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectDto {
  @ApiProperty({ description: '项目名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({ description: '项目描述' })
  @IsOptional()
  @IsString()
  description: string = '';

  @ApiProperty({ description: '开始日期' })
  @IsNotEmpty()
  @IsString()
  start_date: string = '';

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsString()
  end_date: string = '';

  @ApiProperty({ description: '是否进行中' })
  @IsNotEmpty()
  @IsBoolean()
  @Type(() => Boolean)
  is_active: boolean = false;

  @ApiPropertyOptional({ description: '任务列表', type: [Object] })
  @IsOptional()
  @IsArray()
  tasks: any[] = [];
}
