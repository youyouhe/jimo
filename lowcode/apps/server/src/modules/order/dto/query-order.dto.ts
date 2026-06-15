import { IsOptional, IsString, IsNumberString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryOrderDto extends PaginationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '价格最小值' })
  @IsOptional()
  @IsNumberString()
  priceMin?: string;

  @ApiPropertyOptional({ description: '价格最大值' })
  @IsOptional()
  @IsNumberString()
  priceMax?: string;
}
