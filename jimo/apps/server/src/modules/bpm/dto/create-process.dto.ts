import { IsNotEmpty, IsOptional, IsString, MaxLength, Matches } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateProcessDto {
  @ApiProperty({ description: 'Process definition name', maxLength: 200, example: 'Generic Approval' })
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  name!: string;

  @ApiProperty({
    description: 'Process key (unique identifier, alphanumeric + underscore)',
    maxLength: 100,
    example: 'generic_approval',
  })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-zA-Z][a-zA-Z0-9_]*$/, { message: 'key must start with a letter and contain only letters, digits, and underscores' })
  key!: string;

  @ApiPropertyOptional({ description: 'Process description', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ description: 'Category tag', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional({ description: 'Icon name', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string;
}
