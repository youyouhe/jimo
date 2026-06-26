import { Module } from '@nestjs/common';
import { BpmController } from './bpm.controller';
import { BpmService } from './bpm.service';
import { BpmnConverterModule } from '../../core/bpmn/bpmn-converter.module';
import { BpmAgentController } from './agent/bpm.agent.controller';
import { BpmAgentService } from './agent/bpm.agent.service';

@Module({
  imports: [BpmnConverterModule],
  controllers: [BpmController, BpmAgentController],
  providers: [BpmService, BpmAgentService],
  exports: [BpmService, BpmAgentService],
})
export class BpmModule {}
