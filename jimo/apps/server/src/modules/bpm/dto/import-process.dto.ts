import { IsNotEmpty, IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportProcessXmlDto {
  @ApiProperty({ description: 'BPMN 2.0 XML string to import' })
  @IsNotEmpty()
  @IsString()
  xml!: string;

  @ApiPropertyOptional({ description: 'Process name (override extracted from XML)', maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Process key (auto-generated if omitted)', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  key?: string;

  @ApiPropertyOptional({ description: 'Category tag', maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;
}
