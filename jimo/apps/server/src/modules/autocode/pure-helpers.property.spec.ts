/**
 * L1 — Property tests for the pure helpers the generator/route-lifecycle depend
 * on. Invariants (not examples) — these are the chip-verification "metamorphic
 * / invariant" style: instead of asserting one output, assert a relation that
 * must hold for ALL inputs.
 */
jest.mock('@faker-js/faker', () => {
  const callable = () => 'mock';
  const make = (): any => new Proxy(callable, { get: () => make(), apply: () => 'mock' });
  return { fakerZH_CN: make() };
});

import fc from 'fast-check';
import { deriveNames } from './autocode-field-utils';
import { stripTableRouteBlocks } from './route-lifecycle';

const tableNameArb = fc.tuple(
  fc.constantFrom('order', 'invoice', 'contract', 'voucher', 'shipment', 'payment', 'account', 'product', 'customer', 'ticket', 'price', 'student'),
  fc.constantFrom('', 's', '_log', '_hist', '_draft', '_item'),
).map(([a, b]) => a + b);

describe('L1 property: deriveNames naming invariants', () => {
  it('always derives consistent lc/ kebab paths', () => {
    fc.assert(
      fc.property(tableNameArb, (t) => {
        const n = deriveNames(t);
        expect(n.kebabName).toMatch(/^[a-z0-9-]+$/);
        expect(n.pageDir).toBe(`lc/${n.kebabName}`);
        expect(n.routePath).toBe(`/lc/${n.kebabName}`);
        expect(n.pageComponentPath).toBe(`./lc/${n.kebabName}/index`);
        expect(n.pageMapComponentPath).toBe(`./lc/${n.kebabName}/map`);
      }),
      { numRuns: 200 },
    );
  });
});

describe('L1 property: stripTableRouteBlocks removes only the target', () => {
  // Build a `.umirc.ts` fragment with N random tables, each with index + detail
  // routes, then strip one and assert only it is removed.
  it('strips every route of the target table and leaves all others intact', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(tableNameArb, { minLength: 2, maxLength: 6 }),
        (tables) => {
          const kebabs = tables.map((t) => deriveNames(t).kebabName);
          let content = '';
          for (const k of kebabs) {
            content += `    { path: '/lc/${k}', name: '${k}', icon: 'TableOutlined', component: './lc/${k}/index' },\n`;
            content += `    { path: '/lc/${k}/create', component: './lc/${k}/detail', layout: false },\n`;
            content += `    { path: '/lc/${k}/:id', component: './lc/${k}/detail', layout: false },\n`;
          }
          const target = kebabs[0];
          const out = stripTableRouteBlocks(content, `lc/${target}`);

          // target fully removed (index + both detail routes)
          expect(out).not.toContain(`'./lc/${target}/index'`);
          expect(out).not.toContain(`'./lc/${target}/detail'`);
          expect(out).not.toContain(`/lc/${target}/create`);
          expect(out).not.toContain(`/lc/${target}/:id`);

          // every other table fully intact
          for (const k of kebabs.slice(1)) {
            expect(out).toContain(`'./lc/${k}/index'`);
            expect(out).toContain(`'./lc/${k}/detail'`);
          }
        },
      ),
      { numRuns: 150 },
    );
  });
});
