import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from '@umijs/max';
import { Layout, Button, Tooltip, Tabs } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  SettingFilled,
  RobotOutlined,
} from '@ant-design/icons';
import DesignerCanvas from './DesignerCanvas';
import type { DesignerCanvasHandle } from './DesignerCanvas';
import DesignerToolbar from './DesignerToolbar';
import NodePanel from './NodePanel';
import PropertyPanel from './PropertyPanel';
import AgentChat from './AgentChat';
import { useBpmDesignerStore } from '@/stores/bpm-designer';
import { getProcess } from '@/services/bpm';
import type LogicFlow from '@logicflow/core';

const { Content } = Layout;

/** Sidebar widths (px). */
const LEFT_PANEL_WIDTH = 220;
const RIGHT_PANEL_WIDTH = 320;

/**
 * BPMN Visual Designer Page.
 *
 * 3-column layout: NodePanel (left) | DesignerCanvas (center) | PropertyPanel (right).
 * Toolbar at top with save/publish/undo/redo/zoom controls.
 *
 * URL params:
 *   ?id=<definitionId> — edit an existing process
 *   No id — create a new process
 */
export default function BpmDesignerPage() {
  useEffect(() => {
    document.title = 'BPMN Process Designer - Jimo';
  }, []);

  const [searchParams] = useSearchParams();
  const definitionIdParam = searchParams.get('id');

  // Store
  const definitionId = useBpmDesignerStore((s) => s.definitionId);
  const loadDefinition = useBpmDesignerStore((s) => s.loadDefinition);
  const reset = useBpmDesignerStore((s) => s.reset);

  // Canvas ref
  const canvasRef = useRef<DesignerCanvasHandle>(null);
  const [lf, setLf] = useState<LogicFlow | null>(null);

  // Panel toggle
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [loading, setLoading] = useState(false);

  // Handle canvas ready
  const handleCanvasReady = useCallback((lfInstance: LogicFlow) => {
    setLf(lfInstance);
  }, []);

  // Handle definition ID change from toolbar (after create)
  const handleDefinitionIdChange = useCallback((id: string) => {
    // Update URL without full page reload
    const url = new URL(window.location.href);
    url.searchParams.set('id', id);
    window.history.replaceState({}, '', url.toString());
  }, []);

  // Load existing definition on mount
  useEffect(() => {
    if (definitionIdParam) {
      setLoading(true);
      getProcess(definitionIdParam)
        .then((def) => {
          loadDefinition({
            id: def.id,
            name: def.name,
            key: def.key,
            lfJson: def.currentVersionLfJson,
          });
        })
        .catch((err: any) => {
          console.error('Failed to load process definition:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      // Reset store for new process
      reset();
    }

    return () => {
      reset();
    };
  }, [definitionIdParam]);

  return (
    <>
    {/* Force Tabs internal elements to pass height down correctly */}
    <style>{`
      .bpm-right-tabs > .ant-tabs-content-holder {
        flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column;
      }
      .bpm-right-tabs > .ant-tabs-content-holder > .ant-tabs-content {
        flex: 1; min-height: 0; height: 100%; overflow: hidden;
      }
      .bpm-right-tabs .ant-tabs-tabpane {
        height: 100%; overflow: hidden;
      }
    `}</style>
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: '#f5f5f5',
      }}
    >
      {/* Top Toolbar */}
      <DesignerToolbar
        lf={lf}
        onDefinitionIdChange={handleDefinitionIdChange}
      />

      {/* Main 3-column layout */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {/* Left Panel: Node Palette */}
        <div
          style={{
            width: leftCollapsed ? 0 : LEFT_PANEL_WIDTH,
            minWidth: leftCollapsed ? 0 : LEFT_PANEL_WIDTH,
            transition: 'width 0.2s, min-width 0.2s',
            overflow: 'hidden',
            background: '#fff',
            borderRight: leftCollapsed ? 'none' : '1px solid #f0f0f0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <NodePanel />
        </div>

        {/* Left toggle button */}
        <Tooltip title={leftCollapsed ? 'Show Node Palette' : 'Hide Node Palette'}>
          <Button
            type="text"
            size="small"
            icon={leftCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setLeftCollapsed((v) => !v)}
            style={{
              position: 'absolute',
              left: leftCollapsed ? 4 : LEFT_PANEL_WIDTH - 4,
              top: 8,
              zIndex: 20,
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              borderRadius: 4,
              transform: 'translateX(-50%)',
              transition: 'left 0.2s',
            }}
          />
        </Tooltip>

        {/* Center: Designer Canvas */}
        <div
          style={{
            flex: 1,
            overflow: 'hidden',
            position: 'relative',
            background: '#fff',
          }}
        >
          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
              Loading process...
            </div>
          ) : (
            <DesignerCanvas
              ref={canvasRef}
              onLfReady={handleCanvasReady}
            />
          )}
        </div>

        {/* Right toggle button */}
        <Tooltip title={rightCollapsed ? 'Show Properties' : 'Hide Properties'}>
          <Button
            type="text"
            size="small"
            icon={
              rightCollapsed ? (
                <SettingOutlined />
              ) : (
                <SettingFilled />
              )
            }
            onClick={() => setRightCollapsed((v) => !v)}
            style={{
              position: 'absolute',
              right: rightCollapsed ? 4 : RIGHT_PANEL_WIDTH - 4,
              top: 8,
              zIndex: 20,
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              borderRadius: 4,
              transform: 'translateX(50%)',
              transition: 'right 0.2s',
            }}
          />
        </Tooltip>

        {/* Right Panel: Property Editor + AI Agent */}
        <div
          style={{
            width: rightCollapsed ? 0 : RIGHT_PANEL_WIDTH,
            minWidth: rightCollapsed ? 0 : RIGHT_PANEL_WIDTH,
            transition: 'width 0.2s, min-width 0.2s',
            overflow: 'hidden',
            background: '#fff',
            borderLeft: rightCollapsed ? 'none' : '1px solid #f0f0f0',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <Tabs
            defaultActiveKey="properties"
            size="small"
            style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
            tabBarStyle={{ marginBottom: 0, padding: '0 8px', flexShrink: 0 }}
            className="bpm-right-tabs"
            items={[
              {
                key: 'properties',
                label: (
                  <span>
                    <SettingOutlined />
                    {' '}属性
                  </span>
                ),
                children: (
                  <div style={{ height: '100%', overflowY: 'auto' }}>
                    <PropertyPanel />
                  </div>
                ),
              },
              {
                key: 'agent',
                label: (
                  <span>
                    <RobotOutlined />
                    {' '}AI助手
                  </span>
                ),
                children: (
                  <div style={{ height: '100%', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                    <AgentChat lf={lf} canvasRef={canvasRef} definitionId={definitionId} />
                  </div>
                ),
              },
            ]}
          />
        </div>
      </div>
    </div>
    </>
  );
}
