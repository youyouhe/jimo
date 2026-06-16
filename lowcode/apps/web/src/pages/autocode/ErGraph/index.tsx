import { memo, useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './er-graph.css';
import { Input, Select, Button, Space, Spin, Empty, Typography, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  getErGraph,
  listAllPackages,
  type ErGraphData,
} from '../../../services/autocode';
import { layoutErGraph } from './layout';
import { EntityNode } from './EntityNode';
import type { ErFlowEdge, ErFlowNode } from './types';

const { Text } = Typography;

const nodeTypes = { entity: EntityNode };

function ErGraphInner() {
  const [raw, setRaw] = useState<ErGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [packageId, setPackageId] = useState<string | undefined>(undefined);
  const [packages, setPackages] = useState<Array<{ id: string; name: string }>>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ErFlowEdge>([]);

  const load = useCallback(async (pid?: string) => {
    setLoading(true);
    try {
      const data = await getErGraph(pid);
      setRaw(data);
    } catch (e: any) {
      message.error(e?.message || '加载 ER 图失败');
      setRaw({ nodes: [], edges: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(packageId);
  }, [packageId, load]);

  useEffect(() => {
    listAllPackages()
      .then((list) => setPackages(list.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
  }, []);

  // 关键字过滤 + dagre 布局
  useEffect(() => {
    if (!raw) return;
    const kw = keyword.trim().toLowerCase();
    let filteredNodes = raw.nodes;
    let filteredEdges = raw.edges;
    if (kw) {
      // 种子:名字/描述匹配关键字的节点
      const seeds = new Set(
        raw.nodes
          .filter(
            (n) =>
              n.table.toLowerCase().includes(kw) ||
              (n.description || '').toLowerCase().includes(kw),
          )
          .map((n) => n.id),
      );
      // 沿 edges 无向 BFS 扩展:显示与种子有直接/间接关系的全部实体(关系邻域)。
      // 例如搜 student → 展开 family(子表)、score(子表/中间表)、course(score 的 m2m 关联)。
      const adjacency = new Map<string, Set<string>>();
      for (const e of raw.edges) {
        if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
        if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
        adjacency.get(e.source)!.add(e.target);
        adjacency.get(e.target)!.add(e.source);
      }
      const visited = new Set(seeds);
      const queue = [...seeds];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nb of adjacency.get(cur) ?? []) {
          if (!visited.has(nb)) {
            visited.add(nb);
            queue.push(nb);
          }
        }
      }
      filteredNodes = raw.nodes.filter((n) => visited.has(n.id));
      filteredEdges = raw.edges.filter(
        (e) => visited.has(e.source) && visited.has(e.target),
      );
    }
    const laid = layoutErGraph(filteredNodes, filteredEdges);
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [raw, keyword, setNodes, setEdges]);

  const handleRelayout = useCallback(() => {
    if (!raw) return;
    const laid = layoutErGraph(raw.nodes, raw.edges);
    setNodes(laid.nodes);
    setEdges(laid.edges);
  }, [raw, setNodes, setEdges]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 220px)',
        minHeight: 500,
      }}
    >
      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          placeholder="搜索表名 / 描述"
          allowClear
          style={{ width: 240 }}
          onSearch={setKeyword}
          onChange={(e) => {
            if (!e.target.value) setKeyword('');
          }}
        />
        <Select
          placeholder="按包筛选"
          allowClear
          style={{ width: 200 }}
          value={packageId}
          onChange={(v) => setPackageId(v)}
          options={packages.map((p) => ({ value: p.id, label: p.name }))}
        />
        <Button icon={<ReloadOutlined />} onClick={handleRelayout}>
          重新布局
        </Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {raw ? `${raw.nodes.length} 实体 · ${raw.edges.length} 关系` : ''}
        </Text>
      </Space>

      <div
        style={{
          flex: 1,
          border: '1px solid #f0f0f0',
          borderRadius: 6,
          position: 'relative',
        }}
      >
        {loading ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Spin tip="加载 ER 图..." />
          </div>
        ) : nodes.length === 0 ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Empty description={keyword ? '无匹配实体' : '暂无已生成实体'} />
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            fitView
            minZoom={0.1}
            maxZoom={2}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
            <MiniMap pannable zoomable nodeColor="#1677ff" />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}

const ERGraphTab = memo(function ERGraphTab() {
  return (
    <ReactFlowProvider>
      <ErGraphInner />
    </ReactFlowProvider>
  );
});

export default ERGraphTab;
