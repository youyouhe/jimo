/**
 * L0 — Generator output contract tests (Reference Model + Scoreboard for the
 * autocode frontend generators).
 *
 * The generator is this project's highest-risk surface: one bug pollutes every
 * generated module. Instead of "generate a table and click around", we feed a
 * matrix of representative DTOs to the generators and assert the emitted source
 * satisfies the contracts we learned the hard way during grid development.
 *
 * Each `it` block maps to a real bug we fixed — see docs/测试框架方案.md §2.
 */
// `@faker-js/faker` is ESM-only and is pulled in transitively (field-utils) by
// the generators. The page generators never call faker (it's only used by the
// mock-data path), so stub it with a deep no-op mock to keep the suite CJS-safe.
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
  generateFrontendCalendarPage,
  generateFrontendKanbanPage,
} from './autocode-frontend-generators';
import { toPascalCase, singularize } from './autocode-field-utils';
import type { AutoCodeFieldType } from './dto/autocode.dto';

/** Build a field with the same defaults the DTO class uses. */
const f = (name: string, type: AutoCodeFieldType, extra: Record<string, any> = {}): any => ({
  name,
  type,
  description: name,
  editable: true,
  creatable: true,
  searchable: true,
  listable: true,
  required: false,
  ...extra,
});

/** Dispatch page generation exactly like autocode.service does. */
function generatePage(dto: any): string {
  if (dto.pageType === 'document') return generateFrontendDocumentListPage(dto);
  if (dto.pageType === 'grid') return generateFrontendGridPage(dto);
  if (dto.pageType === 'calendar') return generateFrontendCalendarPage(dto);
  if (dto.pageType === 'kanban') return generateFrontendKanbanPage(dto);
  return generateFrontendPage(dto);
}

/** Expected relation-option import name for a many-to-one field. */
const relOptFn = (relationTable: string): string =>
  `get${toPascalCase(singularize(relationTable))}Options`;

describe('L0 generator contract: grid page', () => {
  const gridSimple = {
    tableName: 'g_simple',
    description: '简单网格',
    pageType: 'grid',
    fields: [f('name', 'varchar', { required: true }), f('qty', 'integer'), f('active', 'boolean')],
  };
  const gridFull = {
    tableName: 'g_full',
    description: '全字段网格',
    pageType: 'grid',
    agentConfig: { enabled: true },
    fields: [
      f('name', 'varchar', { required: true }),
      f('price', 'decimal'),
      f('category', 'dict', { dictType: 'product_category' }),
      f('happened_at', 'timestamp'),
      f('supplier_id', 'relation', { relationType: 'many-to-one', relationTable: 'suppliers', relationDisplayField: 'name' }),
      f('cover', 'image'),
      f('total', 'calculated', { resultType: 'number' }),
      f('location', 'point'),
    ],
  };
  const gridTimestampOnly = {
    tableName: 'g_ts',
    description: '时间戳网格',
    pageType: 'grid',
    fields: [f('name', 'varchar', { required: true }), f('at', 'timestamp')],
  };

  it('paginates at the backend pageSize cap (no pageSize: 9999)', () => {
    const src = generateFrontendGridPage(gridSimple as any);
    expect(src).toContain('const PAGE_SIZE = 100');
    expect(src).not.toMatch(/pageSize:\s*9999/);
    expect(src).not.toMatch(/pageSize:\s*\d{4,}/); // no 4+ digit pageSize anywhere
  });

  it('auto-creates new rows as the user types (no silent loss on refresh)', () => {
    const src = generateFrontendGridPage(gridSimple as any);
    expect(src).toContain('scheduleCreate');
    expect(src).toContain('scheduleCreate(record)');
    // onValuesChange must route NEW rows to scheduleCreate (uses stable __key to
    // avoid EditableProTable edit-state desync when the server id is assigned).
    expect(src).toMatch(/if \(newIds\.has\(record\.__key\)\)\s*scheduleCreate/);
  });

  it('imports + converts dayjs for timestamp fields', () => {
    const withTs = generateFrontendGridPage(gridTimestampOnly as any);
    expect(withTs).toMatch(/import dayjs from 'dayjs'/);
    expect(withTs).toContain('TIMESTAMP_FIELDS');
    expect(withTs).toMatch(/dayjs\(r\[k\]\)/);
  });

  it('does NOT import dayjs when there are no timestamp fields', () => {
    const noTs = generateFrontendGridPage(gridSimple as any);
    expect(noTs).not.toMatch(/import dayjs from 'dayjs'/);
    expect(noTs).not.toContain('TIMESTAMP_FIELDS');
  });

  it('imports the relation-option function for m2o relation fields', () => {
    const src = generateFrontendGridPage(gridFull as any);
    expect(src).toContain(relOptFn('suppliers'));
  });

  it('does not leak a relation option fn when there is no relation', () => {
    const src = generateFrontendGridPage(gridSimple as any);
    expect(src).not.toMatch(/get\w+Options/);
  });

  it('emits the agent panel iff agentConfig.enabled', () => {
    const on = generateFrontendGridPage(gridFull as any);
    expect(on).toContain('EntityAgentPanel');
    expect(on).toContain('RobotOutlined');
    expect(on).toContain('AI 助手');
    expect(on).toContain('businessType="lc_g_full"');

    const off = generateFrontendGridPage(gridSimple as any);
    expect(off).not.toContain('EntityAgentPanel');
    expect(off).not.toContain('RobotOutlined');
    expect(off).not.toContain('AI 助手');
  });

  it('defaults new-row timestamp cells to null (not "" → Invalid Date)', () => {
    const src = generateFrontendGridPage(gridTimestampOnly as any);
    // emptyDefaults for a timestamp field must be `null`, never ''.
    expect(src).toMatch(/at:\s*null/);
    expect(src).not.toMatch(/at:\s*''/);
  });
});

