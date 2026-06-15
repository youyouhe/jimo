import { IsOptional, IsString, IsNumber, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateScoreDto {
  @ApiPropertyOptional({ description: '学生' })
  @IsOptional()
  @IsUUID()
  student: string = '';

  @ApiPropertyOptional({ description: '学科' })
  @IsOptional()
  @IsUUID()
  course: string = '';

  @ApiPropertyOptional({ description: '得分' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  myscore: number = 0;

  @ApiPropertyOptional({ description: '备注', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  memo: string = '';
}
