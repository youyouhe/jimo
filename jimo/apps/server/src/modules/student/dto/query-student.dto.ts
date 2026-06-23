import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryStudentDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  student_no?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  gender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  class_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  enrollment_status?: string;
}
