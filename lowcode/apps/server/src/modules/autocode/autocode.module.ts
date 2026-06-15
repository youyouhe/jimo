import { Module } from '@nestjs/common';
import { AutocodeController } from './autocode.controller';
import { AutocodeService } from './autocode.service';

@Module({
  controllers: [AutocodeController],
  providers: [AutocodeService],
  exports: [AutocodeService],
})
export class AutocodeModule {}
