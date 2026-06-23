import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentDto {
  @ApiProperty({ description: '学号', maxLength: 50 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  student_no: string = '';

  @ApiProperty({ description: '姓名', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({ description: '性别' })
  @IsOptional()
  @IsString()
  gender: string = '';

  @ApiPropertyOptional({ description: '出生日期' })
  @IsOptional()
  @IsString()
  birth_date: string = '';

  @ApiPropertyOptional({ description: '班级', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  class_name: string = '';

  @ApiPropertyOptional({ description: '联系电话', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone: string = '';

  @ApiPropertyOptional({ description: '邮箱', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  email: string = '';

  @ApiPropertyOptional({ description: '学籍状态' })
  @IsOptional()
  @IsString()
  enrollment_status: string = '';

  @ApiPropertyOptional({ description: '家庭地址' })
  @IsOptional()
  @IsString()
  address: string = '';
}
