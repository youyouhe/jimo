/**
 * L0 — Route lifecycle (Reference Model + Scoreboard for `.umirc.ts` manipulation).
 *
 * Guards the route bugs we hit during grid development:
 *  - regenerating a document module accumulated duplicate `/create` + `/:id` routes
 *  - deleting a module orphaned those detail routes (and detail.tsx/map.tsx files)
 *  - a naive prefix match would have wrongly stripped `lc/order` routes when
 *    deleting `lc/order-item` (or vice-versa)
 *
 * `stripTableRouteBlocks` is a pure function (extracted from EntrypointService
 * precisely so it can be tested here without DI or a filesystem).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripTableRouteBlocks } from './route-lifecycle';

/** A representative `.umirc.ts` fragment with several tables + edge cases. */
const UMIRC = `
    { path: '/lc/accounts', name: '会计科目表', icon: 'TableOutlined', component: './lc/accounts/index' },
    { path: '/lc/order', name: '订单', icon: 'TableOutlined', component: './lc/order/index' },
    { path: '/lc/order/create', component: './lc/order/detail', layout: false },
    { path: '/lc/order/:id', component: './lc/order/detail', layout: false },
    { path: '/lc/order-map', name: '订单地图', icon: 'EnvironmentOutlined', component: './lc/order/map' },
    { path: '/lc/order/create', component: 'lc/order/detail', layout: false },
    { path: '/lc/order/:id', component: 'lc/order/detail', layout: false },
    { path: '/lc/order-item', name: '订单明细', icon: 'TableOutlined', component: './lc/order-item/index' },
    { path: '/*', redirect: '/dashboard' },
`;

const countRoutes = (src: string, needle: string): number =>
  (src.match(new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

describe('stripTableRouteBlocks', () => {
  it('removes every route whose component points into the target page dir', () => {
    const out = stripTableRouteBlocks(UMIRC, 'lc/order');
    // index / detail / map / standalone -map all gone
    expect(out).not.toContain('./lc/order/index');
    expect(out).not.toContain('./lc/order/detail');
    expect(out).not.toContain('lc/order/detail'); // old broken form (no ./) must also clear
    expect(out).not.toContain('./lc/order/map');
  });

  it('clears duplicate detail routes left by older regenerations', () => {
    // UMIRC has 2× create + 2× :id for order (one with ./ one without)
    const before = countRoutes(UMIRC, 'lc/order/detail');
    expect(before).toBe(4);
    const out = stripTableRouteBlocks(UMIRC, 'lc/order');
    expect(countRoutes(out, 'lc/order/detail')).toBe(0);
  });

  it('does NOT touch routes of other tables', () => {
    const out = stripTableRouteBlocks(UMIRC, 'lc/order');
    expect(out).toContain('./lc/accounts/index');
    expect(out).toContain("'./lc/order-item/index'");
  });

  it('prefix safety: stripping "lc/order" leaves "lc/order-item" intact', () => {
    // The trailing-slash needle must prevent `lc/order` from matching `lc/order-item`.
    const out = stripTableRouteBlocks(UMIRC, 'lc/order');
    expect(countRoutes(out, "'/lc/order-item'")).toBe(1);
    expect(out).toContain("'./lc/order-item/index'");
    // And the inverse must hold too.
    const out2 = stripTableRouteBlocks(UMIRC, 'lc/order-item');
    expect(out2).toContain('./lc/order/index');
    expect(out2).not.toContain('./lc/order-item/index');
  });

  it('does NOT remove redirect / non-component blocks', () => {
    const out = stripTableRouteBlocks(UMIRC, 'lc/order');
    expect(out).toContain("redirect: '/dashboard'");
  });

  it('is idempotent', () => {
    const once = stripTableRouteBlocks(UMIRC, 'lc/order');
    const twice = stripTableRouteBlocks(once, 'lc/order');
    expect(twice).toBe(once);
  });

  it('handles the realistic regenerate-then-delete lifecycle', () => {
    // Simulate: generate adds a clean set; regenerating strips the old (incl.
    // duplicates) then the caller re-adds one fresh set. Stripping must remove
    // ALL old order blocks so re-adding does not accumulate.
    const regenerated = UMIRC + UMIRC; // double the cruft
    const stripped = stripTableRouteBlocks(regenerated, 'lc/order');
    const fresh = `${stripped}
    { path: '/lc/order', name: '订单', icon: 'TableOutlined', component: './lc/order/index' },
    { path: '/lc/order/create', component: './lc/order/detail', layout: false },
    { path: '/lc/order/:id', component: './lc/order/detail', layout: false },`;
    // Exactly ONE detail route remains (the freshly-added one), not the accumulated duplicates.
    expect(countRoutes(fresh, "'/lc/order/create'")).toBe(1);
    expect(countRoutes(fresh, "'/lc/order/:id'")).toBe(1);
  });
});

/**
 * Source-text regression guards for the one-off string fixes that are awkward
 * to exercise behaviorally without a full filesystem. These pin the exact fixes
 * so a careless refactor can't silently revert them. (Behavioral coverage of
 * delete/update is an L2 integration concern; these are cheap insurance.)
 */
describe('route/file-cleanup regression guards (source text)', () => {
  const entrypointSrc = readFileSync(resolve(__dirname, 'entrypoint.service.ts'), 'utf-8');
  const historySrc = readFileSync(resolve(__dirname, 'history.service.ts'), 'utf-8');

  it('document detail route components keep the "./" prefix (else Umi 404s)', () => {
    expect(entrypointSrc).toContain("'./${n.pageDir}/detail'");
    expect(entrypointSrc).not.toMatch(/component:\s+'\$\{n\.pageDir\}\/detail'/);
  });

  it('delete path list includes detail.tsx and map.tsx (no orphan files)', () => {
    expect(historySrc).toContain('${n.pageDir}/detail.tsx');
    expect(historySrc).toContain('${n.pageDir}/map.tsx');
  });
});
