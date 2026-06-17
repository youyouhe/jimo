import { Module } from '@nestjs/common';
import { StudentClubController } from './student-club.controller';
import { StudentClubService } from './student-club.service';

@Module({
  controllers: [StudentClubController],
  providers: [StudentClubService],
  exports: [StudentClubService],
})
export class StudentClubModule {}
