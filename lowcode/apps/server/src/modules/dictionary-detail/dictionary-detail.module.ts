import { Module } from '@nestjs/common';
import { DictionaryDetailController } from './dictionary-detail.controller';
import { DictionaryDetailService } from './dictionary-detail.service';

@Module({
  controllers: [DictionaryDetailController],
  providers: [DictionaryDetailService],
  exports: [DictionaryDetailService],
})
export class DictionaryDetailModule {}
