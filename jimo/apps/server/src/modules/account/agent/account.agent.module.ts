import { Module } from '@nestjs/common';
import { AccountModule } from '../account.module';
import { AutocodeModule } from '../../autocode/autocode.module';
import { AccountAgentService } from './account.agent.service';

@Module({
  imports: [AccountModule, AutocodeModule],
  providers: [AccountAgentService],
  exports: [AccountAgentService],
})
export class AccountAgentModule {}
