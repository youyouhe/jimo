/**
 * AUTO-GENERATED TEST SPEC GENERATORS.
 *
 * When autocode generates a business module it also emits two table-level L2
 * contract specs (service-layer + HTTP full-chain) by running the dto through
 * generateServiceContractSpec / generateHttpContractSpec. This makes the
 * "design → generate → self-check" loop fully automatic — no hand-copying the
 * student spec per table.
 *
 * These are L2 (table-level) only. The L0/L1 generator-meta tests live in
 * autocode-*-generators.spec.ts and are global (one copy shields every table).
 *
 * Template blueprint: student.service.contract.spec.ts / student.http.contract.spec.ts.
 */
import type { AutoCodeDto, AutoCodeField } from './dto/autocode.dto';
import { deriveNames, activeFields, buildSpecSampleValue } from './autocode-field-utils';

const SIMPLE_TYPES = ['varchar', 'text', 'integer', 'bigint', 'decimal', 'boolean', 'timestamp'];

/** Literal for a field's value in a generated create body. Unique varchar/text
 * fields take a per-case token so multiple creates in one test don't collide. */
function valLit(f: AutoCodeField, token: string): string {
  if (f.unique && ['varchar', 'text', 'image', 'file'].includes(f.type)) return `'${token}'`;
  return buildSpecSampleValue(f);
}

/** A create-body object literal built from the dto's required fields. */
function bodyLit(requiredFields: AutoCodeField[], token: string): string {
  return `{ ${requiredFields.map((f) => `${f.name}: ${valLit(f, token)}`).join(', ')} }`;
}

/** A distinct "changed" literal for partial-update assertions. */
function changedLit(f: AutoCodeField): string {
  switch (f.type) {
    case 'varchar':
    case 'text':
    case 'image':
    case 'file':
      return `'CHANGED_${f.name.toUpperCase()}'`;
    case 'integer':
    case 'bigint':
      return '2';
    case 'decimal':
      return `'20.00'`;
    case 'boolean':
      return 'false';
    case 'timestamp':
      return `'2025-02-02T00:00:00.000Z'`;
    default:
      return `'CHANGED'`;
  }
}

/** Shared field selection used by both generators. */
function selectFields(dto: AutoCodeDto) {
  const n = deriveNames(dto.tableName);
  const fields = activeFields(dto.fields);
  const bodyFields = fields.filter(
    (f) => f.creatable && f.type !== 'code' && f.type !== 'calculated' && f.type !== 'relation',
  );
  const requiredFields = bodyFields.filter((f) => f.required); // unique already enforced required
  const hasUnique = bodyFields.some((f) => f.unique);
  const repField =
    bodyFields.find((f) => f.unique && f.type === 'varchar') ??
    bodyFields.find((f) => f.required && f.type === 'varchar') ??
    requiredFields[0] ??
    bodyFields[0];
  // Avoid timestamp as the partial-update target: it reads back as a Date object,
  // not the ISO string changedLit emits, which would break the value-equality assert.
  const PARTIAL_TYPES = ['varchar', 'text', 'integer', 'bigint', 'decimal', 'boolean'];
  const partialField =
    bodyFields.find((f) => f.editable && !f.unique && !f.required && PARTIAL_TYPES.includes(f.type)) ??
    bodyFields.find((f) => f.editable && !f.unique && PARTIAL_TYPES.includes(f.type));
  return { n, fields, bodyFields, requiredFields, hasUnique, repField, partialField };
}

// ---------------------------------------------------------------------------
// Service-layer contract spec (real service + real Postgres, no HTTP)
// ---------------------------------------------------------------------------

