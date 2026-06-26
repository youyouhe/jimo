import { Module } from '@nestjs/common';
import { RegionModule } from '../region.module';
import { AutocodeModule } from '../../autocode/autocode.module';
import { RegionAgentService } from './region.agent.service';

@Module({
  imports: [RegionModule, AutocodeModule],
  providers: [RegionAgentService],
  exports: [RegionAgentService],
})
export class RegionAgentModule {}
