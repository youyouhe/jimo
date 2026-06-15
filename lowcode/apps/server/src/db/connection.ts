import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index.js';

export const DATABASE_CONNECTION = 'DATABASE_CONNECTION';

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(databaseUrl: string): DrizzleDb {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return drizzle(client, { schema });
}

/** NestJS-compatible provider factory. */
export function databaseProvider(databaseUrl: string) {
  return {
    provide: DATABASE_CONNECTION,
    useFactory: () => createDb(databaseUrl),
  };
}
