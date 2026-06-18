import type { ComponentType } from 'react';

/**
 * path → page-component registry for the KeepAlive workspace.
 *
 * Umi keeps page components in a SEPARATE id → lazy map (`routeComponents`),
 * distinct from the route config (`routes`, which only carries path/id/name/icon
 * — the patched client route tree has NO `.component` field). The generated
 * `.umi/core/route` module is off-limits to import (Umi forbids it), so we source
 * both maps from the sanctioned `useAppData()` runtime API and join them here:
 *
 *     path → id  (from `routes`)   →   component  (from `routeComponents`)
 *
 * This gives the KeepAlive workspace a path → component map it can render
 * directly, independent of Umi's `<Outlet/>`.
 */
const registry = new Map<string, ComponentType<any>>();

/**
 * Populate the registry from Umi's runtime app data. Idempotent: the first call
 * that yields components wins; later calls are no-ops. Safe to call on every
 * render (cheap guard).
 */
export function populateRegistry(
  routes: Record<string, any>,
  routeComponents: Record<string, ComponentType<any>>,
): void {
  if (registry.size > 0) return;
  if (!routes || !routeComponents) return;
  for (const id of Object.keys(routes)) {
    const r = routes[id];
    const comp = routeComponents[id];
    if (r?.path && comp) registry.set(r.path, comp);
  }
}

/** Whether the registry has been populated with at least one component. */
export function isRegistryReady(): boolean {
  return registry.size > 0;
}

/** Get the registered component for a path (undefined if not registered). */
export function getRouteComponent(path: string): ComponentType<any> | undefined {
  return registry.get(path);
}

/** Whether a path has a registered page component. */
export function hasRoute(path: string): boolean {
  return registry.has(path);
}

/** Snapshot of all registered paths — used by sanitize() to drop stale tabs. */
export function getRegisteredPaths(): Set<string> {
  return new Set(registry.keys());
}
