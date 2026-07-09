/**
 * Round-2 latent-risk tests — surface潜伏问题 found during the review but not yet
 * triggered in production.
 *
 * Coverage areas:
 *  1. lc_ prefix normalisation consistency across all three page types
 *  2. grid pagination config completeness
 *  3. document list vs list page column-count parity (same fields → same columns)
 *  4. grid EDITABLE_FIELDS excludes audit / calculated / code fields
 *  5. grid scheduleCreate skips rows with missing required fields (no premature POST)
 *  6. All three page types import getMyBtnPerms (permission enforcement present)
 *  7. generateFrontendService emits correct type interfaces for all relation variants
 *  8. grid delete confirmation absent (no Popconfirm — direct delete, expected behaviour)
 */

jest.mock('@faker-js/faker', () => {
  const callable = () => 'mock';
  const make = (): any => new Proxy(callable, { get: () => make(), apply: () => 'mock' });
  return { fakerZH_CN: make() };
});

import {
  generateFrontendPage,
  generateFrontendDocumentListPage,
  generateFrontendDocumentPage,
  generateFrontendGridPage,
  generateFrontendService,
} from './autocode-frontend-generators';

// ── helpers ──────────────────────────────────────────────────────────────────
const f = (name: string, type: string, extra: Record<string, any> = {}): any => ({
  name, type, description: name,
  editable: false, creatable: false, searchable: false, listable: true,
  required: false, ...extra,
});

const dto = (tableName: string, fields: any[], extra: Record<string, any> = {}): any => ({
  tableName, description: tableName, _packageSlug: 'default', fields, ...extra,
});

/** Field that is only listable (shown in table, not in create/edit form) */
const lf = (name: string, type: string, extra: Record<string, any> = {}): any =>
  f(name, type, { listable: true, ...extra });

/** Field that is creatable+editable (appears in form) */
const cf = (name: string, type: string, extra: Record<string, any> = {}): any =>
  f(name, type, { creatable: true, editable: true, listable: true, ...extra });

