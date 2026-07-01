import { Module } from '@nestjs/common';
import { SysDepartmentController } from './sys-department.controller';
import { SysDepartmentService } from './sys-department.service';

@Module({
  controllers: [SysDepartmentController],
  providers: [SysDepartmentService],
  exports: [SysDepartmentService],
})
export class DepartmentModule {}
