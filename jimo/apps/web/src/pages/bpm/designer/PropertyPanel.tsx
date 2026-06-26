import { useState, useEffect, useMemo, useCallback } from 'react';
import { Form, Input, Select, Empty, Typography, Divider, Tag } from 'antd';
import { useBpmDesignerStore } from '@/stores/bpm-designer';
import type { LfNode, LfEdge, LfNodeProperties, LfEdgeProperties } from '@/services/bpm';

const { Text, Title } = Typography;
const { TextArea } = Input;

/** Debounce delay (ms) for property changes. */
const DEBOUNCE_MS = 300;

/**
 * PropertyPanel -- right sidebar that shows type-specific property editors
 * for the currently selected BPMN node or edge.
 */
export default function PropertyPanel() {
  const selectedNodeId = useBpmDesignerStore((s) => s.selectedNodeId);
  const lfJson = useBpmDesignerStore((s) => s.lfJson);
  const updateNode = useBpmDesignerStore((s) => s.updateNode);
  const updateEdge = useBpmDesignerStore((s) => s.updateEdge);

  const [form] = Form.useForm();
  const [formKey, setFormKey] = useState(0);

  // Find the selected item (node or edge) from the store graph data
  const selectedItem = useMemo((): { type: 'node'; data: LfNode } | { type: 'edge'; data: LfEdge } | null => {
    if (!selectedNodeId || !lfJson) return null;

    const node = lfJson.nodes?.find((n) => n.id === selectedNodeId);
    if (node) return { type: 'node', data: node };

    const edge = lfJson.edges?.find((e) => e.id === selectedNodeId);
    if (edge) return { type: 'edge', data: edge };

    return null;
  }, [selectedNodeId, lfJson]);

  // Determine the BPMN element type from the raw type string
  const elementType = selectedItem?.data?.type || '';

  // Debounced property sync timer ref
  const [debounceTimer, setDebounceTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Reset form when selection changes
  useEffect(() => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      setDebounceTimer(null);
    }

    if (!selectedItem) {
      form.resetFields();
      setFormKey((k) => k + 1);
      return;
    }

    const props = selectedItem.data.properties || {};
    form.setFieldsValue({
      name: props.name || '',
      assignee: props.assignee || '',
      candidateGroups: props.candidateGroups || '',
      candidateUsers: props.candidateUsers || '',
      formKey: props.formKey || '',
      dueDate: props.dueDate || '',
      priority: props.priority || '',
      scriptFormat: props.scriptFormat || 'javascript',
      script: props.script || '',
      conditionExpression: props.conditionExpression || '',
      defaultFlow: props.defaultFlow || '',
      documentation: props.documentation || '',
      category: props.category || '',
      skipExpression: props.skipExpression || '',
    });
    setFormKey((k) => k + 1);
  }, [selectedItem?.data?.id]);

  // Handle form value change
  const handleValuesChange = useCallback(
    (_changed: any, allValues: any) => {
      if (!selectedItem || !selectedNodeId) return;

      // Debounce to avoid excessive updates during fast typing
      if (debounceTimer) clearTimeout(debounceTimer);

      const timer = setTimeout(() => {
        const cleanProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(allValues)) {
          if (value !== undefined && value !== '') {
            cleanProps[key] = value;
          }
        }

        if (selectedItem.type === 'node') {
          updateNode(selectedNodeId, cleanProps as Partial<LfNodeProperties>);
        } else {
          updateEdge(selectedNodeId, cleanProps as Partial<LfEdgeProperties>);
        }
        setDebounceTimer(null);
      }, DEBOUNCE_MS);

      setDebounceTimer(timer);
    },
    [selectedItem, selectedNodeId, updateNode, updateEdge, debounceTimer],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [debounceTimer]);

  // --- Empty state ---
  if (!selectedItem) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <Empty description="Select a node or edge to edit its properties" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </div>
    );
  }

  const { data } = selectedItem;
  const isEdge = selectedItem.type === 'edge';

  // Determine node type label for display
  const typeLabel = nodeTypeToLabel(elementType);

  return (
    <div style={{ padding: '12px 0', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '0 16px 12px', borderBottom: '1px solid #f0f0f0', marginBottom: 12 }}>
        <Tag color={isEdge ? 'blue' : 'green'} style={{ marginBottom: 4 }}>
          {typeLabel}
        </Tag>
        {isEdge && data.type === 'bpmn:sequenceFlow' && (
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
            {(data as LfEdge).sourceNodeId} &rarr; {(data as LfEdge).targetNodeId}
          </div>
        )}
      </div>

      <Form
        key={formKey}
        form={form}
        layout="vertical"
        size="small"
        onValuesChange={handleValuesChange}
        style={{ padding: '0 16px' }}
      >
        {/* === Common Fields === */}
        <Form.Item name="name" label="Name">
          <Input placeholder="Element name" />
        </Form.Item>

        <Form.Item name="documentation" label="Documentation">
          <TextArea rows={2} placeholder="Description / documentation" />
        </Form.Item>

        {/* === UserTask-specific fields === */}
        {elementType === 'bpmn:userTask' && (
          <>
            <Divider style={{ margin: '12px 0', fontSize: 12 }}>User Task</Divider>

            <Form.Item name="assignee" label="Assignee" tooltip="User ID or expression (e.g. ${initiator})">
              <Input placeholder="e.g. admin or ${initiator}" />
            </Form.Item>

            <Form.Item
              name="candidateGroups"
              label="Candidate Groups"
              tooltip="Comma-separated group IDs"
            >
              <Input placeholder="e.g. deptHead, finance" />
            </Form.Item>

            <Form.Item name="candidateUsers" label="Candidate Users" tooltip="Comma-separated user IDs">
              <Input placeholder="e.g. userA, userB" />
            </Form.Item>

            <Form.Item name="formKey" label="Form Key" tooltip="Associated form identifier">
              <Input placeholder="e.g. leave-request-form" />
            </Form.Item>

            <Form.Item name="dueDate" label="Due Date" tooltip="ISO duration or date expression">
              <Input placeholder="e.g. P3D or ${dueDate}" />
            </Form.Item>

            <Form.Item name="priority" label="Priority">
              <Select
                allowClear
                placeholder="Select priority"
                options={[
                  { label: 'Low', value: 'low' },
                  { label: 'Normal', value: 'normal' },
                  { label: 'High', value: 'high' },
                  { label: 'Urgent', value: 'urgent' },
                ]}
              />
            </Form.Item>

            <Form.Item name="category" label="Category">
              <Input placeholder="Task category" />
            </Form.Item>

            <Form.Item name="skipExpression" label="Skip Expression" tooltip="Expression that evaluates to true to skip this task">
              <Input placeholder="e.g. ${skipApproval}" />
            </Form.Item>
          </>
        )}

        {/* === ScriptTask-specific fields === */}
        {elementType === 'bpmn:scriptTask' && (
          <>
            <Divider style={{ margin: '12px 0', fontSize: 12 }}>Script Task</Divider>

            <Form.Item
              name="scriptFormat"
              label="Script Format"
              rules={[{ required: true }]}
            >
              <Select
                options={[
                  { label: 'JavaScript', value: 'javascript' },
                  { label: 'Groovy', value: 'groovy' },
                  { label: 'Python / Jython', value: 'jython' },
                  { label: 'JUEL', value: 'juel' },
                ]}
              />
            </Form.Item>

            <Form.Item name="script" label="Script" tooltip="The script body to execute">
              <TextArea
                rows={6}
                placeholder="// Script code..."
                style={{ fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace", fontSize: 12 }}
              />
            </Form.Item>
          </>
        )}

        {/* === ServiceTask fields === */}
        {elementType === 'bpmn:serviceTask' && (
          <>
            <Divider style={{ margin: '12px 0', fontSize: 12 }}>Service Task</Divider>

            <Form.Item name="delegateExpression" label="Delegate Expression">
              <Input placeholder="e.g. ${myService}" />
            </Form.Item>
          </>
        )}

        {/* === Gateway fields === */}
        {(elementType === 'bpmn:exclusiveGateway' ||
          elementType === 'bpmn:parallelGateway' ||
          elementType === 'bpmn:inclusiveGateway') && (
          <>
            <Divider style={{ margin: '12px 0', fontSize: 12 }}>Gateway</Divider>

            <Form.Item name="defaultFlow" label="Default Flow" tooltip="Edge ID or name of the default outgoing flow">
              <Input placeholder="Default sequence flow ID" />
            </Form.Item>
          </>
        )}

        {/* === SequenceFlow (edge) fields === */}
        {isEdge && elementType === 'bpmn:sequenceFlow' && (
          <>
            <Divider style={{ margin: '12px 0', fontSize: 12 }}>Sequence Flow</Divider>

            <Form.Item
              name="conditionExpression"
              label="Condition Expression"
              tooltip="Expression language condition (e.g. ${amount > 1000})"
            >
              <TextArea
                rows={3}
                placeholder="${amount > 1000}"
                style={{ fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace", fontSize: 12 }}
              />
            </Form.Item>

            <Form.Item name="defaultFlow" label="Default Flow" valuePropName="checked">
              <Select
                allowClear
                placeholder="Is this the default flow?"
                options={[
                  { label: 'Yes', value: 'true' },
                  { label: 'No', value: 'false' },
                ]}
              />
            </Form.Item>
          </>
        )}

        {/* === Event fields === */}
        {(elementType === 'bpmn:startEvent' || elementType === 'bpmn:endEvent') && (
          <>
            <Divider style={{ margin: '12px 0', fontSize: 12 }}>Event</Divider>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Events use the common Name and Documentation fields above.
            </Text>
          </>
        )}

        {/* === Read-only: Element ID === */}
        <Divider style={{ margin: '12px 0', fontSize: 12 }}>Meta</Divider>
        <Text type="secondary" style={{ fontSize: 12, wordBreak: 'break-all' }}>
          ID: {data.id}
        </Text>
      </Form>
    </div>
  );
}

/** Map raw BPMN type string to a display label. */
function nodeTypeToLabel(type: string): string {
  const map: Record<string, string> = {
    'bpmn:startEvent': 'Start Event',
    'bpmn:endEvent': 'End Event',
    'bpmn:boundaryEvent': 'Boundary Event',
    'bpmn:intermediateCatchEvent': 'Intermediate Catch',
    'bpmn:intermediateThrowEvent': 'Intermediate Throw',
    'bpmn:userTask': 'User Task',
    'bpmn:serviceTask': 'Service Task',
    'bpmn:scriptTask': 'Script Task',
    'bpmn:exclusiveGateway': 'Exclusive Gateway',
    'bpmn:parallelGateway': 'Parallel Gateway',
    'bpmn:inclusiveGateway': 'Inclusive Gateway',
    'bpmn:sequenceFlow': 'Sequence Flow',
    'bpmn:subProcess': 'Sub Process',
  };
  return map[type] || type;
}
