import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCourseDto {
  @ApiPropertyOptional({ description: '课程' })
  @IsOptional()
  @IsString()
  course: string = '';

  @ApiPropertyOptional({ description: '老师', maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  teacher: string = '';
}
