import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  ValidateNested,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AutoCodeField } from './autocode.dto';

export class CreatePackageDto {
  @ApiProperty({ description: 'Package display name', example: 'E-Commerce' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string = '';

  @ApiPropertyOptional({ description: 'Package description' })
  @IsOptional()
  @IsString()
  description?: string = '';

  @ApiProperty({
    description: 'Template map: filepath -> source code content',
    example: { 'src/schema.ts': 'export const ...' },
  })
  @IsNotEmpty()
  templates: Record<string, string> = {};

  @ApiPropertyOptional({
    description: 'Base table name pattern for this package',
    example: 'products',
  })
  @ValidateIf((o) => o.tableName !== undefined && o.tableName !== '')
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tableName must be snake_case',
  })
  tableName?: string = '';

  @ApiPropertyOptional({
    description: 'Field definitions snapshot for "Load from Package"',
    type: [AutoCodeField],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoCodeField)
  fields?: AutoCodeField[];

  @ApiPropertyOptional({ description: 'Whether to generate frontend when applying', default: true })
  @IsOptional()
  @IsBoolean()
  generateWeb?: boolean = true;
}

export class UpdatePackageDto {
  @ApiPropertyOptional({ description: 'Package display name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Package description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Template map: filepath -> source code content' })
  @IsOptional()
  templates?: Record<string, string>;

  @ApiPropertyOptional({ description: 'Base table name pattern' })
  @IsOptional()
  @IsString()
  tableName?: string;

  @ApiPropertyOptional({ description: 'Field definitions snapshot', type: [AutoCodeField] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoCodeField)
  fields?: AutoCodeField[];

  @ApiPropertyOptional({ description: 'Whether to generate frontend when applying' })
  @IsOptional()
  @IsBoolean()
  generateWeb?: boolean;
}

export class SaveFromConfigDto {
  @ApiProperty({ description: 'Package display name', example: 'E-Commerce' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(255)
  name: string = '';

  @ApiPropertyOptional({ description: 'Package description' })
  @IsOptional()
  @IsString()
  description?: string = '';

  @ApiProperty({ description: 'Table name for generation', example: 'products' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tableName must be snake_case (lowercase letters, digits, underscores)',
  })
  tableName: string = '';

  @ApiProperty({ description: 'Field definitions', type: [AutoCodeField] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoCodeField)
  fields: AutoCodeField[] = [];

  @ApiProperty({ description: 'Also generate frontend', default: true })
  @IsBoolean()
  generateWeb: boolean = true;

  @ApiPropertyOptional({
    description: 'Also run preview() and store generated code as templates',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  generateTemplates?: boolean = false;
}
