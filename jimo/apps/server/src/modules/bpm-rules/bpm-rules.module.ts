import { Module } from '@nestjs/common';
import { BpmRulesController } from './bpm-rules.controller';
import { BpmRulesService } from './bpm-rules.service';

@Module({
  controllers: [BpmRulesController],
  providers: [BpmRulesService],
})
export class BpmRulesModule {}
