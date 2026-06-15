import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryCourseDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  course?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  teacher?: string;
}
