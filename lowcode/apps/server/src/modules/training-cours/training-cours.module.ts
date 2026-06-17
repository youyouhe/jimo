import { Module } from '@nestjs/common';
import { TrainingCoursController } from './training-cours.controller';
import { TrainingCoursService } from './training-cours.service';

@Module({
  controllers: [TrainingCoursController],
  providers: [TrainingCoursService],
  exports: [TrainingCoursService],
})
export class TrainingCoursModule {}
