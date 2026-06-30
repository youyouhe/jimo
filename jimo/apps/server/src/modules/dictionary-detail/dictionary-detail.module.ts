import { Module } from '@nestjs/common';
import { DictionaryDetailController } from './dictionary-detail.controller';
import { DictionaryDetailService } from './dictionary-detail.service';
import { DictionaryModule } from '../dictionary/dictionary.module';

@Module({
  imports: [DictionaryModule],
  controllers: [DictionaryDetailController],
  providers: [DictionaryDetailService],
  exports: [DictionaryDetailService],
})
export class DictionaryDetailModule {}
