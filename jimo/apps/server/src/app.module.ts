import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from './database/database.module';
import { CasbinModule } from './core/casbin/casbin.module';
import { AuthModule } from './core/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { RoleModule } from './modules/role/role.module';
import { MenuModule } from './modules/menu/menu.module';
import { HealthModule } from './health/health.module';
import { ParameterModule } from './modules/parameter/parameter.module';
import { FileModule } from './modules/file/file.module';
import { MinioModule } from './core/minio/minio.module';
import { DictionaryModule } from './modules/dictionary/dictionary.module';
import { DictionaryDetailModule } from './modules/dictionary-detail/dictionary-detail.module';
import { OperationRecordModule } from './modules/operation-record/operation-record.module';
import { ApiModule } from './modules/api/api.module';
import { AutocodeModule } from './modules/autocode/autocode.module';
import { JwtBlacklistModule } from './modules/jwt-blacklist/jwt-blacklist.module';
import { SystemModule } from './modules/system/system.module';
import { LoginLogModule } from './modules/login-log/login-log.module';
import { ApiTokenModule } from './modules/api-token/api-token.module';
import { ErrorModule } from './modules/error/error.module';
import { ExportTemplateModule } from './modules/export-template/export-template.module';
import { VersionModule } from './modules/version/version.module';
import { AuthorityBtnModule } from './modules/authority-btn/authority-btn.module';
import { OperationInterceptor } from './common/interceptors/operation.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuthzGuard } from './common/guards/authz.guard';
import { DepartmentModule } from './modules/department/department.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { BpmSyncModule } from './modules/bpm-sync/bpm-sync.module';
import { BpmModule } from './modules/bpm/bpm.module';
import { OwnershipModule } from './common/ownership/ownership.module';
import { ContractAgentModule } from './modules/contract/agent/contract.agent.module';
import { WarehousAgentModule } from './modules/warehous/agent/warehous.agent.module';
import { MaterialAgentModule } from './modules/material/agent/material.agent.module';
import { StockInOrderAgentModule } from './modules/stock-in-order/agent/stock-in-order.agent.module';
import { SupplierAgentModule } from './modules/supplier/agent/supplier.agent.module';
import { ProcurementContractAgentModule } from './modules/procurement-contract/agent/procurement-contract.agent.module';
import { AccountAgentModule } from './modules/account/agent/account.agent.module';
import { VoucherAgentModule } from './modules/voucher/agent/voucher.agent.module';
import { AccountModule } from './modules/account/account.module';
import { VoucherModule } from './modules/voucher/voucher.module';
import { MaterialModule } from './modules/material/material.module';
import { PurchaseOrderAgentModule } from './modules/purchase-order/agent/purchase-order.agent.module';
import { RegionModule } from './modules/region/region.module';
import { RegionAgentModule } from './modules/region/agent/region.agent.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { BpmRulesModule } from './modules/bpm-rules/bpm-rules.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    CasbinModule,
    AuthModule,
    UserModule,
    RoleModule,
    MenuModule,
    HealthModule,
    ParameterModule,
    FileModule,
    MinioModule,
    DictionaryModule,
    DictionaryDetailModule,
    OperationRecordModule,    SupplierModule,
    RegionModule,    MaterialModule,    VoucherModule,    AccountModule,    ApprovalModule,
    BpmSyncModule,
    BpmModule,
    BpmRulesModule,
    OwnershipModule,
    DepartmentModule,
    ApiModule,
    AutocodeModule,
    JwtBlacklistModule,
    SystemModule,
    LoginLogModule,
    ApiTokenModule,
    ErrorModule,
    ExportTemplateModule,
    VersionModule,
    AuthorityBtnModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AuthzGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationInterceptor,
    },
  ],
})
export class AppModule {}
