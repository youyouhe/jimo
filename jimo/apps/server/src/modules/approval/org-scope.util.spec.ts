import { collectSubtree, findRootAncestor, DeptNode } from './org-scope.util';

/**
 * Pins the Org Scope resolution primitives used by CandidateResolutionService
 * (see CONTEXT.md's Org Scope: fixed+subtree, self/parent/company anchors).
 */
describe('org-scope.util', () => {
  // group -> company -> dept -> sub-dept, mirroring a real sys_departments tree.
  const tree: DeptNode[] = [
    { id: 'companyA', parentId: null },
    { id: 'deptFinance', parentId: 'companyA' },
    { id: 'deptSales', parentId: 'companyA' },
    { id: 'subSalesEast', parentId: 'deptSales' },
    { id: 'companyB', parentId: null },
    { id: 'deptOps', parentId: 'companyB' },
  ];

  describe('collectSubtree', () => {
    it('includes the root plus every descendant, regardless of depth', () => {
      expect(new Set(collectSubtree(tree, 'companyA'))).toEqual(
        new Set(['companyA', 'deptFinance', 'deptSales', 'subSalesEast']),
      );
    });

    it('returns just the root when it has no children', () => {
      expect(collectSubtree(tree, 'subSalesEast')).toEqual(['subSalesEast']);
    });

    it('does not cross into a sibling top-level tree', () => {
      const result = collectSubtree(tree, 'companyA');
      expect(result).not.toContain('companyB');
      expect(result).not.toContain('deptOps');
    });

    it('does not loop forever on a (defensively) cyclic input', () => {
      const cyclic: DeptNode[] = [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ];
      expect(new Set(collectSubtree(cyclic, 'a'))).toEqual(new Set(['a', 'b']));
    });
  });

  describe('findRootAncestor', () => {
    it('walks a leaf department up to its top-level company node', () => {
      expect(findRootAncestor(tree, 'subSalesEast')?.id).toBe('companyA');
    });

    it('returns the node itself when it is already top-level', () => {
      expect(findRootAncestor(tree, 'companyB')?.id).toBe('companyB');
    });

    it('returns undefined for an unknown department id', () => {
      expect(findRootAncestor(tree, 'does-not-exist')).toBeUndefined();
    });

    it('does not loop forever on a (defensively) cyclic input', () => {
      const cyclic: DeptNode[] = [
        { id: 'a', parentId: 'b' },
        { id: 'b', parentId: 'a' },
      ];
      expect(findRootAncestor(cyclic, 'a')).toBeDefined();
    });
  });
});
