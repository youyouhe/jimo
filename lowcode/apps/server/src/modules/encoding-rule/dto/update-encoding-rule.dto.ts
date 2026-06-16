import { PartialType } from '@nestjs/swagger';
import { CreateEncodingRuleDto } from './create-encoding-rule.dto.js';

export class UpdateEncodingRuleDto extends PartialType(CreateEncodingRuleDto) {}
