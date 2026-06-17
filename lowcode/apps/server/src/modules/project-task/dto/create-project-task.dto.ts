import { IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProjectTaskDto {
  @ApiProperty({ description: '所属项目' })
  @IsNotEmpty()
  @IsUUID()
  project_id: string = '';

  @ApiProperty({ description: '任务名称', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  task_name: string = '';

  @ApiPropertyOptional({ description: '负责人', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  assignee: string = '';

  @ApiProperty({ description: '任务状态' })
  @IsNotEmpty()
  @IsString()
  status: string = '';
}
