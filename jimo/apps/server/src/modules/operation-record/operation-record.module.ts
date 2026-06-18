import { Module } from '@nestjs/common';
import { OperationRecordController } from './operation-record.controller';
import { OperationRecordService } from './operation-record.service';

@Module({
  imports: [],
  controllers: [OperationRecordController],
  providers: [OperationRecordService],
  exports: [OperationRecordService],
})
export class OperationRecordModule {}
