import { Card, Table, Tag, Button, Space, Typography } from 'antd';
import { CheckOutlined, EditOutlined } from '@ant-design/icons';
import type { AutoCodeDto } from '../../../services/autocode';

function fieldTypeName(f: any): string {
  if (f.type === 'relation') {
    const rt = f.relationType || '';
    const label =
      rt === 'many-to-one' ? 'N:1' : rt === 'many-to-many' ? 'N:N' : rt === 'one-to-many' ? '1:N' : rt;
    return `relation(${label}${f.relationTable ? '→' + f.relationTable : ''})`;
  }
  return f.type + (f.length ? `(${f.length})` : '');
}

export function ProposeCard({
  dto,
  status,
  onConfirm,
  onEdit,
}: {
  dto: AutoCodeDto;
  status: 'pending' | 'confirmed' | 'rejected';
  onConfirm: () => void;
  onEdit: () => void;
}) {
  const columns = [
    { title: '字段', dataIndex: 'name', key: 'name', width: 120 },
    { title: '类型', key: 'type', render: (_: any, r: any) => fieldTypeName(r) },
    { title: '必填', dataIndex: 'required', key: 'required', width: 60, render: (v: boolean) => (v ? '是' : '') },
    { title: '唯一', dataIndex: 'unique', key: 'unique', width: 60, render: (v: boolean) => (v ? '✓' : '') },
    { title: '说明', dataIndex: 'description', key: 'description' },
  ];

  return (
    <Card
      size="small"
      style={{ marginTop: 4, marginBottom: 8, borderColor: '#13c2c2' }}
      title={
        <Space>
          <Tag color="cyan">提议方案</Tag>
          {dto.packageId ? <Tag color="geekblue">{dto.packageName || dto.packageId.slice(0, 8)}</Tag> : null}
          <Typography.Text strong>{dto.tableName}</Typography.Text>
          <Typography.Text type="secondary">{dto.description}</Typography.Text>
        </Space>
      }
      extra={
        status === 'pending' ? (
          <Space>
            <Button size="small" icon={<EditOutlined />} onClick={onEdit}>
              填入表单修改
            </Button>
            <Button size="small" type="primary" icon={<CheckOutlined />} onClick={onConfirm}>
              确认创建
            </Button>
          </Space>
        ) : (
          <Tag color={status === 'confirmed' ? 'green' : 'default'}>
            {status === 'confirmed' ? '已创建' : '已忽略'}
          </Tag>
        )
      }
    >
      <Table
        size="small"
        pagination={false}
        dataSource={(dto.fields || []).map((f: any, i: number) => ({ ...f, key: i }))}
        columns={columns}
      />
    </Card>
  );
}
