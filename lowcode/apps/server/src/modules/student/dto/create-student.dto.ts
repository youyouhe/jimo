import { IsOptional, IsString, IsNumber, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiPropertyOptional({ description: '姓名', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name: string = '';

  @ApiPropertyOptional({ description: '年龄' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  age: number = 0;

  @ApiPropertyOptional({ description: '家庭', type: [Object] })
  @IsOptional()
  @IsArray()
  family: any[] = [];

  @ApiPropertyOptional({ description: '成绩', type: [Object] })
  @IsOptional()
  @IsArray()
  score: any[] = [];
}
