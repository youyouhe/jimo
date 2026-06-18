import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryApiTokenDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'my-token' })
  @IsOptional()
  @IsString()
  name?: string;
}
