import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateStudentClubDto {
  @ApiProperty({ description: '学生' })
  @IsNotEmpty()
  @IsUUID()
  student_id: string = '';

  @ApiProperty({ description: '社团' })
  @IsNotEmpty()
  @IsUUID()
  club_id: string = '';

  @ApiProperty({ description: '加入日期' })
  @IsNotEmpty()
  @IsString()
  join_date: string = '';

  @ApiPropertyOptional({ description: '角色(成员/干事/社长)', maxLength: 30 })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  role: string = '';
}