describe('L0 generator contract: all pageTypes emit valid source', () => {
  const cases = [
    { tableName: 'g_basic', pageType: 'grid', fields: [f('name', 'varchar', { required: true })] },
    { tableName: 'l_basic', pageType: 'list', fields: [f('name', 'varchar', { required: true })] },
    { tableName: 'd_basic', pageType: 'document', fields: [f('name', 'varchar', { required: true })] },
    { tableName: 'c_basic', pageType: 'calendar', fields: [f('name', 'varchar', { required: true }), f('at', 'timestamp')] },
    { tableName: 'k_basic', pageType: 'kanban', fields: [f('name', 'varchar', { required: true }), f('stage', 'dict', { dictType: 'k_basic_stage', kanbanGroup: true })] },
  ];

  it.each(cases)('$pageType page is non-empty and references its service module', (dto: any) => {
    const src = generatePage(dto);
    expect(src.length).toBeGreaterThan(200);
    // every pageType imports the generated service for its table
    expect(src).toMatch(/from '@\/services\/lc\//);
  });

  it('document pageType also generates a detail page', () => {
    const dto: any = {
      tableName: 'd_doc',
      description: '单据',
      pageType: 'document',
      fields: [f('name', 'varchar', { required: true })],
    };
    const list = generateFrontendDocumentListPage(dto);
    const detail = generateFrontendDocumentPage(dto);
    expect(list).toContain('history');
    expect(detail).toContain('useParams');
  });
});

describe('L0 generator contract: calendar page', () => {
  const calendarBasic = {
    tableName: 'c_basic',
    description: '日程',
    pageType: 'calendar',
    fields: [
      f('title', 'varchar', { required: true, calendarTitle: true }),
      f('start_at', 'timestamp', { calendarStart: true }),
      f('end_at', 'timestamp', { calendarEnd: true }),
    ],
  };

  it('resolves the explicitly-marked start/end/title fields, not a heuristic fallback', () => {
    const src = generateFrontendCalendarPage(calendarBasic as any);
    expect(src).toContain('r.start_at');
    expect(src).toContain('r.end_at');
    expect(src).toContain('r.title');
  });

  it('falls back to the first timestamp field when no field is marked calendarStart', () => {
    const dto: any = {
      tableName: 'c_fallback',
      description: '无显式开始日期',
      pageType: 'calendar',
      fields: [f('name', 'varchar', { required: true }), f('happened_at', 'timestamp')],
    };
    const src = generateFrontendCalendarPage(dto);
    expect(src).toContain('r.happened_at');
  });

  it('never PATCHes/POSTs any new "move" endpoint — start/end change only via the normal edit modal', () => {
    const src = generateFrontendCalendarPage(calendarBasic as any);
    expect(src).not.toMatch(/\/move\b/);
  });
});

describe('L0 generator contract: kanban page', () => {
  const kanbanBasic = {
    tableName: 'k_basic',
    description: '任务看板',
    pageType: 'kanban',
    fields: [
      f('title', 'varchar', { required: true, kanbanTitle: true }),
      f('stage', 'dict', { dictType: 'k_basic_stage', kanbanGroup: true }),
      f('assignee', 'varchar'),
    ],
  };

  it('resolves the kanbanGroup dict field and its dictType for column loading', () => {
    const src = generateFrontendKanbanPage(kanbanBasic as any);
    expect(src).toContain("getDictDetailsByType('k_basic_stage')");
    expect(src).toContain('r.stage');
  });

  it('drag-drop reuses the existing update API — no dedicated move endpoint', () => {
    const src = generateFrontendKanbanPage(kanbanBasic as any);
    expect(src).toContain('updateKBasic(record.id, { stage: targetValue }');
    expect(src).not.toMatch(/\/move\b/);
  });

  it('excludes the group field from the edit modal (group changes are drag-only)', () => {
    const src = generateFrontendKanbanPage(kanbanBasic as any);
    // The group field must not appear as a ProForm* field in the modal body.
    expect(src).not.toMatch(/name="stage"/);
  });

  it('card title reflects kanbanTitle field, and falls back to first listable varchar otherwise', () => {
    const withTitle = generateFrontendKanbanPage(kanbanBasic as any);
    expect(withTitle).toContain('r.title');

    const noExplicitTitle: any = {
      tableName: 'k_fallback',
      description: '无显式标题',
      pageType: 'kanban',
      fields: [
        f('name', 'varchar', { required: true }),
        f('stage', 'dict', { dictType: 'k_fallback_stage', kanbanGroup: true }),
      ],
    };
    const src = generateFrontendKanbanPage(noExplicitTitle);
    expect(src).toContain('r.name');
  });

  it('renders non-title listable fields on the card body', () => {
    const src = generateFrontendKanbanPage(kanbanBasic as any);
    expect(src).toContain('r.assignee');
  });

  it('uses @dnd-kit/core, not a hand-rolled HTML5 DnD implementation', () => {
    const src = generateFrontendKanbanPage(kanbanBasic as any);
    expect(src).toContain("from '@dnd-kit/core'");
    expect(src).not.toMatch(/onDragOver=|onDrop=/);
  });
});
