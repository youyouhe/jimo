import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsIn,
  IsObject,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const TEMPLATE_TYPES = ['json', 'csv'] as const;

export class CreateExportTemplateDto {
  @ApiProperty({ example: 'User Export', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  name: string = '';

  @ApiProperty({ example: 'sys_users', maxLength: 128 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(128)
  tableName: string = '';

  @ApiProperty({ example: 'json', enum: TEMPLATE_TYPES })
  @IsNotEmpty()
  @IsString()
  @IsIn(TEMPLATE_TYPES)
  templateType: string = 'json';

  @ApiPropertyOptional({
    example: { columns: ['username', 'nickname'], filters: {} },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, any>;
}
