import { Module } from '@nestjs/common';
import { PurchaseOrderModule } from '../purchase-order.module';
import { AutocodeModule } from '../../autocode/autocode.module';
import { PurchaseOrderAgentService } from './purchase-order.agent.service';

@Module({
  imports: [PurchaseOrderModule, AutocodeModule],
  providers: [PurchaseOrderAgentService],
  exports: [PurchaseOrderAgentService],
})
export class PurchaseOrderAgentModule {}
