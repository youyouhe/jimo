import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsArray,
  ArrayMinSize,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AutoCodeField } from './autocode.dto';

export class UpdateModuleDto {
  @ApiProperty({
    description: 'Database table name to update (must already exist)',
    example: 'categories',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'tableName must be snake_case (lowercase letters, digits, underscores)',
  })
  tableName: string = '';

  @ApiPropertyOptional({
    description: 'Updated human-readable module description',
    example: 'Product Categories',
  })
  @IsOptional()
  @IsString()
  description?: string = '';

  @ApiProperty({ description: 'Updated table fields definition', type: [AutoCodeField] })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one field is required' })
  @ValidateNested({ each: true })
  @Type(() => AutoCodeField)
  fields: AutoCodeField[] = [];

  @ApiPropertyOptional({
    description: 'Also regenerate frontend (Umi 4) page',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  generateWeb?: boolean = true;

  @ApiPropertyOptional({
    description: 'Confirm field removal (data will be permanently lost)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean = false;
}
