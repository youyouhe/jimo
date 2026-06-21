import { Global, Module } from '@nestjs/common';
import { BpmOrgSyncService } from './bpm-org-sync.service';

/**
 * Global module — BpmOrgSyncService is injected into UserService and
 * DepartmentService to mirror org changes into BPM.
 */
@Global()
@Module({
  providers: [BpmOrgSyncService],
  exports: [BpmOrgSyncService],
})
export class BpmSyncModule {}
