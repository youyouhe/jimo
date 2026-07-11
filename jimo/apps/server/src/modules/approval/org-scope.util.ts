export interface DeptNode {
  id: string;
  parentId: string | null;
}

/** BFS collecting `rootId` plus every descendant, given the full department set. */
export function collectSubtree(all: DeptNode[], rootId: string): string[] {
  const childrenByParent = new Map<string, string[]>();
  for (const d of all) {
    if (!d.parentId) continue;
    if (!childrenByParent.has(d.parentId)) childrenByParent.set(d.parentId, []);
    childrenByParent.get(d.parentId)!.push(d.id);
  }
  const result: string[] = [];
  const queue = [rootId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    queue.push(...(childrenByParent.get(id) ?? []));
  }
  return result;
}

/** Walk parentId up to the root ancestor (the "company" anchor — see CONTEXT.md's Org Scope). */
export function findRootAncestor(all: DeptNode[], startId: string): DeptNode | undefined {
  const deptMap = new Map(all.map((d) => [d.id, d]));
  let current = deptMap.get(startId);
  if (!current) return undefined;
  const seen = new Set<string>();
  while (current.parentId && deptMap.has(current.parentId) && !seen.has(current.id)) {
    seen.add(current.id);
    current = deptMap.get(current.parentId)!;
  }
  return current;
}
