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
  /** Replace the entire canvas with new graph data and fit view. */
  applyGraph: (graph: LfGraphData) => void;
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

    useImperativeHandle(ref, () => ({
      lf: lfRef.current,
      applyGraph: (graph: LfGraphData) => {
        const lf = lfRef.current;
        if (!lf) { console.warn('[DesignerCanvas] applyGraph: lf not ready'); return; }
        try {
          lf.clearData();
          (graph.nodes || []).forEach((n) => lf.addNode(n as any));
          (graph.edges || []).forEach((e) => lf.addEdge(e as any));
          setTimeout(() => { try { lf.fitView(); } catch { /* ignore */ } }, 80);
        } catch (err) {
          console.error('[DesignerCanvas] applyGraph failed:', err);
        }
      },
    }));

    const syncToStore = useCallback((lf: LogicFlow) => {
      try {
        const rawData = lf.getGraphRawData();
        if (rawData != null) {
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

      // Holds the Delete key handler so cleanup can remove it
      let onKeyDown: ((e: KeyboardEvent) => void) | null = null;

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
          edgeType: 'bpmn:sequenceFlow',
          plugins: [BpmnAdapter, BPMNElements],
        });

        lfRef.current = lf;

        // Re-register task nodes with per-type fill colors.
        // TaskNodeFactory returns { type, view, model }; we extend model.getNodeStyle() for colors.
        const coloredTask = (type: string, icon: string, fill: string, stroke: string) => {
          const base = TaskNodeFactory(type, icon);
          const BaseModel = base.model;
          class ColoredModel extends BaseModel {
            getNodeStyle() {
              const style = super.getNodeStyle();
              style.fill = fill;
              style.stroke = stroke;
              style.strokeWidth = 1.5;
              return style;
            }
          }
          return { ...base, model: ColoredModel };
        };

        lf.register(coloredTask('bpmn:userTask',    icons.userTaskIcon,    '#e8f4ff', '#1677ff') as any);
        lf.register(coloredTask('bpmn:scriptTask',  icons.scriptTaskIcon,  '#fff7e6', '#fa8c16') as any);
        lf.register(coloredTask('bpmn:serviceTask', icons.serviceTaskIcon, '#f6ffed', '#52c41a') as any);
        lf.register(coloredTask('bpmn:manualTask',  icons.manualTaskIcon,  '#fff7e6', '#fa8c16') as any);

        // callActivity: use serviceTaskIcon as placeholder; thick border per BPMN spec
        const coloredCallActivity = (type: string, icon: string, fill: string, stroke: string) => {
          const base = TaskNodeFactory(type, icon);
          const BaseModel = base.model;
          class CallActivityModel extends BaseModel {
            getNodeStyle() {
              const style = super.getNodeStyle();
              style.fill = fill;
              style.stroke = stroke;
              style.strokeWidth = 2.5;
              return style;
            }
          }
          return { ...base, model: CallActivityModel };
        };
        lf.register(coloredCallActivity('bpmn:callActivity', icons.serviceTaskIcon, '#f9f0ff', '#722ed1') as any);

        // Patch registered BPMN node model prototypes for per-type colors.
        // setTheme() doesn't reach BPMNElements custom models, so we override getNodeStyle directly.
        const patchNodeColor = (type: string, fill: string, stroke: string) => {
          const registered = (lf as any).graphModel?.modelMap?.get(type);
          if (!registered) return;
          const orig = registered.prototype.getNodeStyle;
          registered.prototype.getNodeStyle = function () {
            const style = orig.call(this);
            style.fill = fill;
            style.stroke = stroke;
            style.strokeWidth = 1.5;
            return style;
          };
        };

        patchNodeColor('bpmn:startEvent',              '#f6ffed', '#52c41a');
        patchNodeColor('bpmn:endEvent',                '#fff1f0', '#ff4d4f');
        patchNodeColor('bpmn:exclusiveGateway',        '#fffbe6', '#faad14');
        patchNodeColor('bpmn:parallelGateway',         '#fffbe6', '#faad14');
        patchNodeColor('bpmn:inclusiveGateway',        '#fffbe6', '#faad14');
        patchNodeColor('bpmn:subProcess',              '#e6fffb', '#13c2c2');
        patchNodeColor('bpmn:intermediateCatchEvent',  '#fffbe6', '#faad14');
        patchNodeColor('bpmn:intermediateThrowEvent',  '#e6f4ff', '#1677ff');

        // Always call render() — LogicFlow 2.x requires it to initialize SVG (grid, canvas)
        const storedGraph = useBpmDesignerStore.getState().lfJson;
        try {
          lf.render(storedGraph?.nodes?.length ? storedGraph as any : { nodes: [], edges: [] });
        } catch { /* ignore */ }

        lf.on('node:click', ({ data }: any) => {
          if (data?.id) {
            selectNode(data.id);
            // Focus LF container so Delete/Backspace keys work immediately after click
            (lf as any).container?.focus();
          }
        });
        lf.on('edge:click', ({ data }: any) => { if (data?.id) selectNode(data.id); });
        lf.on('blank:click', () => selectNode(null));
        lf.on('node:add', ({ data }: any) => {
          if (data?.id) {
            addNode({ id: data.id, type: data.type || '', x: data.x || 0, y: data.y || 0, properties: { ...(data.properties || {}) }, text: data.text });
            selectNode(data.id);
          }
          syncToStore(lf);
        });
        lf.on('node:delete', ({ data }: any) => {
          if (data?.id) removeNode(data.id);
          syncToStore(lf);
        });
        lf.on('edge:add', ({ data }: any) => {
          if (data?.id) addEdge({ id: data.id, type: data.type || '', sourceNodeId: data.sourceNodeId || '', targetNodeId: data.targetNodeId || '', properties: { ...(data.properties || {}) }, text: data.text });
          syncToStore(lf);
        });
        lf.on('edge:delete', ({ data }: any) => {
          if (data?.id) removeEdge(data.id);
          syncToStore(lf);
        });
        lf.on('node:dnd-drag', () => syncToStore(lf));
        lf.on('node:mousemove', () => syncToStore(lf));
        lf.on('properties:change', ({ data }: any) => { if (data?.id) updateNode(data.id, data.properties); syncToStore(lf); });
        lf.on('edge:properties:change', ({ data }: any) => { if (data?.id) updateEdge(data.id, data.properties); syncToStore(lf); });
        lf.on('transform:change', () => syncToStore(lf));
        lf.on('graph:updated', () => syncToStore(lf));

        // Supplement Delete key — mousetrap maps 'delete' → 'del' but some
        // browsers fire key='Delete' which mousetrap misses; handle it manually.
        const lfContainer = (lf as any).container as HTMLElement | undefined;
        onKeyDown = (e: KeyboardEvent) => {
          if (e.key !== 'Delete') return;
          if ((e.target as HTMLElement)?.tagName === 'INPUT' ||
              (e.target as HTMLElement)?.tagName === 'TEXTAREA') return;
          const selected = lf.getSelectElements(true);
          lf.clearSelectElements();
          selected.edges.forEach((edge: any) => edge.id && lf.deleteEdge(edge.id));
          selected.nodes.forEach((node: any) => node.id && lf.deleteNode(node.id));
        };
        lfContainer?.addEventListener('keydown', onKeyDown);

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
          const c = (lfRef.current as any).container as HTMLElement | undefined;
          if (onKeyDown) c?.removeEventListener('keydown', onKeyDown);
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
      // Focus the LF container so keyboard shortcuts (Backspace/Del) work after drop
      const lfContainer = (lf as any).container as HTMLElement | undefined;
      lfContainer?.focus();

      const nodeType = e.dataTransfer.getData('application/bpmn-node-type');
      if (!nodeType) return;

      const rawProps = e.dataTransfer.getData('application/bpmn-node-properties');
      let extraProps: Record<string, unknown> = {};
      if (rawProps) {
        try { extraProps = JSON.parse(rawProps); } catch { /* ignore */ }
      }

      const point = lf.getPointByClient({ x: e.clientX, y: e.clientY });
      const canvasPos = point?.canvasOverlayPosition || { x: e.clientX, y: e.clientY };
      const defaultName = nodeTypeToDefaultName(nodeType);

      lf.addNode({
        type: nodeType,
        x: canvasPos.x,
        y: canvasPos.y,
        properties: { name: defaultName, nodeType, ...extraProps },
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
    'bpmn:startEvent':             'Start',
    'bpmn:endEvent':               'End',
    'bpmn:userTask':               'User Task',
    'bpmn:scriptTask':             'Script Task',
    'bpmn:serviceTask':            'Service Task',
    'bpmn:manualTask':             'Manual Task',
    'bpmn:callActivity':           'Call Activity',
    'bpmn:subProcess':             'Sub Process',
    'bpmn:exclusiveGateway':       'Gateway',
    'bpmn:parallelGateway':        'Gateway',
    'bpmn:inclusiveGateway':       'Gateway',
    'bpmn:intermediateCatchEvent': 'Timer Event',
    'bpmn:intermediateThrowEvent': 'Throw Event',
  };
  return map[nodeType] || nodeType;
}

export default DesignerCanvas;
