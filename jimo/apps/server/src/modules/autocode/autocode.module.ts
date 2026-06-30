import { Module } from '@nestjs/common';
import { AutocodeController } from './autocode.controller';
import { AutocodeService } from './autocode.service';
import { AiGeneratorController } from './ai-generator.controller';
import { AiGeneratorService } from './ai-generator.service';
import { EncodingRuleModule } from '../encoding-rule/encoding-rule.module.js';
import { DictionaryDetailModule } from '../dictionary-detail/dictionary-detail.module.js';
import { AuthorityBtnModule } from '../authority-btn/authority-btn.module';
import { ReservedNamesService } from './reserved-names.service';
import { MockDataService } from './mock-data.service';
import { EntrypointService } from './entrypoint.service';
import { MenuService } from './menu.service';
import { PackageService } from './package.service';
import { HistoryService } from './history.service';

@Module({
  imports: [EncodingRuleModule, DictionaryDetailModule, AuthorityBtnModule],
  controllers: [AutocodeController, AiGeneratorController],
  providers: [
    AutocodeService,
    AiGeneratorService,
    ReservedNamesService,
    MockDataService,
    EntrypointService,
    MenuService,
    PackageService,
    HistoryService,
  ],
  exports: [AutocodeService],
})
export class AutocodeModule {}
