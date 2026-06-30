import { useCallback } from 'react';
import { Collapse } from 'antd';
import {
  PlayCircleOutlined,
  StopOutlined,
  UserOutlined,
  CodeOutlined,
  ApiOutlined,
  BranchesOutlined,
  MergeCellsOutlined,
  ToolOutlined,
  ApartmentOutlined,
  AppstoreOutlined,
  ClockCircleOutlined,
  NotificationOutlined,
  NodeIndexOutlined,
} from '@ant-design/icons';

/**
 * BPMN node palette item definition.
 */
interface NodePaletteItem {
  type: string;
  label: string;
  icon: React.ReactNode;
  category: 'events' | 'tasks' | 'gateways';
  /** Extra BPMN properties to merge when the node is dropped on the canvas. */
  properties?: Record<string, unknown>;
}

/**
 * Node type definitions for the BPMN node types available in the palette.
 */
const NODE_PALETTE: NodePaletteItem[] = [
  {
    type: 'bpmn:startEvent',
    label: 'Start Event',
    icon: <PlayCircleOutlined style={{ color: '#52c41a' }} />,
    category: 'events',
  },
  {
    type: 'bpmn:endEvent',
    label: 'End Event',
    icon: <StopOutlined style={{ color: '#ff4d4f' }} />,
    category: 'events',
  },
  {
    type: 'bpmn:intermediateCatchEvent',
    label: 'Timer Event',
    icon: <ClockCircleOutlined style={{ color: '#faad14' }} />,
    category: 'events',
    properties: { definitionType: 'bpmn:timerEventDefinition' },
  },
  {
    type: 'bpmn:intermediateThrowEvent',
    label: 'Throw Event',
    icon: <NotificationOutlined style={{ color: '#1677ff' }} />,
    category: 'events',
  },
  {
    type: 'bpmn:userTask',
    label: 'User Task',
    icon: <UserOutlined style={{ color: '#1677ff' }} />,
    category: 'tasks',
  },
  {
    type: 'bpmn:scriptTask',
    label: 'Script Task',
    icon: <CodeOutlined style={{ color: '#fa8c16' }} />,
    category: 'tasks',
  },
  {
    type: 'bpmn:serviceTask',
    label: 'Service Task',
    icon: <ApiOutlined style={{ color: '#52c41a' }} />,
    category: 'tasks',
  },
  {
    type: 'bpmn:manualTask',
    label: 'Manual Task',
    icon: <ToolOutlined style={{ color: '#fa8c16' }} />,
    category: 'tasks',
  },
  {
    type: 'bpmn:callActivity',
    label: 'Call Activity',
    icon: <ApartmentOutlined style={{ color: '#722ed1' }} />,
    category: 'tasks',
  },
  {
    type: 'bpmn:subProcess',
    label: 'Sub Process',
    icon: <AppstoreOutlined style={{ color: '#13c2c2' }} />,
    category: 'tasks',
  },
  {
    type: 'bpmn:exclusiveGateway',
    label: 'Exclusive Gateway',
    icon: <BranchesOutlined style={{ color: '#fa8c16' }} />,
    category: 'gateways',
  },
  {
    type: 'bpmn:parallelGateway',
    label: 'Parallel Gateway',
    icon: <MergeCellsOutlined style={{ color: '#fa8c16' }} />,
    category: 'gateways',
  },
  {
    type: 'bpmn:inclusiveGateway',
    label: 'Inclusive Gateway',
    icon: <NodeIndexOutlined style={{ color: '#fa8c16' }} />,
    category: 'gateways',
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  events: 'Events',
  tasks: 'Tasks',
  gateways: 'Gateways',
};

/**
 * NodePanel -- left sidebar with collapsible categories of draggable BPMN nodes.
 * Uses HTML5 drag-and-drop to create new nodes on the LogicFlow canvas.
 */
export default function NodePanel() {
  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, item: NodePaletteItem) => {
      e.dataTransfer.setData('application/bpmn-node-type', item.type);
      if (item.properties) {
        e.dataTransfer.setData(
          'application/bpmn-node-properties',
          JSON.stringify(item.properties),
        );
      }
      e.dataTransfer.effectAllowed = 'copy';
    },
    [],
  );

  // Group palette items by category
  const grouped: Record<string, NodePaletteItem[]> = {};
  for (const item of NODE_PALETTE) {
    (grouped[item.category] ??= []).push(item);
  }

  const collapseItems = Object.entries(grouped).map(([category, items]) => ({
    key: category,
    label: `${CATEGORY_LABELS[category] || category} (${items.length})`,
    children: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {items.map((item) => (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => handleDragStart(e, item)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              border: '1px solid #d9d9d9',
              borderRadius: 6,
              cursor: 'grab',
              background: '#fafafa',
              transition: 'background 0.2s, box-shadow 0.2s',
              userSelect: 'none',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#e6f4ff';
              e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.12)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#fafafa';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <span style={{ fontSize: 18, width: 24, textAlign: 'center' }}>
              {item.icon}
            </span>
            <span style={{ fontSize: 13, color: '#333', whiteSpace: 'nowrap' }}>
              {item.label}
            </span>
          </div>
        ))}
      </div>
    ),
  }));

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        padding: '8px 0',
      }}
    >
      <div
        style={{
          padding: '0 12px 8px',
          fontSize: 14,
          fontWeight: 600,
          color: '#333',
          borderBottom: '1px solid #f0f0f0',
          marginBottom: 8,
        }}
      >
        BPMN Nodes
      </div>
      <Collapse
        ghost
        defaultActiveKey={['events', 'tasks', 'gateways']}
        size="small"
        items={collapseItems}
        style={{ padding: '0 4px' }}
      />
    </div>
  );
}