export function generateServiceContractSpec(dto: AutoCodeDto): string {
  const { n, requiredFields, hasUnique, repField, partialField } = selectFields(dto);
  const Service = `${n.pascalSingular}Service`;
  const table = n.tableName;
  const rep = repField?.name ?? 'id';

  const its: string[] = [];

  its.push(`  it('CRUD round-trip: create → findOne → findAll → remove → 404', async () => {
    const created = await service.create(${bodyLit(requiredFields, 'A')} as any, TEST_USER);
    expect(created.id).toBeDefined();
${repField ? `    expect(created.${rep}).toBe(${valLit(repField, 'A')});` : ''}

    const one = await service.findOne(created.id, TEST_USER, true);
${repField ? `    expect(one.${rep}).toBe(${valLit(repField, 'A')});` : ''}

    const page = await service.findAll({ page: 1, pageSize: 20 } as any, TEST_USER, true);
    expect(page.total).toBe(1);

    await service.remove(created.id, TEST_USER, true);
    await expect(service.findOne(created.id, TEST_USER, true)).rejects.toBeDefined();
  });`);

  if (partialField) {
    const pf = partialField.name;
    const pfNew = changedLit(partialField);
    const guardField = [...requiredFields].reverse().find((f) => f.name !== pf) ?? repField;
    const guardLit = guardField ? valLit(guardField, 'B') : null;
    its.push(`  it('partial update leaves other fields intact (the per-cell-save invariant)', async () => {
    const created = await service.create(${bodyLit(requiredFields, 'B')} as any, TEST_USER);
    const updated = await service.update(created.id, { ${pf}: ${pfNew} } as any, TEST_USER, true);
    expect(updated.${pf}).toBe(${pfNew});
${guardField && guardLit ? `    expect(updated.${guardField.name}).toBe(${guardLit}); // unchanged` : ''}
    const fresh = await service.findOne(created.id, TEST_USER, true);
    expect(fresh.${pf}).toBe(${pfNew});
  });`);
  }

  its.push(`  it('soft-delete isolates removed rows from the list', async () => {
    const first = await service.create(${bodyLit(requiredFields, 'C1')} as any, TEST_USER);
    await service.create(${bodyLit(requiredFields, 'C2')} as any, TEST_USER);

    await service.remove(first.id, TEST_USER, true);

    const page = await service.findAll({ page: 1, pageSize: 20 } as any, TEST_USER, true);
    expect(page.total).toBe(1);
    expect(page.list.map((s: any) => s.${rep})).toEqual([${repField ? valLit(repField, 'C2') : `''`}]);
  });`);

  if (hasUnique) {
    its.push(`  it('create rejects on a duplicate (unique) value among live rows', async () => {
    await service.create(${bodyLit(requiredFields, 'D')} as any, TEST_USER);
    await expect(
      service.create(${bodyLit(requiredFields, 'D')} as any, TEST_USER),
    ).rejects.toBeDefined();
  });`);
  }

  return `/**
 * L2 (DB-backed) — ${Service} contract against a shared test database.
 *
 * ⚠️ AUTO-GENERATED by autocode (generateServiceContractSpec). Do not edit by
 * hand — regenerate the module to update. Add business-rule cases in a separate spec.
 *
 * Real ${Service} + real Postgres (lowcode_test), no HTTP / no guards: CRUD
 * round-trip, the partial-update invariant per-cell auto-save relies on, and
 * soft-delete isolation.
 *
 * Gated behind RUN_L2_DB=1 so the fast \`pnpm test\` never touches the database.
 * Run with: pnpm test:l2
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '${n.srcRelPath}db/schema';
import { ${Service} } from './${n.lcKebabSingular}.service';
import { OwnershipHelper } from '${n.srcRelPath}common/ownership/ownership.helper';

const RUN = process.env.RUN_L2_DB === '1';
const TEST_URL = process.env.TEST_DATABASE_URL || 'postgresql://lowcode:lowcode123@localhost:5432/lowcode_test';
const MAINT_URL = process.env.DATABASE_URL || 'postgresql://lowcode:lowcode123@localhost:5432/lowcode_db';
const TEST_USER = '00000000-0000-0000-0000-000000000001';

(RUN ? describe : describe.skip)('L2 (DB-backed) ${Service} contract', () => {
  let service: ${Service};
  let client: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const maint = postgres(MAINT_URL, { max: 1, connect_timeout: 10 });
    const db = await maint\`select datname from pg_database where datname='lowcode_test'\`;
    if (db.length === 0) await maint.unsafe('CREATE DATABASE lowcode_test');
    await maint.end();

    const probe = postgres(TEST_URL, { max: 1, connect_timeout: 10 });
    const present = await probe\`select table_name from information_schema.tables where table_name='${table}'\`;
    await probe.end();
    if (present.length === 0) {
      execSync('npx --no-install drizzle-kit push --force', {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, DATABASE_URL: TEST_URL },
        stdio: 'pipe',
        timeout: 120000,
      });
    }

    client = postgres(TEST_URL, { max: 5 });
    const dbh = drizzle(client, { schema }) as any;
    service = new ${Service}(dbh, new OwnershipHelper(dbh));
  }, 180000);

  beforeEach(async () => {
    await client\`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE\`;
  });

  afterAll(async () => {
    if (client) await client.end();
  });

${its.join('\n\n')}
});
`;
}

// ---------------------------------------------------------------------------
// HTTP full-chain contract spec (ValidationPipe → controller → service → DB)
// ---------------------------------------------------------------------------

export function generateHttpContractSpec(dto: AutoCodeDto): string {
  const { n, requiredFields, repField, partialField } = selectFields(dto);
  const Service = `${n.pascalSingular}Service`;
  const Controller = `${n.pascalSingular}Controller`;
  const table = n.tableName;
  const urlSeg = `lc/${n.kebabName}`;
  const rep = repField?.name ?? 'id';

  const its: string[] = [];

  its.push(`  it('rejects pageSize > 100 at the HTTP layer (ValidationPipe → 400)', async () => {
    const bad = await request(app.getHttpServer()).get('/api/v1/${urlSeg}?pageSize=9999');
    expect(bad.status).toBe(400);
    const ok = await request(app.getHttpServer()).get('/api/v1/${urlSeg}?pageSize=20');
    expect(ok.status).toBe(200);
  });`);

  its.push(`  it('creates a row via POST and lists it', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/${urlSeg}')
      .send(${bodyLit(requiredFields, 'H1')});
    expect(created.status).toBe(201);
${repField ? `    expect(created.body.data.${rep}).toBe(${valLit(repField, 'H1')});` : ''}

    const list = await request(app.getHttpServer()).get('/api/v1/${urlSeg}?page=1&pageSize=20');
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);
  });`);

  if (requiredFields.length > 0) {
    its.push(`  it('does NOT create when required fields are missing (ValidationPipe → 400)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/${urlSeg}')
      .send({}); // empty body — missing all required fields
    // With skipMissingProperties:false (mirrors main.ts), @IsNotEmpty fires and the
    // pipe rejects missing required fields with a clean 400 — no DB hit, no 500.
    expect(res.status).toBe(400);
  });`);
  }

  if (partialField) {
    const pf = partialField.name;
    const pfNew = changedLit(partialField);
    its.push(`  it('partial PATCH updates one field without touching others (HTTP layer)', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/${urlSeg}')
      .send(${bodyLit(requiredFields, 'H2')});
    const id = created.body.data.id;

    const patched = await request(app.getHttpServer())
      .patch(\`/api/v1/${urlSeg}/\${id}\`)
      .send({ ${pf}: ${pfNew} });
    expect(patched.status).toBe(200);
    expect(patched.body.data.${pf}).toBe(${pfNew});
  });`);
  }

  return `/**
 * L2 (HTTP full-chain) — ${Controller} through the real Nest pipeline.
 *
 * ⚠️ AUTO-GENERATED by autocode (generateHttpContractSpec). Do not edit by hand.
 *
 * ValidationPipe → controller → service → DB → response, including HTTP status.
 * Locks pageSize>100 → 400, create/list, and partial-PATCH flows.
 *
 * Minimal Testing app importing ONLY this module (no real global guards); a stub
 * guard sets req.user as super_admin. Same shared test DB; gated by RUN_L2_DB=1.
 */
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import postgres from 'postgres';
import { databaseProvider } from '${n.srcRelPath}db/connection';
import { ${Controller} } from './${n.lcKebabSingular}.controller';
import { ${Service} } from './${n.lcKebabSingular}.service';
import { OwnershipHelper } from '${n.srcRelPath}common/ownership/ownership.helper';

const RUN = process.env.RUN_L2_DB === '1';
const TEST_URL = process.env.TEST_DATABASE_URL || 'postgresql://lowcode:lowcode123@localhost:5432/lowcode_test';
const MAINT_URL = process.env.DATABASE_URL || 'postgresql://lowcode:lowcode123@localhost:5432/lowcode_db';
const TEST_USER = '00000000-0000-0000-0000-000000000001';

const stubAuthGuard: CanActivate = {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    req.user = { sub: TEST_USER, username: 'tester', roles: ['super_admin'] };
    return true;
  },
};

