import { buildErGraph, type ErHistoryInput } from './er-graph.util';
import type { AutoCodeField } from './dto/autocode.dto';

/** 构造一个 AutoCodeField,只需提供 name,其余用合理默认值,可覆盖 */
function makeField(overrides: Partial<AutoCodeField> & { name: string }): AutoCodeField {
  return {
    type: 'varchar',
    required: false,
    unique: false,
    description: '',
    searchable: true,
    listable: true,
    creatable: true,
    editable: true,
    ...overrides,
  };
}

function idField(): AutoCodeField {
  return makeField({ name: 'id', type: 'uuid', required: true });
}

describe('buildErGraph', () => {
  describe('nodes', () => {
    it('builds one node per table', () => {
      const inputs: ErHistoryInput[] = [
        { tableName: 'users', fields: [idField()] },
        { tableName: 'orders', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.nodes).toHaveLength(2);
      expect(graph.nodes.map((n) => n.id).sort()).toEqual(['orders', 'users']);
    });

    it('falls back description to tableName when not provided', () => {
      const graph = buildErGraph([{ tableName: 'users', fields: [idField()] }]);
      expect(graph.nodes[0]!.description).toBe('users');
    });

    it('marks the id field as PK', () => {
      const graph = buildErGraph([
        {
          tableName: 'users',
          fields: [idField(), makeField({ name: 'email', type: 'varchar' })],
        },
      ]);
      const fields = graph.nodes[0]!.fields;
      expect(fields.find((f) => f.name === 'id')?.isPk).toBe(true);
      expect(fields.find((f) => f.name === 'email')?.isPk).toBe(false);
    });

    it('marks relation fields as FK', () => {
      const graph = buildErGraph([
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({ name: 'user_id', type: 'relation', relationType: 'many-to-one', relationTable: 'users' }),
          ],
        },
        { tableName: 'users', fields: [idField()] },
      ]);
      const orderFields = graph.nodes.find((n) => n.id === 'orders')!.fields;
      expect(orderFields.find((f) => f.name === 'user_id')?.isFk).toBe(true);
    });

    it('excludes removed (soft-deleted) fields', () => {
      const graph = buildErGraph([
        {
          tableName: 'users',
          fields: [idField(), makeField({ name: 'legacy', type: 'varchar', removed: true })],
        },
      ]);
      expect(graph.nodes[0]!.fields.map((f) => f.name)).toEqual(['id']);
    });

    it('keeps isolated entities (no relation fields) as nodes', () => {
      const graph = buildErGraph([{ tableName: 'logs', fields: [idField()] }]);
      expect(graph.nodes).toHaveLength(1);
      expect(graph.edges).toHaveLength(0);
    });

    it('dedupes nodes by tableName (keeps first)', () => {
      const graph = buildErGraph([
        { tableName: 'users', fields: [idField()] },
        { tableName: 'users', fields: [idField()] },
      ]);
      expect(graph.nodes).toHaveLength(1);
    });
  });

  describe('edges — many-to-one (N:1)', () => {
    it('creates a many-to-one edge from FK table to target table', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({ name: 'user_id', type: 'relation', relationType: 'many-to-one', relationTable: 'users' }),
          ],
        },
        { tableName: 'users', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        source: 'orders',
        target: 'users',
        relationType: 'many-to-one',
        label: 'N:1',
      });
    });
  });

  describe('edges — many-to-many (N:N)', () => {
    it('creates a many-to-many edge between the two tables', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'products',
          fields: [
            idField(),
            makeField({ name: 'tags', type: 'relation', relationType: 'many-to-many', relationTable: 'tags' }),
          ],
        },
        { tableName: 'tags', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        source: 'products',
        target: 'tags',
        relationType: 'many-to-many',
        label: 'N:N',
      });
    });
  });

  describe('edges — one-to-many (1:N)', () => {
    it('derives child table name as singularize(master)_singularize(field) for new child', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({ name: 'items', type: 'relation', relationType: 'one-to-many', detailFields: [idField()] }),
          ],
        },
        // 子表名推导:singularize('orders')_singularize('items') = order_item (单数,与 generateSchema 一致)
        { tableName: 'order_item', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        source: 'orders',
        target: 'order_item',
        relationType: 'one-to-many',
        label: '1:N',
      });
    });

    it('uses relationTable as target when relationExistingTable is true', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'teachers',
          fields: [
            idField(),
            makeField({
              name: 'students',
              type: 'relation',
              relationType: 'one-to-many',
              relationExistingTable: true,
              relationTable: 'students',
              relationFkColumn: 'teacher_id',
            }),
          ],
        },
        { tableName: 'students', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ source: 'teachers', target: 'students', label: '1:N' });
    });

    it('handles pluralization rules (categories → category)', () => {
      // singularize('categories') === 'category'
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'categories',
          fields: [
            idField(),
            makeField({ name: 'items', type: 'relation', relationType: 'one-to-many', detailFields: [idField()] }),
          ],
        },
        { tableName: 'category_item', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ source: 'categories', target: 'category_item' });
    });
  });

  describe('edge filtering & dedup', () => {
    it('dedupes edges with same source + target + relationType', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({ name: 'user_id', type: 'relation', relationType: 'many-to-one', relationTable: 'users' }),
            makeField({ name: 'user_id2', type: 'relation', relationType: 'many-to-one', relationTable: 'users' }),
          ],
        },
        { tableName: 'users', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
    });

    it('drops edges whose target has no node (points to non-generated/system table)', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({ name: 'user_id', type: 'relation', relationType: 'many-to-one', relationTable: 'external_users' }),
          ],
        },
        // external_users 没有对应 node
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(0);
      expect(graph.nodes).toHaveLength(1); // orders 仍在
    });

    it('keeps self-referencing edges (tree structure)', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'categories',
          fields: [
            idField(),
            makeField({ name: 'parent_id', type: 'relation', relationType: 'many-to-one', relationTable: 'categories' }),
          ],
        },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({ source: 'categories', target: 'categories' });
    });
  });

  describe('implicit child tables (one-to-many new, no independent history)', () => {
    it('synthesizes a virtual node for an implicit one-to-many child', () => {
      // contract 有 detail 字段(one-to-many 新建,detailFields),无 contract_detail 独立 history
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'contract',
          description: '合同',
          fields: [
            idField(),
            makeField({
              name: 'detail',
              type: 'relation',
              relationType: 'one-to-many',
              description: '合同明细',
              detailFields: [
                makeField({ name: 'item_name', type: 'varchar' }),
                makeField({ name: 'price', type: 'decimal' }),
              ],
            }),
          ],
        },
      ];
      const graph = buildErGraph(inputs);
      // 合成虚拟子表 contract_detail
      expect(graph.nodes.map((n) => n.id)).toContain('contract_detail');
      const child = graph.nodes.find((n) => n.id === 'contract_detail')!;
      expect(child.isImplicit).toBe(true);
      expect(child.description).toBe('合同明细');
      // 字段:id PK + detailFields + contract_id FK
      expect(child.fields.map((f) => f.name)).toEqual(
        expect.arrayContaining(['id', 'item_name', 'price', 'contract_id']),
      );
      expect(child.fields.find((f) => f.name === 'id')?.isPk).toBe(true);
      expect(child.fields.find((f) => f.name === 'contract_id')?.isFk).toBe(true);
      // edge: contract → contract_detail, 1:N
      expect(graph.edges).toHaveLength(1);
      expect(graph.edges[0]).toMatchObject({
        source: 'contract',
        target: 'contract_detail',
        label: '1:N',
      });
    });

    it('does not synthesize implicit node when child already exists as a real entity', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({
              name: 'items',
              type: 'relation',
              relationType: 'one-to-many',
              detailFields: [makeField({ name: 'qty', type: 'integer' })],
            }),
          ],
        },
        {
          tableName: 'order_item',
          fields: [idField(), makeField({ name: 'real_col', type: 'varchar' })],
        },
      ];
      const graph = buildErGraph(inputs);
      const child = graph.nodes.find((n) => n.id === 'order_item')!;
      expect(child.isImplicit).toBeUndefined(); // 用真实 node,不合成
      expect(child.fields.map((f) => f.name)).toContain('real_col'); // 真实字段保留
    });

    it('uses field description for the implicit node name, distinguishes multiple children', () => {
      // order 有两个 one-to-many 子表:details(订单明细)+ performance(履约)
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          description: '订单',
          fields: [
            idField(),
            makeField({
              name: 'details',
              type: 'relation',
              relationType: 'one-to-many',
              description: '订单明细',
              detailFields: [makeField({ name: 'qty', type: 'integer' })],
            }),
            makeField({
              name: 'performance',
              type: 'relation',
              relationType: 'one-to-many',
              description: '履约',
              detailFields: [makeField({ name: 'status', type: 'varchar' })],
            }),
          ],
        },
      ];
      const graph = buildErGraph(inputs);
      const detail = graph.nodes.find((n) => n.id === 'order_detail')!;
      const perf = graph.nodes.find((n) => n.id === 'order_performance')!;
      expect(detail.description).toBe('订单明细');
      expect(perf.description).toBe('履约'); // 不能都显示"订单明细"
    });

    it('falls back to `${master} · ${fieldName}` when field has no description', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'contract',
          description: '合同',
          fields: [
            idField(),
            makeField({
              name: 'items',
              type: 'relation',
              relationType: 'one-to-many',
              detailFields: [makeField({ name: 'x', type: 'varchar' })],
            }),
          ],
        },
      ];
      const graph = buildErGraph(inputs);
      const child = graph.nodes.find((n) => n.id === 'contract_item')!;
      expect(child.description).toBe('合同 · items');
    });
  });

  describe('node roles (color coding)', () => {
    it('marks standalone / master entities as main', () => {
      const graph = buildErGraph([
        {
          tableName: 'users',
          fields: [idField(), makeField({ name: 'email', type: 'varchar' })],
        },
      ]);
      expect(graph.nodes[0]!.role).toBe('main');
    });

    it('marks 1:N child tables as child, master stays main', () => {
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'orders',
          fields: [
            idField(),
            makeField({
              name: 'items',
              type: 'relation',
              relationType: 'one-to-many',
              detailFields: [makeField({ name: 'qty', type: 'integer' })],
            }),
          ],
        },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.nodes.find((n) => n.id === 'order_item')!.role).toBe('child');
      expect(graph.nodes.find((n) => n.id === 'orders')!.role).toBe('main');
    });

    it('marks N:N junction tables (entities with many-to-many fields) as junction', () => {
      // score 通过 m2m 连接 student 和 course → score 是关联表/中间表
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'score',
          fields: [
            idField(),
            makeField({ name: 'student', type: 'relation', relationType: 'many-to-many', relationTable: 'student' }),
            makeField({ name: 'course', type: 'relation', relationType: 'many-to-many', relationTable: 'course' }),
          ],
        },
        { tableName: 'student', fields: [idField()] },
        { tableName: 'course', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.nodes.find((n) => n.id === 'score')!.role).toBe('junction');
      expect(graph.nodes.find((n) => n.id === 'student')!.role).toBe('main');
      expect(graph.nodes.find((n) => n.id === 'course')!.role).toBe('main');
    });

    it('marks a node that is both 1:N child and N:N junction as child-junction', () => {
      // score: m2m 连接 student/course(junction)+ 被 student 作为 1:N 子表(child)
      const inputs: ErHistoryInput[] = [
        {
          tableName: 'student',
          fields: [
            idField(),
            makeField({
              name: 'score',
              type: 'relation',
              relationType: 'one-to-many',
              relationExistingTable: true,
              relationTable: 'score',
              relationFkColumn: 'student',
            }),
          ],
        },
        {
          tableName: 'score',
          fields: [
            idField(),
            makeField({ name: 'student', type: 'relation', relationType: 'many-to-many', relationTable: 'student' }),
            makeField({ name: 'course', type: 'relation', relationType: 'many-to-many', relationTable: 'course' }),
          ],
        },
        { tableName: 'course', fields: [idField()] },
      ];
      const graph = buildErGraph(inputs);
      expect(graph.nodes.find((n) => n.id === 'score')!.role).toBe('child-junction');
      expect(graph.nodes.find((n) => n.id === 'student')!.role).toBe('main');
      expect(graph.nodes.find((n) => n.id === 'course')!.role).toBe('main');
    });
  });
});
