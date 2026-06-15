import { Module } from '@nestjs/common';
import { JwtBlacklistController } from './jwt-blacklist.controller';

@Module({
  controllers: [JwtBlacklistController],
})
export class JwtBlacklistModule {}
