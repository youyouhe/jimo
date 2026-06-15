import { PartialType } from '@nestjs/swagger';
import { CreateParamDto } from './create-param.dto';

export class UpdateParamDto extends PartialType(CreateParamDto) {}
