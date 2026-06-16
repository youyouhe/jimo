import type { Edge, Node } from '@xyflow/react';
import type { ErGraphNode, ErNodeRole, ErRelationType } from '../../../services/autocode';

/** ReactFlow 节点:type='entity',data=ErGraphNode */
export type ErFlowNode = Node<ErGraphNode, 'entity'>;

/** ReactFlow 边 */
export type ErFlowEdge = Edge;

/** relationType → 边样式映射(颜色/虚线/标签),layout.ts 与调试共用 */
export const RELATION_STYLE: Record<
  ErRelationType,
  { color: string; dashed: boolean; label: string }
> = {
  'many-to-one': { color: '#1677ff', dashed: false, label: 'N:1' },
  'many-to-many': { color: '#722ed1', dashed: true, label: 'N:N' },
  'one-to-many': { color: '#13c2c2', dashed: false, label: '1:N' },
};

/** node 角色 → 边框/标题颜色 */
export const ROLE_COLOR: Record<ErNodeRole, string> = {
  main: '#fa8c16', // 橙 — 主表 / 独立业务实体
  child: '#13c2c2', // 青 — 1:N 子表
  junction: '#722ed1', // 紫 — N:N 关联表(中间表)
  'child-junction': '#13c2c2', // 边框由 er-graph.css 跑马灯动画接管;Handle/标题用青
};
