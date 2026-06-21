import { Module } from '@nestjs/common';
import { BpmCallbackController } from './approval.controller';
import { ApprovalController, ApprovalFlowController } from './approval-api.controller';
import { ApprovalService } from './approval.service';

@Module({
  controllers: [BpmCallbackController, ApprovalController, ApprovalFlowController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalModule {}
