import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsInt,
  IsIn,
  MaxLength,
  Min,
  Max,
  Length,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEncodingRuleDto {
  @ApiProperty({ description: 'Encoding rule name', maxLength: 100 })
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name: string = '';

  @ApiPropertyOptional({ description: 'Fixed prefix string (e.g. STU, ORD)', maxLength: 20 })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  prefix?: string;

  @ApiPropertyOptional({
    description: 'Date segment format to embed in the code',
    enum: ['yyyyMMdd', 'yyMM', 'yyyy', 'none'],
  })
  @IsOptional()
  @IsIn(['yyyyMMdd', 'yyMM', 'yyyy', 'none'])
  dateFormat?: string;

  @ApiPropertyOptional({ description: 'Separator between segments', maxLength: 4, default: '' })
  @IsOptional()
  @IsString()
  @MaxLength(4)
  separator?: string;

  @ApiPropertyOptional({ description: 'Number of digits for the sequence part', default: 4, minimum: 1, maximum: 10 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  sequenceDigits?: number;

  @ApiPropertyOptional({ description: 'Character used to pad the sequence to the configured width', default: '0' })
  @IsOptional()
  @IsString()
  @Length(1, 1)
  paddingChar?: string;

  @ApiProperty({
    description: 'When to reset the sequence counter',
    enum: ['never', 'yearly', 'monthly'],
  })
  @IsIn(['never', 'yearly', 'monthly'])
  resetCycle: string = 'never';
}
