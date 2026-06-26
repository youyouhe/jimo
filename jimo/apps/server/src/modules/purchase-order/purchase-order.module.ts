import { Module } from '@nestjs/common';
import { PurchaseOrderService } from './purchase-order.service';

@Module({
  providers: [PurchaseOrderService],
  exports: [PurchaseOrderService],
})
export class PurchaseOrderModule {}
