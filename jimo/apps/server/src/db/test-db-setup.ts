import postgres from 'postgres';

/**
 * Provision the shared L2 test database (`lowcode_test` by default).
 *
 * L2 (DB-backed) contract tests are generated per autocode entity and gated by
 * RUN_L2_DB=1 (see docs/测试框架方案.md). Their beforeAll auto-creates this DB
 * and pushes schema if missing, so this script is optional — it just front-loads
 * the DB creation so the first L2 run is faster and the requirement is explicit.
 *
 *   DATABASE_URL=...   maintenance/main DB (used to issue CREATE DATABASE)
 *   TEST_DATABASE_URL  optional override; defaults to <same host>/lowcode_test
 *
 * Usage: pnpm run db:test:setup   (then RUN_L2_DB=1 pnpm test)
 */
async function main(): Promise<void> {
  const maintUrl = process.env.DATABASE_URL;
  if (!maintUrl) throw new Error('DATABASE_URL is required');

  const testUrl =
    process.env.TEST_DATABASE_URL || maintUrl.replace(/\/[^/]*$/, '/lowcode_test');
  const testDb = testUrl.split('/').pop()!.split('?')[0];

  const maint = postgres(maintUrl, { max: 1, connect_timeout: 10 });
  try {
    const rows = await maint`select datname from pg_database where datname = ${testDb}`;
    if (rows.length === 0) {
      await maint.unsafe(`CREATE DATABASE "${testDb}"`);
      console.log(`[test-db-setup] created database "${testDb}"`);
    } else {
      console.log(`[test-db-setup] database "${testDb}" already exists`);
    }
  } finally {
    await maint.end();
  }
  console.log(`[test-db-setup] TEST_DATABASE_URL = ${testUrl}`);
  console.log('[test-db-setup] schema is pushed automatically by the L2 beforeAll.');
}

main().catch((err) => {
  console.error('[test-db-setup] failed:', err);
  process.exit(1);
});
