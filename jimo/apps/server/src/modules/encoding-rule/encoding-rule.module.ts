import { Global, Module } from '@nestjs/common';
import { EncodingRuleController } from './encoding-rule.controller.js';
import { EncodingRuleService } from './encoding-rule.service.js';

@Global()
@Module({
  controllers: [EncodingRuleController],
  providers: [EncodingRuleService],
  exports: [EncodingRuleService],
})
export class EncodingRuleModule {}
