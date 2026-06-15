import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Tag } from 'antd';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  getLoginLogs,
  deleteLoginLog,
  batchDeleteLoginLogs,
  type LoginLog,
} from '@/services/login-log';

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: 'Failure', color: 'red' },
  1: { label: 'Success', color: 'green' },
};

export default function LoginLogsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const columns: ProColumns<LoginLog>[] = [
    {
      title: 'Username',
      dataIndex: 'username',
      width: 140,
    },
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 150,
      copyable: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (_, record) => {
        const info = STATUS_MAP[record.status] ?? { label: String(record.status), color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: 'Message',
      dataIndex: 'message',
      ellipsis: true,
      search: false,
    },
    {
      title: 'Login Time',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: true,
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      search: false,
      render: (_, record) => (
        <Popconfirm
          title="Confirm delete this log?"
          onConfirm={async () => {
            try {
              await deleteLoginLog(record.id);
              message.success('Deleted');
              actionRef.current?.reload();
            } catch (err: any) {
              message.error(err.message || 'Delete failed');
            }
          }}
          okText="Confirm"
          cancelText="Cancel"
        >
          <Button type="link" size="small" danger>
            Delete
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteLoginLogs(selectedRowKeys);
      message.success(`Deleted ${result.count} login logs`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Batch delete failed');
    }
  };

  return (
    <ProTable<LoginLog>
      headerTitle="Login Logs"
      actionRef={actionRef}
      rowKey="id"
      columns={columns}
      rowSelection={{
        selectedRowKeys,
        onChange: (keys) => setSelectedRowKeys(keys as string[]),
      }}
      request={async (params) => {
        const { current: page, pageSize, username, status } = params;
        const result = await getLoginLogs({ page, pageSize, username, status });
        return {
          data: result.list,
          total: result.total,
          success: true,
        };
      }}
      toolBarRender={() => [
        selectedRowKeys.length > 0 && (
          <Popconfirm
            key="batch-delete"
            title="Confirm batch delete?"
            description={`Selected ${selectedRowKeys.length} logs`}
            onConfirm={handleBatchDelete}
            okText="Confirm"
            cancelText="Cancel"
          >
            <Button danger>
              Batch Delete ({selectedRowKeys.length})
            </Button>
          </Popconfirm>
        ),
      ]}
    />
  );
}
