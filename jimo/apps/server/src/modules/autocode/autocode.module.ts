import { Module } from '@nestjs/common';
import { AutocodeController } from './autocode.controller';
import { AutocodeService } from './autocode.service';
import { AiGeneratorController } from './ai-generator.controller';
import { AiGeneratorService } from './ai-generator.service';
import { EncodingRuleModule } from '../encoding-rule/encoding-rule.module.js';
import { DictionaryDetailModule } from '../dictionary-detail/dictionary-detail.module.js';

@Module({
  imports: [EncodingRuleModule, DictionaryDetailModule],
  controllers: [AutocodeController, AiGeneratorController],
  providers: [AutocodeService, AiGeneratorService],
  exports: [AutocodeService],
})
export class AutocodeModule {}
