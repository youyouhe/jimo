import type { AutoCodeField } from './dto/autocode.dto';

/**
 * ER 图数据模型与关系解析纯函数。
 *
 * 从 sys_auto_code_histories 的快照(fields jsonb)解析出实体节点与关系边,
 * 供前端 ReactFlow 渲染全局 ER 图。语义与 generateSchema 的关系处理保持一致,
 * 但只产出图结构(nodes/edges),不生成任何代码。
 *
 * 无副作用:无 DB / 无 fs / 无网络,可独立单测。
 */

// ── Input ──
export interface ErHistoryInput {
  tableName: string;
  /** 实体显示名,由 service 层从 sysMenus 查 menu name 填充;缺省回退 tableName */
  description?: string;
  packageName?: string | null;
  fields: AutoCodeField[] | null;
}

// ── Output node ──
export interface ErFieldInfo {
  name: string;
  type: string;
  isPk: boolean;
  isFk: boolean;
  relationTable?: string;
  relationType?: string;
}

export interface ErGraphNode {
  /** 节点 id,等于 tableName(ReactFlow 节点唯一标识) */
  id: string;
  table: string;
  description: string;
  packageName?: string | null;
  fields: ErFieldInfo[];
  /** 隐式子表标记:one-to-many 新建的子表(无独立 history 记录),由 detailFields 合成 */
  isImplicit?: boolean;
  /** 角色:main 主表/独立 | child 1:N 子表 | junction N:N 关联表 */
  role?: ErNodeRole;
}

export type ErRelationType = 'many-to-one' | 'many-to-many' | 'one-to-many';

/** 实体在 ER 图中的角色,决定前端边框颜色 */
export type ErNodeRole = 'main' | 'child' | 'junction' | 'child-junction';

export interface ErGraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: ErRelationType;
  /** 显示标签:N:1 / N:N / 1:N */
  label: string;
}

export interface ErGraph {
  nodes: ErGraphNode[];
  edges: ErGraphEdge[];
}

const RELATION_LABEL: Record<ErRelationType, string> = {
  'many-to-one': 'N:1',
  'many-to-many': 'N:N',
  'one-to-many': '1:N',
};

/**
 * 简单英语复数 → 单数(覆盖 autocode 常见 snake_case 表名)。
 * 与 generateSchema 内部 singularize 用途一致——用于推导 one-to-many 子表名。
 */
function singularize(word: string): string {
  if (!word) return word;
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y'; // categories → category
  if (word.endsWith('ses') || word.endsWith('xes')) return word.slice(0, -2); // classes → class
  if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1); // users → user
  return word;
}

/**
 * 从 history 快照列表构建 ER 图。
 *
 * 关系解析规则(参考 generateSchema line 455-610):
 * - many-to-one:实体 source 有 relation 字段指向 relationTable → edge source→target,N:1
 * - many-to-many:实体 source 有 relation 字段 many-to-many → edge source—target,N:N
 * - one-to-many:实体 source 有 relation 字段 one-to-many
 *     · relationExistingTable=true:target = relationTable(复用已有表)
 *     · 否则:target = `{singularize(source)}_{singularize(field.name)}`(隐式子表)
 *
 * 边去重(同 source+target+relationType 只保留一条);
 * 孤立实体(无 relation 字段)仍作为 node 保留;
 * 仅保留 source 与 target 都在 node 集合中的边(ReactFlow 友好);
 * 自引用(tree 结构)保留。
 */