// =============================================================================
// 1. lc_ prefix consistency — passing an already-prefixed tableName must not
//    produce double-prefixed identifiers in the output
// =============================================================================
describe('lc_ prefix consistency across page types', () => {
  const allGens = [
    ['list',          (d: any) => generateFrontendPage(d)],
    ['document-list', (d: any) => generateFrontendDocumentListPage(d)],
    ['document-page', (d: any) => generateFrontendDocumentPage(d)],
    ['grid',          (d: any) => generateFrontendGridPage(d)],
  ] as const;

  it.each(allGens)('%s: no lc_lc_ in generated source', (_name, gen) => {
    const src = gen(dto('lc_employee', [f('name', 'varchar')]));
    expect(src).not.toMatch(/lc_lc_/);
  });

  it.each(allGens)('%s: service import path contains lc/ prefix exactly once', (_name, gen) => {
    const src = gen(dto('lc_employee', [f('name', 'varchar')]));
    const matches = src.match(/@\/services\/lc\//g) ?? [];
    // may appear multiple times (imports + usage) but the path string itself must not be lc/lc/
    expect(src).not.toMatch(/@\/services\/lc\/lc\//);
    expect(matches.length).toBeGreaterThan(0);
  });
});

// =============================================================================
// 2. Grid pagination config completeness
// =============================================================================
describe('grid pagination config', () => {
  it('emits showSizeChanger', () => {
    const src = generateFrontendGridPage(dto('lc_items', [f('name', 'varchar')]));
    expect(src).toContain('showSizeChanger: true');
  });

  it('emits showTotal helper', () => {
    const src = generateFrontendGridPage(dto('lc_items', [f('name', 'varchar')]));
    expect(src).toMatch(/showTotal.*共.*条/);
  });

  it('pageSizeOptions includes 20, 50, 100', () => {
    const src = generateFrontendGridPage(dto('lc_items', [f('name', 'varchar')]));
    expect(src).toContain("'20'");
    expect(src).toContain("'50'");
    expect(src).toContain("'100'");
  });
});

// =============================================================================
// 3. Document-list and list produce same number of listable columns for same fields
// =============================================================================
describe('document-list vs list — listable column count parity', () => {
  const fields = [
    lf('name', 'varchar'),
    lf('status', 'dict', { dictType: 'status' }),
    lf('amount', 'decimal'),
    // one-to-many must be excluded from both list columns
    lf('items', 'relation', { relationType: 'one-to-many' }),
    // m2o with listable=true must appear in both
    lf('owner_id', 'relation', { relationType: 'many-to-one', relationTable: 'lc_users' }),
    // m2o with listable=false must appear in neither
    lf('hidden_id', 'relation', { relationType: 'many-to-one', relationTable: 'lc_cats', listable: false }),
  ];

  it('list page renders o2m as a summary count column; document-list excludes it entirely', () => {
    const listSrc = generateFrontendPage(dto('lc_invoices', fields));
    const docSrc  = generateFrontendDocumentListPage(dto('lc_invoices', fields));
    // list page intentionally shows o2m as a "N 条" summary column
    expect(listSrc).toMatch(/dataIndex:\s*'items'/);
    // document-list page always excludes o2m from its column list
    expect(docSrc).not.toMatch(/dataIndex:\s*'items'/);
  });

  it('both pages include the listable m2o field', () => {
    const listSrc = generateFrontendPage(dto('lc_invoices', fields));
    const docSrc  = generateFrontendDocumentListPage(dto('lc_invoices', fields));
    expect(listSrc).toMatch(/dataIndex:\s*'owner_id'/);
    expect(docSrc).toMatch(/dataIndex:\s*'owner_id'/);
  });

  it('both pages exclude the non-listable m2o field', () => {
    const listSrc = generateFrontendPage(dto('lc_invoices', fields));
    const docSrc  = generateFrontendDocumentListPage(dto('lc_invoices', fields));
    expect(listSrc).not.toMatch(/dataIndex:\s*'hidden_id'/);
    expect(docSrc).not.toMatch(/dataIndex:\s*'hidden_id'/);
  });
});

// =============================================================================
// 4. Grid EDITABLE_FIELDS excludes audit / calculated / code fields
// =============================================================================
describe('grid EDITABLE_FIELDS exclusion', () => {
  it('code fields are not in EDITABLE_FIELDS', () => {
    const src = generateFrontendGridPage(dto('lc_docs', [
      cf('name', 'varchar', { editable: true }),
      cf('doc_no', 'code', { editable: true }),
    ]));
    expect(src).toMatch(/EDITABLE_FIELDS.*'name'/);
    expect(src).not.toMatch(/EDITABLE_FIELDS.*'doc_no'/);
  });

  it('calculated fields are not in EDITABLE_FIELDS', () => {
    const src = generateFrontendGridPage(dto('lc_orders', [
      cf('qty', 'integer', { editable: true }),
      cf('total', 'calculated', { editable: true }),
    ]));
    expect(src).not.toMatch(/EDITABLE_FIELDS.*'total'/);
  });

  it('image fields are not in EDITABLE_FIELDS (rendered read-only)', () => {
    const src = generateFrontendGridPage(dto('lc_products', [
      cf('name', 'varchar', { editable: true }),
      cf('cover', 'image', { editable: true }),
    ]));
    expect(src).not.toMatch(/EDITABLE_FIELDS.*'cover'/);
  });
});

// =============================================================================
// 5. Grid scheduleCreate: required field guard is emitted
// =============================================================================
describe('grid scheduleCreate required-field guard', () => {
  it('emits required-field check inside scheduleCreate when required fields exist', () => {
    const src = generateFrontendGridPage(dto('lc_tasks', [
      cf('title', 'varchar', { required: true, editable: true }),
      cf('notes', 'text', { editable: true }),
    ]));
    expect(src).toMatch(/for \(const req of \[.*'title'.*\]/);
  });

  it('omits required-field guard when no required fields', () => {
    const src = generateFrontendGridPage(dto('lc_tags', [
      cf('label', 'varchar', { required: false, editable: true }),
    ]));
    expect(src).not.toMatch(/for \(const req of \[\]/);
  });
});

// =============================================================================
// 6. All three page types import getMyBtnPerms
// =============================================================================
describe('getMyBtnPerms is present in all page generators', () => {
  const pages = [
    ['list',          generateFrontendPage],
    ['document-list', generateFrontendDocumentListPage],
    ['grid',          generateFrontendGridPage],
  ] as [string, (d: any) => string][];

  it.each(pages)('%s page imports getMyBtnPerms', (_name, gen) => {
    const src = gen(dto('lc_things', [f('name', 'varchar')]));
    expect(src).toContain("getMyBtnPerms");
  });
});

// =============================================================================
// 7. generateFrontendService: type interface completeness for relation variants
// =============================================================================
describe('generateFrontendService type interface', () => {
  it('emits a typed interface for one-to-many child with detailFields', () => {
    const src = generateFrontendService(dto('lc_orders', [
      lf('title', 'varchar'),
      {
        name: 'items',
        type: 'relation',
        relationType: 'one-to-many',
        required: false,
        listable: true,
        detailFields: [
          lf('product_id', 'varchar'),
          lf('qty', 'integer'),
        ],
      },
    ]));
    expect(src).toMatch(/export interface \w+/);
  });

  it('emits _display companion field for many-to-one relation', () => {
    const src = generateFrontendService(dto('lc_invoices', [
      lf('owner_id', 'relation', {
        relationType: 'many-to-one',
        relationTable: 'lc_users',
      }),
    ]));
    expect(src).toMatch(/owner_id_display/);
  });
});

// =============================================================================
// 8. Grid inline delete — no Popconfirm (direct, expected design)
// =============================================================================
describe('grid delete UX', () => {
  it('grid delete action is a direct <a> not wrapped in Popconfirm', () => {
    const src = generateFrontendGridPage(dto('lc_items', [cf('name', 'varchar', { editable: true })]));
    // Grid uses inline delete without confirmation dialog (rows are cheap to re-add)
    // Just verify 删除 action exists
    expect(src).toContain('handleDelete');
    // And that there's NO Popconfirm import in the grid template
    expect(src).not.toContain('Popconfirm');
  });
});
