import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import LogicFlow from '@logicflow/core';
import { BpmnAdapter, BPMNElements, TaskNodeFactory, icons } from '@logicflow/extension';
import { useBpmDesignerStore } from '@/stores/bpm-designer';
import type { LfGraphData, LfNode, LfEdge } from '@/services/bpm';
import DesignerMinimap from './Minimap';
import '@logicflow/core/dist/index.css';
import '@logicflow/extension/lib/style/index.css';

interface DesignerCanvasProps {
  onLfReady?: (lf: LogicFlow) => void;
}

export interface DesignerCanvasHandle {
  lf: LogicFlow | null;
}

const DesignerCanvas = forwardRef<DesignerCanvasHandle, DesignerCanvasProps>(
  function DesignerCanvas({ onLfReady }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const lfRef = useRef<LogicFlow | null>(null);
    const [lfReady, setLfReady] = useState(false);

    const selectNode = useBpmDesignerStore((s) => s.selectNode);
    const setLfJson = useBpmDesignerStore((s) => s.setLfJson);
    const updateNode = useBpmDesignerStore((s) => s.updateNode);
    const updateEdge = useBpmDesignerStore((s) => s.updateEdge);
    const addNode = useBpmDesignerStore((s) => s.addNode);
    const addEdge = useBpmDesignerStore((s) => s.addEdge);
    const removeNode = useBpmDesignerStore((s) => s.removeNode);
    const removeEdge = useBpmDesignerStore((s) => s.removeEdge);

    useImperativeHandle(ref, () => ({ lf: lfRef.current }));

    const syncToStore = useCallback((lf: LogicFlow) => {
      try {
        const rawData = lf.getGraphRawData();
        if (rawData) {
          const graph: LfGraphData = {
            nodes: (rawData.nodes || []).map((n: any) => ({
              id: n.id, type: n.type || '', x: n.x || 0, y: n.y || 0,
              properties: { ...(n.properties || {}) }, text: n.text,
            })),
            edges: (rawData.edges || []).map((e: any) => ({
              id: e.id, type: e.type || '',
              sourceNodeId: e.sourceNodeId || '', targetNodeId: e.targetNodeId || '',
              properties: { ...(e.properties || {}) }, text: e.text,
            })),
          };
          setLfJson(graph);
        }
      } catch { /* ignore */ }
    }, [setLfJson]);

    // Initialize LogicFlow only after container has non-zero size
    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const init = () => {
        if (lfRef.current) return; // already initialized
        const { offsetWidth, offsetHeight } = container;
        if (offsetWidth === 0 || offsetHeight === 0) return; // not ready yet

        const lf = new LogicFlow({
          container,
          grid: { size: 20, visible: true, type: 'dot', config: { color: '#e0e0e0', thickness: 1 } },
          keyboard: { enabled: true },
          snapline: true,
          history: true,
          isSilentMode: false,
          stopScrollGraph: false,
          stopZoomGraph: false,
          animation: true,
          plugins: [BpmnAdapter, BPMNElements],
        });

        lfRef.current = lf;
        lf.register(TaskNodeFactory('bpmn:scriptTask', icons.scriptTaskIcon));

        // Always call render() — LogicFlow 2.x requires it to initialize SVG (grid, canvas)
        const storedGraph = useBpmDesignerStore.getState().lfJson;
        try {
          lf.render(storedGraph?.nodes?.length ? storedGraph as any : { nodes: [], edges: [] });
        } catch { /* ignore */ }

        lf.on('node:click', ({ data }: any) => { if (data?.id) selectNode(data.id); });
        lf.on('edge:click', ({ data }: any) => { if (data?.id) selectNode(data.id); });
        lf.on('blank:click', () => selectNode(null));
        lf.on('node:add', ({ data }: any) => {
          if (data?.id) {
            addNode({ id: data.id, type: data.type || '', x: data.x || 0, y: data.y || 0, properties: { ...(data.properties || {}) }, text: data.text });
            selectNode(data.id);
          }
        });
        lf.on('node:delete', ({ data }: any) => { if (data?.id) removeNode(data.id); });
        lf.on('edge:add', ({ data }: any) => {
          if (data?.id) addEdge({ id: data.id, type: data.type || '', sourceNodeId: data.sourceNodeId || '', targetNodeId: data.targetNodeId || '', properties: { ...(data.properties || {}) }, text: data.text });
        });
        lf.on('edge:delete', ({ data }: any) => { if (data?.id) removeEdge(data.id); });
        lf.on('properties:change', ({ data }: any) => { if (data?.id) updateNode(data.id, data.properties); });
        lf.on('edge:properties:change', ({ data }: any) => { if (data?.id) updateEdge(data.id, data.properties); });
        lf.on('transform:change', () => syncToStore(lf));

        if (onLfReady) onLfReady(lf);
        setLfReady(true);
        observer.disconnect(); // stop watching once initialized
      };

      // Use ResizeObserver to wait for container to get actual size
      const observer = new ResizeObserver(() => {
        if (!lfRef.current) {
          init(); // first init when size is available
        } else {
          // re-measure on resize after init
          const { offsetWidth, offsetHeight } = container;
          if (offsetWidth > 0 && offsetHeight > 0) {
            lfRef.current.resize(offsetWidth, offsetHeight);
          }
        }
      });
      observer.observe(container);

      // Also try immediately (container may already have size)
      init();

      return () => {
        observer.disconnect();
        if (lfRef.current) {
          try { lfRef.current.destroy(); } catch { /* ignore */ }
          lfRef.current = null;
        }
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Separate ResizeObserver for post-init resize (after init completes)
    useEffect(() => {
      if (!lfReady) return;
      const container = containerRef.current;
      if (!container) return;
      const observer = new ResizeObserver(() => {
        if (lfRef.current) {
          const { offsetWidth, offsetHeight } = container;
          if (offsetWidth > 0 && offsetHeight > 0) lfRef.current.resize(offsetWidth, offsetHeight);
        }
      });
      observer.observe(container);
      return () => observer.disconnect();
    }, [lfReady]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
      e.preventDefault();
      const lf = lfRef.current;
      if (!lf) return;

      const nodeType = e.dataTransfer.getData('application/bpmn-node-type');
      if (!nodeType) return;

      const point = lf.getPointByClient({ x: e.clientX, y: e.clientY });
      const canvasPos = point?.canvasOverlayPosition || { x: e.clientX, y: e.clientY };
      const defaultName = nodeTypeToDefaultName(nodeType);

      lf.addNode({
        type: nodeType,
        x: canvasPos.x,
        y: canvasPos.y,
        properties: { name: defaultName, nodeType },
        text: { x: canvasPos.x, y: canvasPos.y, value: defaultName },
      });
    }, []);

    return (
      <div
        ref={containerRef}
        style={{ position: 'absolute', inset: 0 }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <DesignerMinimap lf={lfRef.current} visible />
      </div>
    );
  },
);

function nodeTypeToDefaultName(nodeType: string): string {
  const map: Record<string, string> = {
    'bpmn:startEvent': 'Start',
    'bpmn:endEvent': 'End',
    'bpmn:userTask': 'User Task',
    'bpmn:scriptTask': 'Script Task',
    'bpmn:exclusiveGateway': 'Gateway',
    'bpmn:parallelGateway': 'Gateway',
  };
  return map[nodeType] || nodeType;
}

export default DesignerCanvas;
