import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
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
}

export class ApproveDto {
  @ApiProperty() @IsBoolean() approved!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() comment?: string;
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
