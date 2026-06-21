import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { BpmSignatureGuard } from './bpm-signature.guard';
import { ApprovalService } from './approval.service';
import { BpmApprovalCallbackDto } from './bpm-callback.dto';

/**
 * Inbound BPM callbacks. Public (no JWT) but HMAC-guarded — the global
 * JwtAuthGuard/RolesGuard/AuthzGuard are bypassed via @Public(), and the
 * BpmSignatureGuard authenticates the request via a shared-secret signature.
 */
@ApiTags('webhooks/bpm')
@Controller('webhooks/bpm')
@Public()
@UseGuards(BpmSignatureGuard)
export class BpmCallbackController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Post('approval')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'BPM approval outcome callback (HMAC-signed)' })
  @ApiResponse({ status: 200, description: 'Outcome applied (idempotent)' })
  @ApiResponse({ status: 401, description: 'Invalid signature or timestamp' })
  async approvalOutcome(
    @Body() dto: BpmApprovalCallbackDto,
  ): Promise<{ code: number; msg: string; data: { replay: boolean } }> {
    const result = await this.approvalService.applyBpmOutcome(dto);
    return { code: 0, msg: 'success', data: { replay: result.replay } };
  }
}
