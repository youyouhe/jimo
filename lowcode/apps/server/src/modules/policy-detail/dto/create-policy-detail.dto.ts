import { IsNotEmpty, IsOptional, IsString, IsNumber, IsUUID, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePolicyDetailDto {
  @ApiProperty({ description: '所属制度' })
  @IsNotEmpty()
  @IsUUID()
  policy_id: string = '';

  @ApiPropertyOptional({ description: '章节编号', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  chapter_number: string = '';

  @ApiProperty({ description: '标题', maxLength: 300 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(300)
  title: string = '';

  @ApiProperty({ description: '内容' })
  @IsNotEmpty()
  @IsString()
  content: string = '';

  @ApiPropertyOptional({ description: '排序号' })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  sort_order: number = 0;
}
