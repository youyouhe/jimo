import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessApprovalStatus } from '@jimo/shared';

/**
 * Payload contract for the BPM → NestJS approval-outcome webhook.
 * Sent by BPM's ApprovalWebhookPublisher when a contract reaches a terminal
 * approval state (APPROVED / REJECTED).
 *
 * Authenticated out-of-band via HMAC signature headers (see BpmSignatureGuard),
 * so this DTO only validates the business fields.
 */
export class BpmApprovalCallbackDto {
  @ApiProperty({ example: 'contract', description: 'Which business entity this approval is for' })
  @IsString()
  @IsNotEmpty()
  businessType!: string;

  @ApiProperty({ description: 'PK of the business row in the source table (e.g. contract id)' })
  @IsString()
  @IsNotEmpty()
  businessId!: string;

  @ApiProperty({ description: 'Flowable process instance id' })
  @IsString()
  @IsNotEmpty()
  processInstanceId!: string;

  @ApiProperty({ enum: BusinessApprovalStatus, description: 'New approval status' })
  @IsEnum(BusinessApprovalStatus)
  status!: BusinessApprovalStatus;

  @ApiPropertyOptional({ description: 'BPM user id (EMPxxx) of the submitter' })
  @IsOptional()
  @IsString()
  initiatorId?: string;

  @ApiPropertyOptional({ description: 'BPM user id of the most recent approver' })
  @IsOptional()
  @IsString()
  approverId?: string;

  @ApiPropertyOptional({ description: 'Approval comment / opinion' })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiPropertyOptional({ description: 'Epoch millis when the outcome was decided (BPM side)' })
  @IsOptional()
  @IsString()
  occurredAt?: string;
}
