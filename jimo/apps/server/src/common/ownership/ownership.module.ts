import { Global, Module } from '@nestjs/common';
import { OwnershipHelper } from './ownership.helper';

/** Global — injected into every generated CRUD service. */
@Global()
@Module({
  providers: [OwnershipHelper],
  exports: [OwnershipHelper],
})
export class OwnershipModule {}
