import { Global, Module } from '@nestjs/common';
import { DATABASE_CONNECTION, createDb } from '../db/connection';

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      useFactory: () => {
        const url = process.env['DATABASE_URL'];
        if (!url) {
          throw new Error('DATABASE_URL environment variable is not set');
        }
        return createDb(url);
      },
    },
  ],
  exports: [DATABASE_CONNECTION],
})
export class DatabaseModule {}
