import { Module } from '@nestjs/common';
import { AuthorityBtnController } from './authority-btn.controller';
import { AuthorityBtnService } from './authority-btn.service';

@Module({
  controllers: [AuthorityBtnController],
  providers: [AuthorityBtnService],
  exports: [AuthorityBtnService],
})
export class AuthorityBtnModule {}
