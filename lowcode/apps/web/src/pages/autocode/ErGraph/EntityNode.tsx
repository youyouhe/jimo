import { memo } from 'react';
import { Card, Space, Tag, Typography } from 'antd';
import { KeyOutlined, LinkOutlined } from '@ant-design/icons';
import { Handle, Position } from '@xyflow/react';
import type { ErGraphNode } from '../../../services/autocode';
import { ROLE_COLOR } from './types';

const { Text } = Typography;

function EntityNodeImpl({ data }: { data: ErGraphNode }) {
  const fields = data.fields || [];
  const implicit = data.isImplicit;
  const role = data.role || 'main';
  const isDual = role === 'child-junction';
  const color = ROLE_COLOR[role];
  return (
    <>
      <Handle type="target" position={Position.Top} style={{ background: color }} />
      <Card
        className={isDual ? 'er-node-dual' : undefined}
        size="small"
        title={
          <span style={{ fontSize: 13, color }}>{data.description || data.table}</span>
        }
        extra={
          <Space size={4}>
            {implicit ? (
              <Tag color="default" style={{ marginRight: 0, fontSize: 11, fontStyle: 'italic' }}>
                明细
              </Tag>
            ) : null}
            {isDual ? (
              <Tag color="purple" style={{ marginRight: 0, fontSize: 11 }}>
                子表/中间表
              </Tag>
            ) : null}
            {data.packageName ? (
              <Tag color="blue" style={{ marginRight: 0, fontSize: 11 }}>
                {data.packageName}
              </Tag>
            ) : null}
          </Space>
        }
        style={{
          width: 240,
          borderColor: isDual ? undefined : color,
          borderWidth: 2,
          borderStyle: implicit ? 'dashed' : 'solid',
          background: implicit ? '#fafafa' : undefined,
        }}
        styles={{ body: { padding: '4px 8px', maxHeight: 200, overflowY: 'auto' } }}
      >
        {fields.length === 0 ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            No fields
          </Text>
        ) : (
          fields.map((f) => (
            <div
              key={f.name}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '1px 0' }}
            >
              {f.isPk ? (
                <KeyOutlined style={{ color: '#faad14', fontSize: 11 }} />
              ) : null}
              {f.isFk ? (
                <LinkOutlined style={{ color: '#1677ff', fontSize: 11 }} />
              ) : null}
              {!f.isPk && !f.isFk ? <span style={{ width: 11 }} /> : null}
              <Text style={{ fontSize: 12, fontWeight: f.isPk ? 600 : 400 }}>{f.name}</Text>
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 'auto' }}>
                {f.type}
              </Text>
            </div>
          ))
        )}
      </Card>
      <Handle type="source" position={Position.Bottom} style={{ background: color }} />
    </>
  );
}

export const EntityNode = memo(EntityNodeImpl);
