import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrgScopeDto {
  @ApiProperty({ enum: ['fixed', 'self', 'parent', 'company'] })
  @IsIn(['fixed', 'self', 'parent', 'company'])
  type!: 'fixed' | 'self' | 'parent' | 'company';

  @ApiPropertyOptional({ description: 'Required when type=fixed' })
  @IsOptional()
  @IsUUID()
  deptId?: string;

  @ApiPropertyOptional({ description: 'Only meaningful when type=fixed' })
  @IsOptional()
  @IsBoolean()
  includeSubtree?: boolean;
}

export class CandidateRuleFilterDto {
  @ApiPropertyOptional({ type: [String], description: 'sys_roles.id — match ANY' })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  roleIds?: string[];

  @ApiPropertyOptional({ type: [String], description: 'sys_employees.position — match ANY' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  positions?: string[];

  @ApiPropertyOptional({ type: OrgScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OrgScopeDto)
  orgScope?: OrgScopeDto;
}

export class CreateCandidateRuleDto {
  @ApiProperty() @IsNotEmpty() @IsString() name!: string;

  @ApiProperty({ type: CandidateRuleFilterDto })
  @ValidateNested()
  @Type(() => CandidateRuleFilterDto)
  filter!: CandidateRuleFilterDto;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateCandidateRuleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiPropertyOptional({ type: CandidateRuleFilterDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CandidateRuleFilterDto)
  filter?: CandidateRuleFilterDto;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class ResolveCandidatesDto {
  @ApiProperty({ description: 'sys_candidate_rules.id' })
  @IsNotEmpty()
  @IsUUID()
  ruleId!: string;

  @ApiProperty({ description: 'sys_users.id of the flow initiator (org scope is always relative to them)' })
  @IsNotEmpty()
  @IsUUID()
  initiatorUserId!: string;
}
