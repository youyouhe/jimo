import { useRef } from 'react';
import { Button, message, Popconfirm, Space, Tag, Typography } from 'antd';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  getBlacklist,
  deleteBlacklistEntry,
  type JwtBlacklistEntry,
} from '@/services/jwt-blacklist';

const { Text } = Typography;

const expiredTagColor = (expiresAt: string): 'red' | 'orange' | 'green' => {
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  if (exp < now) return 'red';
  if (exp - now < 3600 * 1000) return 'orange';
  return 'green';
};

const expiredLabel = (expiresAt: string): string => {
  const now = Date.now();
  const exp = new Date(expiresAt).getTime();
  if (exp < now) return 'Expired';
  if (exp - now < 3600 * 1000) return 'Expiring soon';
  return 'Active';
};

export default function JwtBlacklistPage() {
  const actionRef = useRef<ActionType>(undefined);

  const columns: ProColumns<JwtBlacklistEntry>[] = [
    {
      title: 'JTI',
      dataIndex: 'jti',
      width: 320,
      copyable: true,
      ellipsis: true,
      render: (_, record) => (
        <Text copyable ellipsis={{ tooltip: record.jti }} style={{ maxWidth: 280 }}>
          {record.jti}
        </Text>
      ),
    },
    {
      title: 'Expires At',
      dataIndex: 'expiresAt',
      valueType: 'dateTime',
      width: 200,
      search: false,
      render: (_, record) => {
        const color = expiredTagColor(record.expiresAt);
        const label = expiredLabel(record.expiresAt);
        return (
          <Space direction="vertical" size={0}>
            <Text>{new Date(record.expiresAt).toLocaleString()}</Text>
            <Tag color={color}>{label}</Tag>
          </Space>
        );
      },
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 200,
      search: false,
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      search: false,
      render: (_, record) => (
        <Popconfirm
          title="Confirm removal?"
          description="This will remove the blacklist entry. The associated JWT may become valid again."
          onConfirm={async () => {
            try {
              await deleteBlacklistEntry(record.id);
              message.success('Removed');
              actionRef.current?.reload();
            } catch (err: any) {
              message.error(err.message || 'Remove failed');
            }
          }}
          okText="Confirm"
          cancelText="Cancel"
        >
          <Button type="link" size="small" danger>
            Remove
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <ProTable<JwtBlacklistEntry>
      headerTitle="JWT Blacklist"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      request={async (params) => {
        const { current: page, pageSize } = params;
        const result = await getBlacklist({ page, pageSize });
        return {
          data: result.list,
          total: result.total,
          success: true,
        };
      }}
    />
  );
}
