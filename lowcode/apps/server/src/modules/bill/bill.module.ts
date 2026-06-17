import { Module } from '@nestjs/common';
import { BillController } from './bill.controller';
import { BillService } from './bill.service';

@Module({
  controllers: [BillController],
  providers: [BillService],
  exports: [BillService],
})
export class BillModule {}
