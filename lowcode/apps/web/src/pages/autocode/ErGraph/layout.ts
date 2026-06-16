import dagre from '@dagrejs/dagre';
import { MarkerType } from '@xyflow/react';
import type {
  ErGraphEdge,
  ErGraphNode,
  ErRelationType,
} from '../../../services/autocode';
import { RELATION_STYLE, type ErFlowEdge, type ErFlowNode } from './types';

const NODE_WIDTH = 240;
const NODE_HEIGHT = 180;

/**
 * 用 dagre 计算节点位置,把后端 ErGraphNode/ErGraphEdge 转换为带 position 的
 * ReactFlow node/edge。纯函数:输入确定 → 输出确定,可独立单测。
 */
export function layoutErGraph(
  nodes: ErGraphNode[],
  edges: ErGraphEdge[],
): { nodes: ErFlowNode[]; edges: ErFlowEdge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 120, marginx: 40, marginy: 40 });

  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of edges) {
    g.setEdge(e.source, e.target);
  }

  dagre.layout(g);

  const flowNodes: ErFlowNode[] = nodes.map((n) => {
    const pos = g.node(n.id);
    return {
      id: n.id,
      type: 'entity',
      position: {
        x: (pos?.x ?? 0) - NODE_WIDTH / 2,
        y: (pos?.y ?? 0) - NODE_HEIGHT / 2,
      },
      data: n,
    };
  });

  const flowEdges: ErFlowEdge[] = edges.map((e) => {
    const style = edgeStyleFor(e.relationType);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'smoothstep',
      label: style.label,
      labelStyle: { fill: style.color, fontWeight: 600 },
      labelBgPadding: [6, 2] as [number, number],
      labelBgStyle: { fill: '#fff' },
      style: {
        stroke: style.color,
        strokeWidth: 1.5,
        strokeDasharray: style.dashed ? '6 4' : undefined,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: style.color },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

/** relationType → 样式(单独导出,不依赖 dagre,便于单测) */
export function edgeStyleFor(relationType: ErRelationType) {
  return RELATION_STYLE[relationType] ?? RELATION_STYLE['many-to-one'];
}
