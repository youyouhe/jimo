import { PartialType } from '@nestjs/swagger';
import { CreateProjectTaskDto } from './create-project-task.dto';

export class UpdateProjectTaskDto extends PartialType(CreateProjectTaskDto) {}
