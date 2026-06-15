import { IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryMenuDto {
  @ApiPropertyOptional({ example: 'Dashboard' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: [1, 2, 3], description: '1=directory, 2=menu, 3=button' })
  @IsOptional()
  @IsIn([1, 2, 3])
  @Type(() => Number)
  menu_type?: number;
}
