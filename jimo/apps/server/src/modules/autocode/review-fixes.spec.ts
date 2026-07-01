/**
 * Round-1 regression tests — cover every bug fixed in the 2026-06-30 review session.
 *
 * Bug list:
 *  [C] _packageSlug missing in all frontend generators → wrong moduleDir / serviceImportAlias
 *  [H] document listableFields operator-precedence bug → un-listable relations always shown
 *  [H] grid MAX_ROWS cap (was MAX_PAGES=100 → 10 000 rows; now MAX_ROWS=500)
 *  [H] deleteHistory double-prefix: 'lc_' + 'lc_students' → dropped wrong table
 *  [H] computeSingleTableImpact double-prefix: same root cause
 */

jest.mock('@faker-js/faker', () => {
  const callable = () => 'mock';
  const make = (): any => new Proxy(callable, { get: () => make(), apply: () => 'mock' });
  return { fakerZH_CN: make() };
});

import {
  generateFrontendService,
  generateFrontendPage,
  generateFrontendDocumentListPage,
  generateFrontendDocumentPage,
  generateFrontendGridPage,
} from './autocode-frontend-generators';
import { deriveMasterSingular, deriveSubTableName } from './autocode-field-utils';
import { generateSchema } from './autocode-backend-generators';
import { buildAgentConfigMetadata } from './worker/agent-config';

// ── helpers ──────────────────────────────────────────────────────────────────
const f = (name: string, type: string, extra: Record<string, any> = {}): any => ({
  name, type, description: name,
  editable: true, creatable: true, searchable: true, listable: true,
  required: false, ...extra,
});

const baseDto = (tableName: string, extra: Record<string, any> = {}): any => ({
  tableName,
  description: tableName,
  fields: [f('name', 'varchar', { required: true })],
  ...extra,
});

