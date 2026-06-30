import { Module } from '@nestjs/common';
import { DictionaryController } from './dictionary.controller';
import { DictionaryService } from './dictionary.service';
import { DictionarySnapshotService } from './dictionary-snapshot.service';

@Module({
  controllers: [DictionaryController],
  providers: [DictionaryService, DictionarySnapshotService],
  exports: [DictionaryService, DictionarySnapshotService],
})
export class DictionaryModule {}