export function buildErGraph(histories: ErHistoryInput[]): ErGraph {
  const nodes: ErGraphNode[] = [];
  const nodeIds = new Set<string>();

  // 1. Build nodes (去重:同一 tableName 只取一条)
  for (const h of histories) {
    if (!h.tableName || nodeIds.has(h.tableName)) continue;
    nodeIds.add(h.tableName);

    const fields: ErFieldInfo[] = (h.fields || [])
      .filter((f) => f && f.name && !f.removed)
      .map((f) => ({
        name: f.name,
        type: f.type,
        isPk: f.name === 'id',
        isFk: f.type === 'relation',
        relationTable: f.relationTable,
        relationType: f.relationType,
      }));

    nodes.push({
      id: h.tableName,
      table: h.tableName,
      description: h.description || h.tableName,
      packageName: h.packageName ?? null,
      fields,
    });
  }

  // 1b. 为 one-to-many 隐式子表(新建,非 existing)合成虚拟 node。
  // 隐式子表的 schema 拼在主表文件里(如 contract.ts 的 contractDetail),
  // 无独立 history 记录,因此从 detailFields 合成,ER 图才能展示主子关系。
  for (const h of histories) {
    if (!h.tableName || !h.fields) continue;
    const masterSingular = singularize(h.tableName);
    const masterDesc = h.description || h.tableName;
    for (const f of h.fields) {
      if (!f || f.removed || f.type !== 'relation' || f.relationType !== 'one-to-many') continue;
      if (f.relationExistingTable && f.relationTable) continue; // existing table 用真实 node
      const childName = `${masterSingular}_${singularize(f.name)}`;
      if (nodeIds.has(childName)) continue; // 已有真实 node(独立生成过),不覆盖
      nodeIds.add(childName);
      const detailFields = (f.detailFields || []).filter(
        (df) => df && df.name && !df.removed && df.name !== 'id',
      );
      const childFields: ErFieldInfo[] = [
        { name: 'id', type: 'uuid', isPk: true, isFk: false },
        ...detailFields.map((df) => ({
          name: df.name,
          type: df.type,
          isPk: false,
          isFk: false,
        })),
        {
          name: `${masterSingular}_id`,
          type: 'uuid',
          isPk: false,
          isFk: true,
          relationTable: h.tableName,
          relationType: 'many-to-one',
        },
      ];
      nodes.push({
        id: childName,
        table: childName,
        description: f.description || `${masterDesc} · ${f.name}`,
        packageName: h.packageName ?? null,
        fields: childFields,
        isImplicit: true,
      });
    }
  }

  // 2. Build edges (按 source|target|relationType 去重)
  const edgeMap = new Map<string, ErGraphEdge>();

  for (const h of histories) {
    if (!h.tableName || !h.fields) continue;
    const source = h.tableName;

    for (const f of h.fields) {
      if (!f || f.removed || f.type !== 'relation') continue;
      const rt = f.relationType as ErRelationType | undefined;
      if (!rt) continue;

      let target: string | undefined;
      if (rt === 'many-to-one' || rt === 'many-to-many') {
        target = f.relationTable;
      } else if (rt === 'one-to-many') {
        target = f.relationExistingTable && f.relationTable
          ? f.relationTable
          : `${singularize(source)}_${singularize(f.name)}`;
      }
      if (!target) continue;

      const dedupKey = `${source}|${target}|${rt}`;
      if (edgeMap.has(dedupKey)) continue;

      edgeMap.set(dedupKey, {
        id: `${source}__${target}__${rt}`,
        source,
        target,
        relationType: rt,
        label: RELATION_LABEL[rt],
      });
    }
  }

  // 3. 仅保留两端节点都存在的边(过滤指向未生成/系统表的悬空关系)
  const edges = Array.from(edgeMap.values()).filter(
    (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
  );

  // 4. 计算每个 node 的角色(main/child/junction)用于前端上色:
  //    - child:某个 one-to-many 关系的 target(1:N 子表)
  //    - junction:自身含 many-to-many 字段的表(N:N 关联表/中间表)
  //    - main:其余(主表 / 独立业务实体)
  const childTargets = new Set<string>();
  const junctionSources = new Set<string>();
  for (const e of edges) {
    if (e.relationType === 'one-to-many') childTargets.add(e.target);
  }
  for (const h of histories) {
    if (!h.tableName || !h.fields) continue;
    for (const f of h.fields) {
      if (f && !f.removed && f.type === 'relation' && f.relationType === 'many-to-many' && f.relationTable) {
        junctionSources.add(h.tableName);
      }
    }
  }
  for (const node of nodes) {
    const isChild = childTargets.has(node.id);
    const isJunction = junctionSources.has(node.id);
    // 同时是 1:N 子表又含 N:N 字段的表(如成绩表:既是学生-学科中间表,
    // 又作为学生的 1:N 子表关联)→ child-junction,前端用青紫跑马灯边框
    node.role = isChild && isJunction
      ? 'child-junction'
      : isChild
        ? 'child'
        : isJunction
          ? 'junction'
          : 'main';
  }

  return { nodes, edges };
}
