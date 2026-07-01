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
import { EmployeeModule } from './modules/employee/employee.module';
import { SystemAgentModule } from './modules/system-agent/system-agent.module';
import { ApprovalModule } from './modules/approval/approval.module';
import { BpmSyncModule } from './modules/bpm-sync/bpm-sync.module';
import { BpmModule } from './modules/bpm/bpm.module';
import { OwnershipModule } from './common/ownership/ownership.module';
import { BpmRulesModule } from './modules/bpm-rules/bpm-rules.module';
import { GeneratedModule } from './generated.module';

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
    OperationRecordModule,
    ApprovalModule,
    BpmSyncModule,
    BpmModule,
    BpmRulesModule,
    OwnershipModule,
    DepartmentModule,
    EmployeeModule,
    SystemAgentModule,
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
    GeneratedModule,
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