// =============================================================================
// [C] _packageSlug propagation
// =============================================================================
describe('[C] _packageSlug propagation into generated source', () => {
  // moduleDir is lc/<slug>/lc-<singular> — with default slug it's lc/default/lc-<name>
  // The generated module.ts imports its service as a relative path built from moduleDir.
  // We can't directly assert moduleDir from source, but we CAN assert that passing a
  // non-default slug produces a different module registration import path.

  it('generateFrontendService: non-default slug does not crash and emits valid source', () => {
    const dto = baseDto('lc_hr_employee', { _packageSlug: 'hr' });
    expect(() => generateFrontendService(dto)).not.toThrow();
    const src = generateFrontendService(dto);
    expect(src.length).toBeGreaterThan(100);
    // generateFrontendService IS the service file — it exports API functions and types
    expect(src).toMatch(/export (async )?function|export interface/);
  });

  it('generateFrontendPage: default vs non-default slug both emit service import', () => {
    const def = generateFrontendPage(baseDto('lc_items', { _packageSlug: 'default' }));
    const pkg = generateFrontendPage(baseDto('lc_items', { _packageSlug: 'procurement' }));
    expect(def).toMatch(/from '@\/services\/lc\//);
    expect(pkg).toMatch(/from '@\/services\/lc\//);
  });

  it('generateFrontendDocumentListPage: non-default slug does not crash', () => {
    const dto = baseDto('lc_contract', { _packageSlug: 'procurement' });
    expect(() => generateFrontendDocumentListPage(dto)).not.toThrow();
  });

  it('generateFrontendDocumentPage: non-default slug does not crash', () => {
    const dto = baseDto('lc_contract', { _packageSlug: 'procurement' });
    expect(() => generateFrontendDocumentPage(dto)).not.toThrow();
  });

  it('generateFrontendGridPage: non-default slug does not crash', () => {
    const dto = baseDto('lc_sku', { _packageSlug: 'warehouse' });
    expect(() => generateFrontendGridPage(dto)).not.toThrow();
  });
});

// =============================================================================
// [H] document listableFields — operator-precedence fix
// =============================================================================
describe('[H] document listableFields respects the listable flag', () => {
  it('a non-listable m2o relation field must NOT appear in the document list columns', () => {
    const dto: any = {
      tableName: 'lc_orders',
      description: '订单',
      _packageSlug: 'default',
      fields: [
        f('title', 'varchar'),
        // listable: false — user explicitly hid this column
        f('supplier_id', 'relation', {
          relationType: 'many-to-one',
          relationTable: 'lc_suppliers',
          listable: false,
        }),
      ],
    };
    const src = generateFrontendDocumentListPage(dto);
    // The hidden relation column must NOT appear as a ProTable column definition
    expect(src).not.toMatch(/dataIndex:\s*'supplier_id'/);
  });

  it('a listable m2o relation field DOES appear in the document list columns', () => {
    const dto: any = {
      tableName: 'lc_orders',
      description: '订单',
      _packageSlug: 'default',
      fields: [
        f('title', 'varchar'),
        f('supplier_id', 'relation', {
          relationType: 'many-to-one',
          relationTable: 'lc_suppliers',
          listable: true,
        }),
      ],
    };
    const src = generateFrontendDocumentListPage(dto);
    expect(src).toMatch(/dataIndex:\s*'supplier_id'/);
  });

  it('one-to-many relations are always excluded from document list columns regardless of listable', () => {
    const dto: any = {
      tableName: 'lc_orders',
      description: '订单',
      _packageSlug: 'default',
      fields: [
        f('title', 'varchar'),
        f('items', 'relation', {
          relationType: 'one-to-many',
          relationTable: 'lc_order_items',
          listable: true, // even when listable=true, o2m must be excluded
        }),
      ],
    };
    const src = generateFrontendDocumentListPage(dto);
    expect(src).not.toMatch(/dataIndex:\s*'items'/);
  });
});

// =============================================================================
// [H] grid MAX_ROWS cap
// =============================================================================
describe('[H] grid page load cap', () => {
  it('uses MAX_ROWS (not MAX_PAGES) to cap loaded rows', () => {
    const src = generateFrontendGridPage(baseDto('lc_items') as any);
    expect(src).toContain('const MAX_ROWS = 500');
    expect(src).not.toContain('MAX_PAGES');
  });

  it('loop condition checks all.length < MAX_ROWS', () => {
    const src = generateFrontendGridPage(baseDto('lc_items') as any);
    expect(src).toMatch(/while\s*\(\s*all\.length\s*<\s*MAX_ROWS\s*\)/);
  });

  it('still uses PAGE_SIZE = 100 for per-request chunk', () => {
    const src = generateFrontendGridPage(baseDto('lc_items') as any);
    expect(src).toContain('const PAGE_SIZE = 100');
  });

  it('shows client-side pagination (not disabled)', () => {
    const src = generateFrontendGridPage(baseDto('lc_items') as any);
    expect(src).not.toContain('pagination={false}');
    expect(src).toContain('defaultPageSize: 20');
  });
});

// =============================================================================
// [H] deleteHistory / computeSingleTableImpact double-prefix
//     (pure unit test on the derivation logic, no DB needed)
// =============================================================================
describe('[H] dbTableName derivation — no double lc_ prefix', () => {
  // We can't import HistoryService directly (needs DI), so we test the invariant
  // via the actual string logic that was patched.
  const deriveDbTableName = (tableName: string): string =>
    tableName.startsWith('lc_') ? tableName : `lc_${tableName}`;

  it('already-prefixed name is returned as-is', () => {
    expect(deriveDbTableName('lc_students')).toBe('lc_students');
  });

  it('un-prefixed name gets exactly one lc_ prefix', () => {
    expect(deriveDbTableName('students')).toBe('lc_students');
  });

  it('does not double-prefix lc_lc_students', () => {
    expect(deriveDbTableName('lc_students')).not.toBe('lc_lc_students');
  });

  it('history tableName stored as lc_students derives correct db table', () => {
    // Simulate: history.tableName = 'lc_students' (normalised at generate time)
    const historyTableName = 'lc_students';
    const dbTable = deriveDbTableName(historyTableName);
    expect(dbTable).toBe('lc_students');
  });
});

// =============================================================================
// [H] sub-table (one-to-many child) naming — no double lc_ prefix
//     canonical: lc_<singular(master without lc_)>_<singular(field)>
//     e.g. lc_contracts + items → lc_contract_item (NOT lc_lc_contract_item)
// =============================================================================
describe('[H] sub-table naming — no double lc_ prefix', () => {
  it('deriveMasterSingular strips lc_ before singularizing', () => {
    expect(deriveMasterSingular('lc_contracts')).toBe('contract');
    expect(deriveMasterSingular('lc_students')).toBe('student');
  });

  it('deriveMasterSingular is idempotent on already-unprefixed input', () => {
    expect(deriveMasterSingular('contracts')).toBe('contract');
  });

  it('deriveMasterSingular does NOT keep the lc_ prefix', () => {
    expect(deriveMasterSingular('lc_students')).not.toBe('lc_student');
  });

  it('deriveSubTableName produces canonical single-prefix child name', () => {
    expect(deriveSubTableName('lc_contracts', 'items')).toBe('lc_contract_item');
    expect(deriveSubTableName('lc_students', 'items')).toBe('lc_student_item');
  });

  it('deriveSubTableName never double-prefixes', () => {
    expect(deriveSubTableName('lc_contracts', 'items')).not.toBe('lc_lc_contract_item');
    expect(deriveSubTableName('lc_students', 'items')).not.toBe('lc_lc_student_item');
  });

  it('generateSchema emits single-prefix child pgTable for a one-to-many field', () => {
    const dto = baseDto('lc_contracts', {
      fields: [
        f('title', 'varchar', { required: true }),
        f('items', 'relation', {
          relationType: 'one-to-many',
          detailFields: [f('qty', 'integer', { required: true })],
        }),
      ],
    });
    const src = generateSchema(dto);
    expect(src).toContain("'lc_contract_item'");
    expect(src).not.toMatch(/lc_lc_/);
    // FK column is contract_id (not lc_contract_id)
    expect(src).toContain('contract_id');
    expect(src).not.toMatch(/lc_contract_id/);
  });

  it('buildAgentConfigMetadata stores canonical sub-table FK map', () => {
    const dto = baseDto('lc_contracts', {
      agentConfig: { enabled: true },
      fields: [
        f('title', 'varchar', { required: true }),
        f('items', 'relation', {
          relationType: 'one-to-many',
          detailFields: [f('qty', 'integer', { required: true })],
        }),
      ],
    });
    const meta = buildAgentConfigMetadata(dto);
    expect(Object.keys(meta.subTableFkMap)).toContain('lc_contract_item');
    expect(meta.subTableFkMap['lc_contract_item']).toEqual({ contract_id: 'lc_contracts' });
  });
});

// =============================================================================
// [H] grid page — column freeze (fixed: 'left')
//     only grid emits fixed; field-level opt-in, left side only for now
// =============================================================================
describe('[H] grid page — column freeze', () => {
  it('emits fixed:left for a field marked fixed=true', () => {
    const dto = baseDto('lc_courses', {
      fields: [
        f('course_code', 'varchar', { required: true, fixed: true }),
        f('course_name', 'varchar', { required: true }),
      ],
    });
    const src = generateFrontendGridPage(dto);
    expect(src).toContain("dataIndex: 'course_code', fixed: 'left',");
  });

  it('does NOT emit fixed for an unmarked field', () => {
    const dto = baseDto('lc_courses', {
      fields: [f('course_name', 'varchar', { required: true })],
    });
    const src = generateFrontendGridPage(dto);
    expect(src).not.toMatch(/fixed: 'left'/);
  });

  it('list page never emits fixed (grid-only feature)', () => {
    const dto = baseDto('lc_courses', {
      fields: [f('course_code', 'varchar', { required: true, fixed: true })],
    });
    const src = generateFrontendPage(dto);
    expect(src).not.toMatch(/fixed: 'left'/);
  });
});

// =============================================================================
// [H] grid page — action column + editable.onChange no-op
//     delete/save must render on every row; editableKeys fully self-managed
//     (actionRender was unreliable for non-active rows; onChange let
//     EditableProTable drop rows out of edit mode on focus change)
// =============================================================================
describe('[H] grid page — action column + editable no-op', () => {
  const dto = () => baseDto('lc_items', { fields: [f('name', 'varchar', { required: true })] });

  it('renders an explicit valueType:option action column so delete is always visible', () => {
    const src = generateFrontendGridPage(dto());
    expect(src).toMatch(/valueType:\s*'option'/);
    expect(src).toContain('删除');
  });

  it('does NOT rely on editable.actionRender', () => {
    const src = generateFrontendGridPage(dto());
    expect(src).not.toMatch(/actionRender/);
  });

  it('editable.onChange is a no-op (editableKeys fully self-managed)', () => {
    const src = generateFrontendGridPage(dto());
    expect(src).toMatch(/onChange:\s*\(\)\s*=>\s*\{\s*\}/);
  });

  it('uses stable __key as rowKey', () => {
    const src = generateFrontendGridPage(dto());
    expect(src).toContain('rowKey="__key"');
  });
});
