import { Module } from '@nestjs/common';
import { PolicyDetailController } from './policy-detail.controller';
import { PolicyDetailService } from './policy-detail.service';

@Module({
  controllers: [PolicyDetailController],
  providers: [PolicyDetailService],
  exports: [PolicyDetailService],
})
export class PolicyDetailModule {}
