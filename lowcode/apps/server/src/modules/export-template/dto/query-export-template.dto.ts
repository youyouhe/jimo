import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class QueryExportTemplateDto extends PaginationDto {
  @ApiPropertyOptional({ example: 'User Export' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'sys_users' })
  @IsOptional()
  @IsString()
  tableName?: string;

  @ApiPropertyOptional({ example: 'json' })
  @IsOptional()
  @IsString()
  templateType?: string;
}
