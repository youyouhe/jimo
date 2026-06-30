/**
 * Pure route-lifecycle helpers for `.umirc.ts` manipulation.
 *
 * Extracted from EntrypointService so they can be unit-tested without Nest DI
 * or a filesystem. These are the bug-prone bits: route stripping once caused
 * duplicate document detail routes to accumulate on regenerate and orphan
 * `/create` + `/:id` routes (+ detail.tsx/map.tsx files) on delete.
 */

/**
 * Remove every flat route entry in `.umirc.ts` whose `component` resolves into
 * the given page directory — i.e. `./lc/<kebab>/index`, `./lc/<kebab>/detail`,
 * `./lc/<kebab>/map` (and the standalone `-map` route). The trailing slash in
 * the needle prevents matching a table whose kebab name is a prefix of another
 * (e.g. `lc/order` vs `lc/order-item`). Blocks without a `component` (e.g.
 * redirects) are left untouched, and the `[^{}]` confinement keeps each match
 * to a single block.
 *
 * @param content  full `.umirc.ts` source
 * @param pageDir  e.g. `lc/contracts` (= DerivedNames.pageDir)
 */
export function stripTableRouteBlocks(content: string, pageDir: string): string {
  const needle = `${pageDir}/`; // lc/<kebabName>/
  const escaped = needle.replace(/[.]/g, '\\$&');
  return content.replace(
    new RegExp(
      `\\s*\\{[^{}]*component:\\s*'[^']*${escaped}[^']*'[^{}]*\\},?`,
      'gs',
    ),
    '',
  );
}
