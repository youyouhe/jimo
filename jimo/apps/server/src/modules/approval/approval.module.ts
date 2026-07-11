import { Module } from '@nestjs/common';
import { BpmCallbackController } from './approval.controller';
import { ApprovalController, ApprovalFlowController } from './approval-api.controller';
import { ApprovalService } from './approval.service';
import { CandidateRuleController } from './candidate-rule.controller';
import { CandidateResolutionService } from './candidate-resolution.service';

@Module({
  controllers: [BpmCallbackController, ApprovalController, ApprovalFlowController, CandidateRuleController],
  providers: [ApprovalService, CandidateResolutionService],
  exports: [ApprovalService, CandidateResolutionService],
})
export class ApprovalModule {}
