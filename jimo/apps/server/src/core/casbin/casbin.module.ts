import { Global, Module } from '@nestjs/common';
import { CasbinService } from './casbin.service';
import { CASBIN_SERVICE_TOKEN } from '../../modules/role/role.service';

@Global()
@Module({
  providers: [
    CasbinService,
    {
      provide: CASBIN_SERVICE_TOKEN,
      useExisting: CasbinService,
    },
  ],
  exports: [CasbinService, CASBIN_SERVICE_TOKEN],
})
export class CasbinModule {}
