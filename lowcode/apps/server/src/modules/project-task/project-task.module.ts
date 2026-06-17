import { Module } from '@nestjs/common';
import { ProjectTaskController } from './project-task.controller';
import { ProjectTaskService } from './project-task.service';

@Module({
  controllers: [ProjectTaskController],
  providers: [ProjectTaskService],
  exports: [ProjectTaskService],
})
export class ProjectTaskModule {}
