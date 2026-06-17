import { PartialType } from '@nestjs/swagger';
import { CreatePolicyDetailDto } from './create-policy-detail.dto';

export class UpdatePolicyDetailDto extends PartialType(CreatePolicyDetailDto) {}
