import { Global, Module } from '@nestjs/common';
import { OwnershipHelper } from './ownership.helper';
import { OwnershipService } from './ownership.service';
import { OwnershipController } from './ownership.controller';

/**
 * Global — OwnershipHelper is injected into every generated CRUD service.
 * OwnershipController exposes share/transfer endpoints.
 */
@Global()
@Module({
  controllers: [OwnershipController],
  providers: [OwnershipHelper, OwnershipService],
  exports: [OwnershipHelper],
})
export class OwnershipModule {}
