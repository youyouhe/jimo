import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertRuleDto {
  @ApiPropertyOptional({ description: 'Rule name (only for create, alphanumeric + underscore)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  ruleName?: string;

  @ApiProperty({ description: 'Human-readable label' })
  @IsString()
  @IsNotEmpty()
  label!: string;

  @ApiProperty({
    description: 'Resolution strategy',
    enum: ['SELF_DEPT_LEAD', 'PARENT_DEPT_LEAD', 'FIXED_DEPT_LEAD', 'BY_TITLE', 'BY_USER_ID'],
  })
  @IsString()
  @IsNotEmpty()
  strategy!: string;

  @ApiPropertyOptional({ description: 'Extra config (e.g. deptId or title)' })
  @IsOptional()
  config?: Record<string, unknown>;
}
