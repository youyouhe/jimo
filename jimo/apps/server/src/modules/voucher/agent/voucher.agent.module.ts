import { Module } from '@nestjs/common';
import { VoucherModule } from '../voucher.module';
import { AutocodeModule } from '../../autocode/autocode.module';
import { VoucherAgentService } from './voucher.agent.service';

@Module({
  imports: [VoucherModule, AutocodeModule],
  providers: [VoucherAgentService],
  exports: [VoucherAgentService],
})
export class VoucherAgentModule {}
