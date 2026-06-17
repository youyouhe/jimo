import { IsNotEmpty, IsOptional, IsString, IsBoolean, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTrainingCoursDto {
  @ApiProperty({ description: '课程名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({ description: '课程描述' })
  @IsOptional()
  @IsString()
  description: string = '';

  @ApiProperty({ description: '开始日期' })
  @IsNotEmpty()
  @IsString()
  start_date: string = '';

  @ApiProperty({ description: '结束日期' })
  @IsNotEmpty()
  @IsString()
  end_date: string = '';

  @ApiProperty({ description: '是否发布' })
  @IsNotEmpty()
  @IsBoolean()
  @Type(() => Boolean)
  is_published: boolean = false;

  @ApiPropertyOptional({ description: '课程模块', type: [Object] })
  @IsOptional()
  @IsArray()
  modules: any[] = [];
}
