import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  IsIn,
  IsInt,
  Min,
  Max,
  ArrayMinSize,
  ValidateNested,
  Matches,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const FIELD_TYPES = [
  'varchar',
  'text',
  'integer',
  'bigint',
  'decimal',
  'boolean',
  'timestamp',
  'uuid',
  'image',
  'file',
  'relation',
  'dict',
  'code',
] as const;

export type AutoCodeFieldType = (typeof FIELD_TYPES)[number];

const RELATION_TYPES = ['many-to-one', 'many-to-many', 'one-to-many'] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

export class AutoCodeField {
  @ApiProperty({ description: 'Field name in snake_case', example: 'user_name' })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'Field name must be snake_case (lowercase letters, digits, underscores)',
  })
  name: string = '';

  @ApiProperty({
    description: 'Database column type',
    enum: FIELD_TYPES,
    example: 'varchar',
  })
  @IsNotEmpty()
  @IsString()
  @IsIn(FIELD_TYPES, { message: 'type must be one of: varchar, text, integer, bigint, decimal, boolean, timestamp, uuid, image, file, relation, dict, code' })
  type: AutoCodeFieldType = 'varchar';

  @ApiPropertyOptional({ description: 'Max length for varchar columns', example: 128 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4096)
  length?: number;

  @ApiProperty({ description: 'Whether this field is required', default: false })
  @IsNotEmpty()
  @IsBoolean()
  required: boolean = false;

  @ApiProperty({ description: 'Whether this column has a unique constraint', default: false })
  @IsNotEmpty()
  @IsBoolean()
  unique: boolean = false;

  @ApiProperty({ description: 'Human-readable field description', example: 'User display name' })
  @IsNotEmpty()
  @IsString()
  description: string = '';

  @ApiProperty({ description: 'Include this field in search/filter queries', default: true })
  @IsNotEmpty()
  @IsBoolean()
  searchable: boolean = true;

  @ApiProperty({ description: 'Show this field in list/table view', default: true })
  @IsNotEmpty()
  @IsBoolean()
  listable: boolean = true;

  @ApiProperty({ description: 'Include this field in the create form', default: true })
  @IsNotEmpty()
  @IsBoolean()
  creatable: boolean = true;

  @ApiProperty({ description: 'Include this field in the edit form', default: true })
  @IsNotEmpty()
  @IsBoolean()
  editable: boolean = true;

  // ── Relation-specific fields (only used when type === 'relation') ──

  @ApiPropertyOptional({
    description: 'Relation type: many-to-one or many-to-many. Required when type=relation',
    enum: RELATION_TYPES,
  })
  @IsOptional()
  @IsString()
  @IsIn(RELATION_TYPES)
  relationType?: RelationType;

  @ApiPropertyOptional({
    description: 'Target table name for the relation. Required when type=relation',
    example: 'categories',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'relationTable must be snake_case',
  })
  relationTable?: string;

  @ApiPropertyOptional({
    description: 'Which field from the target table to display in UI dropdowns/lists',
    example: 'category_name',
  })
  @IsOptional()
  @IsString()
  relationDisplayField?: string;

  // ── Dict-specific field (only used when type === 'dict') ──

  @ApiPropertyOptional({
    description: 'Dictionary type key for dict fields. Required when type=dict',
    example: 'sys_normal_disable',
  })
  @IsOptional()
  @IsString()
  dictType?: string;

  // ── Code-specific field (only used when type === 'code') ──

  @ApiPropertyOptional({
    description: 'Encoding rule ID for code fields. Required when type=code',
    example: '123e4567-e89b-12d3-a456-426614174000',
  })
  @IsOptional()
  @IsUUID()
  @IsNotEmpty({ message: 'ruleId must be a valid UUID when field type is code' })
  ruleId?: string;

  // ── One-to-many: detail fields for the child table ──

  @ApiPropertyOptional({
    description: 'For one-to-many relations: defines the columns of the child/detail table.',
    type: [AutoCodeField],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AutoCodeField)
  detailFields?: AutoCodeField[] = [];

  // ── One-to-many: attach an existing table as child (instead of creating a new one) ──

  @ApiPropertyOptional({
    description: 'For one-to-many: use an existing table as the child table instead of creating a new one. When true, relationTable must be set to the existing table name.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  relationExistingTable?: boolean = false;

  @ApiPropertyOptional({
    description: 'For one-to-many with relationExistingTable=true: the FK column name on the existing child table that references this master table.',
    example: 'student',
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'relationFkColumn must be snake_case',
  })
  relationFkColumn?: string;

  // ── Soft-remove marker ──

  @ApiPropertyOptional({
    description: 'Mark field as removed (soft delete). Column kept in DB but excluded from generated code.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  removed?: boolean = false;
}

/**
 * Mock data generation options. When attached to AutoCodeDto.mockData,
 * the generate pipeline inserts `count` mock business rows into lc_<tableName>
 * right after the schema-sync step.
 */
export class MockDataDto {
  @ApiProperty({
    description: 'Whether to generate mock business data after table creation',
    default: false,
  })
  @IsNotEmpty()
  @IsBoolean()
  enabled: boolean = false;

  @ApiProperty({
    description: 'Number of mock rows to insert',
    default: 10,
    minimum: 1,
    maximum: 1000,
  })
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(1000)
  count: number = 10;
}

export class AutoCodeDto {
  @ApiProperty({
    description: 'Database table name in snake_case',
    example: 'user_profiles',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tableName must be snake_case (lowercase letters, digits, underscores)',
  })
  tableName: string = '';

  @ApiProperty({
    description: 'Human-readable module description',
    example: 'User Profile Management',
  })
  @IsNotEmpty()
  @IsString()
  description: string = '';

  @ApiProperty({ description: 'Table fields definition', type: [AutoCodeField] })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one field is required' })
  @ValidateNested({ each: true })
  @Type(() => AutoCodeField)
  fields: AutoCodeField[] = [];

  @ApiProperty({
    description: 'Also generate frontend (Umi 4) page',
    default: true,
  })
  @IsNotEmpty()
  @IsBoolean()
  generateWeb: boolean = true;

  @ApiProperty({
    description: 'Overwrite existing files (delete old module first)',
    default: false,
  })
  @IsBoolean()
  @IsOptional()
  force?: boolean = false;

  @ApiPropertyOptional({
    description: 'Optional package ID — when set, the generated module menu is placed under the package directory',
  })
  @IsOptional()
  @IsUUID()
  packageId?: string;

  @ApiPropertyOptional({
    description: 'Generate mock business data after table creation',
    default: { enabled: false, count: 10 },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => MockDataDto)
  mockData?: MockDataDto;
}
