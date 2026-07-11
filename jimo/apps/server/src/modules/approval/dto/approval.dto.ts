import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class StartApprovalDto {
  @ApiProperty({ example: 'post' })
  @IsNotEmpty()
  @IsString()
  businessType!: string;

  @ApiProperty({ description: 'PK of the business row in its lc_ table' })
  @IsNotEmpty()
  @IsString()
  businessId!: string;

  @ApiPropertyOptional({
    description: 'Business record fields, used to evaluate the chain rules (e.g. {amount: 50000}).',
  })
  @IsOptional()
  @IsObject()
  record?: Record<string, unknown>;

  @ApiPropertyOptional({
    description:
      'sys_users.id of the picked first-step approver. Required when the chain\'s first step is a ' +
      "srv:<ruleId> combined-filter rule (see CONTEXT.md's Candidate List) — otherwise ignored.",
  })
  @IsOptional()
  @IsUUID()
  pickedApproverUserId?: string;
}

export class ApproveDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;

  @ApiPropertyOptional({
    description:
      'sys_users.id of the picked next-step approver. Required when approved=true and the next chain ' +
      "step is a srv:<ruleId> combined-filter rule — otherwise ignored.",
  })
  @IsOptional()
  @IsUUID()
  nextApproverUserId?: string;
}

export class UpsertApprovalFlowDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;

  @ApiProperty({
    description: '{ rules: [{ when: { <field>: { <op>: <value> } }, chain: [ruleName,...] }], defaultChain: [ruleName,...] }',
  })
  @IsObject()
  config!: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}
