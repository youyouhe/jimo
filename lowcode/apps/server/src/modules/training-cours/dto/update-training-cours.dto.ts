import { PartialType } from '@nestjs/swagger';
import { CreateTrainingCoursDto } from './create-training-cours.dto';

export class UpdateTrainingCoursDto extends PartialType(CreateTrainingCoursDto) {}
