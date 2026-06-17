import { IsNotEmpty, IsOptional, IsString, IsNumber, IsUUID, IsArray, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty({ description: '姓名', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  name: string = '';

  @ApiProperty({ description: '学号', maxLength: 30 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(30)
  student_no: string = '';

  @ApiProperty({ description: '性别' })
  @IsNotEmpty()
  @IsString()
  gender: string = '';

  @ApiProperty({ description: '入学年份' })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  enrollment_year: number = 0;

  @ApiPropertyOptional({ description: '社团记录', type: [Object] })
  @IsOptional()
  @IsArray()
  club_records: any[] = [];
}
