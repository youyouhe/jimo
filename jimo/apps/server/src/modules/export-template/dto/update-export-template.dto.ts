import { PartialType } from '@nestjs/swagger';
import { CreateExportTemplateDto } from './create-export-template.dto';

export class UpdateExportTemplateDto extends PartialType(CreateExportTemplateDto) {}
