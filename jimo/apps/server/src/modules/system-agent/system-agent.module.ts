import { Module } from '@nestjs/common';
import { SystemAgentController } from './system-agent.controller';
import { SystemAgentService } from './system-agent.service';

@Module({
  controllers: [SystemAgentController],
  providers: [SystemAgentService],
  exports: [SystemAgentService],
})
export class SystemAgentModule {}
