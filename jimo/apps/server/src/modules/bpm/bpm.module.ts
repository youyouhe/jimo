import { Module } from '@nestjs/common';
import { BpmController } from './bpm.controller';
import { BpmService } from './bpm.service';
import { BpmnConverterModule } from '../../core/bpmn/bpmn-converter.module';

@Module({
  imports: [BpmnConverterModule],
  controllers: [BpmController],
  providers: [BpmService],
  exports: [BpmService],
})
export class BpmModule {}
