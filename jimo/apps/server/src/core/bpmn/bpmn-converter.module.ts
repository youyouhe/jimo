import { Module } from '@nestjs/common';
import { BpmnConverterService } from './bpmn-converter.service';

@Module({
  providers: [BpmnConverterService],
  exports: [BpmnConverterService],
})
export class BpmnConverterModule {}
