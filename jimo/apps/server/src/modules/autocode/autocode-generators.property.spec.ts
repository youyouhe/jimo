/**
 * L0+ (v2) — Constrained-random property tests for the generators.
 *
 * This is the chip-verification "Constrained Random" idea landed on the
 * project's highest-risk surface: instead of a hand-written fixture matrix, we
 * let fast-check synthesize hundreds of valid AutoCodeDto variants (pageType ×
 * random field-type combinations × agent on/off) and assert the generated source
 * keeps satisfying every contract.
 *
 * Catches combination bugs hand-written fixtures miss — e.g. grid with all
 * fields non-editable, grid with only read-only fields, agent enabled on a
 * grid with zero editable cells, etc.
 */
jest.mock('@faker-js/faker', () => {
  const callable = () => 'mock';
  const make = (): any => new Proxy(callable, { get: () => make(), apply: () => 'mock' });
  return { fakerZH_CN: make() };
});

import fc from 'fast-check';
import {
  generateFrontendPage,
  generateFrontendDocumentListPage,
  generateFrontendGridPage,
} from './autocode-frontend-generators';

function generatePage(dto: any): string {
  if (dto.pageType === 'document') return generateFrontendDocumentListPage(dto);
  if (dto.pageType === 'grid') return generateFrontendGridPage(dto);
  return generateFrontendPage(dto);
}

// --- Arbitraries (constrained to inputs the generator must handle) ---

/** Clean snake_case identifiers built from safe components (no regex dep). */
const identArb = fc.tuple(
  fc.constantFrom('order', 'item', 'price', 'qty', 'tag', 'note', 'flag', 'amount', 'score', 'level', 'title', 'label', 'value', 'count', 'rate', 'stage', 'phase', 'bucket', 'line', 'entry'),
  fc.constantFrom('', '_id', '_name', '_no', '_at', '_date', '_type', '_val', '_key', '_code', '_flag'),
).map(([a, b]) => a + b);

const tableNameArb = fc.tuple(
  fc.constantFrom('order', 'invoice', 'contract', 'voucher', 'shipment', 'payment', 'account', 'product', 'customer', 'ticket'),
  fc.constantFrom('', 's', '_log', '_hist', '_draft'),
).map(([a, b]) => a + b);

const simpleTypeArb = fc.constantFrom(
  'varchar', 'text', 'integer', 'bigint', 'decimal', 'boolean', 'timestamp', 'code', 'calculated',
);

const fieldArb = identArb.chain((name) =>
  fc.record({
    name: fc.constant(name),
    type: simpleTypeArb,
    description: fc.constant(name),
    required: fc.boolean(),
    editable: fc.boolean(),
    creatable: fc.boolean(),
    searchable: fc.boolean(),
    listable: fc.boolean(),
  }),
);

const fieldsArb = fc.uniqueArray(fieldArb, { minLength: 1, maxLength: 8, selector: (f) => f.name });

const dtoArb = fc.record({
  tableName: tableNameArb,
  description: fc.constant('random entity'),
  pageType: fc.constantFrom('list', 'document', 'grid'),
  fields: fieldsArb,
  agentConfig: fc.oneof(fc.constant(undefined), fc.constant({ enabled: true })),
});

describe('L0+ property: generators across a random DTO matrix', () => {
  // Increasing numRuns widens the net; 200 keeps the suite fast.
  const RUNS = 200;

  it('never throws and always emits non-empty source referencing its service module', () => {
    fc.assert(
      fc.property(dtoArb, (dto) => {
        const src = generatePage(dto); // throws → fast-check shrinks & reports
        expect(src.length).toBeGreaterThan(200);
        expect(src).toMatch(/from '@\/services\/lc\//);
      }),
      { numRuns: RUNS },
    );
  });

  it('grid page always paginates within the backend pageSize cap', () => {
    fc.assert(
      fc.property(dtoArb, (dto) => {
        if (dto.pageType !== 'grid') return true;
        const src = generatePage(dto);
        expect(src).toContain('const PAGE_SIZE = 100');
        expect(src).not.toMatch(/pageSize:\s*\d{4,}/);
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('grid page imports dayjs iff there is an EDITABLE timestamp field', () => {
    fc.assert(
      fc.property(dtoArb, (dto) => {
        if (dto.pageType !== 'grid') return true;
        const src = generatePage(dto);
        // The grid only renders/converts EDITABLE timestamp cells; a non-editable
        // timestamp is dropped from the grid, so no dayjs is needed for it.
        const hasTs = dto.fields.some((f: any) => f.type === 'timestamp' && f.editable);
        expect(src.includes("import dayjs from 'dayjs'")).toBe(hasTs);
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('grid page emits the agent panel iff agentConfig.enabled', () => {
    fc.assert(
      fc.property(dtoArb, (dto) => {
        if (dto.pageType !== 'grid') return true;
        const src = generatePage(dto);
        const agentOn = !!dto.agentConfig?.enabled;
        expect(src.includes('EntityAgentPanel')).toBe(agentOn);
        expect(src.includes('RobotOutlined')).toBe(agentOn);
        return true;
      }),
      { numRuns: RUNS },
    );
  });

  it('grid page always auto-creates new rows (scheduleCreate present)', () => {
    fc.assert(
      fc.property(dtoArb, (dto) => {
        if (dto.pageType !== 'grid') return true;
        const src = generatePage(dto);
        expect(src).toContain('scheduleCreate');
        return true;
      }),
      { numRuns: RUNS },
    );
  });
});