(RUN ? describe : describe.skip)('L2 (HTTP) ${Controller} + ValidationPipe', () => {
  let app: INestApplication;
  let clean: ReturnType<typeof postgres>;

  beforeAll(async () => {
    const maint = postgres(MAINT_URL, { max: 1, connect_timeout: 10 });
    const dbs = await maint\`select datname from pg_database where datname='lowcode_test'\`;
    if (dbs.length === 0) await maint.unsafe('CREATE DATABASE lowcode_test');
    await maint.end();
    const probe = postgres(TEST_URL, { max: 1 });
    const t = await probe\`select table_name from information_schema.tables where table_name='${table}'\`;
    await probe.end();
    if (t.length === 0) {
      execSync('npx --no-install drizzle-kit push --force', {
        cwd: path.resolve(__dirname, '../../..'),
        env: { ...process.env, DATABASE_URL: TEST_URL },
        stdio: 'pipe',
        timeout: 120000,
      });
    }

    const moduleRef = await Test.createTestingModule({
      controllers: [${Controller}],
      providers: [${Service}, databaseProvider(TEST_URL), OwnershipHelper],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        forbidNonWhitelisted: false,
        skipMissingProperties: false,
      }),
    );
    app.useGlobalGuards(stubAuthGuard);
    await app.init();

    clean = postgres(TEST_URL, { max: 1 });
  }, 180000);

  beforeEach(async () => {
    await clean\`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE\`;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (clean) await clean.end();
  });

${its.join('\n\n')}
});
`;
}
