import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePostDto {
  @ApiProperty({ description: '文章标题', maxLength: 200 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  title: string = '';

  @ApiProperty({ description: '文章正文' })
  @IsNotEmpty()
  @IsString()
  content: string = '';

  @ApiPropertyOptional({ description: '文章摘要' })
  @IsOptional()
  @IsString()
  summary: string = '';

  @ApiPropertyOptional({ description: '封面图片', maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cover_image: string = '';

  @ApiPropertyOptional({ description: '发布时间' })
  @IsOptional()
  @IsString()
  published_at: string = '';

  @ApiProperty({ description: '状态（草稿/已发布）', maxLength: 20 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(20)
  status: string = '';
}
