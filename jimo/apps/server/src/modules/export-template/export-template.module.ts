import { Module } from '@nestjs/common';
import { ExportTemplateController } from './export-template.controller';
import { ExportTemplateService } from './export-template.service';

@Module({
  controllers: [ExportTemplateController],
  providers: [ExportTemplateService],
  exports: [ExportTemplateService],
})
export class ExportTemplateModule {}
