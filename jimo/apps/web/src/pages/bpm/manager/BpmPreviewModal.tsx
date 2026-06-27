import { useEffect, useRef, useState } from 'react';
import { Modal, Spin, Empty, Button, Space } from 'antd';
import { ZoomInOutlined, ZoomOutOutlined, ExpandOutlined } from '@ant-design/icons';
import LogicFlow from '@logicflow/core';
import { BpmnAdapter, BPMNElements, TaskNodeFactory, icons } from '@logicflow/extension';
import { getProcess, type LfGraphData } from '@/services/bpm';
import '@logicflow/core/dist/index.css';
import '@logicflow/extension/lib/style/index.css';

interface BpmPreviewModalProps {
  open: boolean;
  onClose: () => void;
  definitionId: string | null;
}

/** Promise that resolves after a delay (ms). */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Read-only BPMN process diagram preview modal.
 *
 * Single sequential flow: fetch definition → wait for container → init canvas → apply graph.
 * Uses the same clearData/addNode pattern as DesignerCanvas.applyGraph.
 */
export default function BpmPreviewModal({ open, onClose, definitionId }: BpmPreviewModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const lfRef = useRef<LogicFlow | null>(null);
  const [phase, setPhase] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !definitionId) return;

    let cancelled = false;
    setPhase('loading');
    setErrorMsg(null);

    // Destroy previous instance
    if (lfRef.current) {
      try { lfRef.current.destroy(); } catch { /* ignore */ }
      lfRef.current = null;
    }

    (async () => {
      try {
        // ── Step 1: fetch definition ──────────────────────────
        const def = await getProcess(definitionId);
        if (cancelled) return;

        const graph = def.currentVersionLfJson as LfGraphData | null | undefined;
        if (!graph?.nodes?.length) {
          setErrorMsg('No diagram data. Save a draft in the designer first.');
          setPhase('error');
          return;
        }

        // ── Step 2: wait for container to be ready ─────────────
        const container = containerRef.current;
        if (!container || cancelled) return;

        // Poll until container has non-zero size (modal animation may still be in progress)
        for (let i = 0; i < 30; i++) {
          if (cancelled) return;
          if (container.offsetWidth > 0 && container.offsetHeight > 0) break;
          await delay(100);
        }
        if (cancelled) return;

        // ── Step 3: init LogicFlow (silent/read-only) ──────────
        const lf = new LogicFlow({
          container,
          grid: { size: 20, visible: true, type: 'dot', config: { color: '#e0e0e0', thickness: 1 } },
          keyboard: { enabled: false },
          isSilentMode: true,
          stopScrollGraph: false,
          stopZoomGraph: false,
          edgeType: 'bpmn:sequenceFlow',
          plugins: [BpmnAdapter, BPMNElements],
        });
        lfRef.current = lf;

        // ── Colored task nodes (same palette as DesignerCanvas) ──
        const coloredTask = (type: string, icon: string, fill: string, stroke: string, sw = 1.5) => {
          const base = TaskNodeFactory(type, icon);
          const BaseModel = base.model;
          class ColoredModel extends BaseModel {
            getNodeStyle() {
              const style = super.getNodeStyle();
              style.fill = fill;
              style.stroke = stroke;
              style.strokeWidth = sw;
              return style;
            }
          }
          try { lf.register({ ...base, model: ColoredModel } as any); } catch { /* ignore */ }
        };

        coloredTask('bpmn:userTask',    icons.userTaskIcon,    '#e8f4ff', '#1677ff');
        coloredTask('bpmn:scriptTask',  icons.scriptTaskIcon,  '#fff7e6', '#fa8c16');
        coloredTask('bpmn:serviceTask', icons.serviceTaskIcon, '#f6ffed', '#52c41a');
        coloredTask('bpmn:manualTask',  icons.manualTaskIcon,  '#fff7e6', '#fa8c16');
        coloredTask('bpmn:callActivity',icons.serviceTaskIcon, '#f9f0ff', '#722ed1', 2.5);

        // ── Colored events / gateways (patch registered prototypes) ──
        const patchColor = (type: string, fill: string, stroke: string) => {
          const registered = (lf as any).graphModel?.modelMap?.get(type);
          if (!registered) return;
          const orig = registered.prototype.getNodeStyle;
          registered.prototype.getNodeStyle = function () {
            const s = orig.call(this);
            s.fill = fill;
            s.stroke = stroke;
            s.strokeWidth = 1.5;
            return s;
          };
        };

        patchColor('bpmn:startEvent',              '#f6ffed', '#52c41a');
        patchColor('bpmn:endEvent',                '#fff1f0', '#ff4d4f');
        patchColor('bpmn:exclusiveGateway',        '#fffbe6', '#faad14');
        patchColor('bpmn:parallelGateway',         '#fffbe6', '#faad14');
        patchColor('bpmn:inclusiveGateway',        '#fffbe6', '#faad14');
        patchColor('bpmn:subProcess',              '#e6fffb', '#13c2c2');
        patchColor('bpmn:intermediateCatchEvent',  '#fffbe6', '#faad14');
        patchColor('bpmn:intermediateThrowEvent',  '#e6f4ff', '#1677ff');

        // ── Step 4: apply graph ────────────────────────────────
        // Initialise with empty canvas first (required by LogicFlow),
        // then apply the graph data so nodes render correctly.
        lf.render({ nodes: [], edges: [] } as any);

        if (!cancelled) {
          // Defer graph application — lets React commit the canvas DOM first
          setTimeout(() => {
            if (cancelled) return;
            try {
              lf.clearData();
              for (const n of graph.nodes) {
                try { lf.addNode(n as any); } catch { /* skip */ }
              }
              for (const e of graph.edges) {
                try { lf.addEdge(e as any); } catch { /* skip */ }
              }
              // Fit after addNode batch, then again after phase change re-render
              setTimeout(() => { try { lf.fitView(); } catch { /* ignore */ } }, 150);
            } catch { /* ignore */ }
          }, 100);
          setPhase('ready');
        }
      } catch (err: any) {
        if (!cancelled) {
          setErrorMsg(err?.message || 'Failed to load process');
          setPhase('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (lfRef.current) {
        try { lfRef.current.destroy(); } catch { /* ignore */ }
        lfRef.current = null;
      }
    };
  }, [open, definitionId]);

  // ── Zoom controls (same pattern as DesignerCanvas / DesignerToolbar) ──
  const handleZoomIn  = () => { lfRef.current?.zoom(true); };
  const handleZoomOut = () => { lfRef.current?.zoom(false); };
  const handleZoomFit = () => {
    const lf = lfRef.current;
    if (!lf) return;
    lf.resetZoom();
    // setTimeout required — fitView needs the zoom reset to settle first
    setTimeout(() => { try { lf.fitView(); } catch { /* ignore */ } }, 80);
  };

  return (
    <Modal
      title="Process Preview"
      open={open}
      onCancel={onClose}
      width={960}
      footer={null}
      destroyOnClose
      styles={{ body: { padding: 0 } }}
    >
      {phase === 'ready' && (
        <div style={{
          position: 'absolute', top: 8, right: 56, zIndex: 10,
          background: '#fff', borderRadius: 4, boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
        }}>
          <Space size={0}>
            <Button type="text" size="small" icon={<ZoomInOutlined />}  onClick={handleZoomIn} />
            <Button type="text" size="small" icon={<ZoomOutOutlined />} onClick={handleZoomOut} />
            <Button type="text" size="small" icon={<ExpandOutlined />} onClick={handleZoomFit} />
          </Space>
        </div>
      )}

      <div style={{ height: 500, position: 'relative', background: '#f5f5f5', overflow: 'hidden' }}>
        {phase === 'loading' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', position: 'absolute', inset: 0, zIndex: 5, background: '#f5f5f5',
          }}>
            <Spin tip="Loading diagram..." />
          </div>
        )}
        {phase === 'error' && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            height: '100%', position: 'absolute', inset: 0, zIndex: 5,
          }}>
            <Empty description={errorMsg} />
          </div>
        )}
        <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      </div>
    </Modal>
  );
}
