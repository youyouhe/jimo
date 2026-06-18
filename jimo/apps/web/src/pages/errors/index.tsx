import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Tag, Modal, Typography, Select, Descriptions } from 'antd';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  getErrors,
  getError,
  updateError,
  deleteError,
  batchDeleteErrors,
  type ErrorLog,
  type UpdateErrorDto,
} from '@/services/error';

const { Paragraph, Text } = Typography;

const LEVEL_COLORS: Record<string, string> = {
  fatal: 'purple',
  error: 'red',
  warn: 'orange',
  info: 'blue',
};

const LEVEL_OPTIONS = [
  { label: 'Fatal', value: 'fatal' },
  { label: 'Error', value: 'error' },
  { label: 'Warn', value: 'warn' },
  { label: 'Info', value: 'info' },
];

const STATUS_OPTIONS = [
  { label: 'Unresolved', value: 0 },
  { label: 'Resolving', value: 1 },
  { label: 'Resolved', value: 2 },
  { label: 'Ignored', value: 3 },
];

const STATUS_MAP: Record<number, { label: string; color: string }> = {
  0: { label: 'Unresolved', color: 'red' },
  1: { label: 'Resolving', color: 'orange' },
  2: { label: 'Resolved', color: 'green' },
  3: { label: 'Ignored', color: 'default' },
};

export default function ErrorsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ErrorLog | null>(null);
  const [editStatus, setEditStatus] = useState<number | undefined>(undefined);
  const [editSolution, setEditSolution] = useState<string>('');

  const handleViewDetail = async (id: string) => {
    try {
      const data = await getError(id);
      setDetail(data);
      setEditStatus(data.status);
      setEditSolution(data.solution || '');
      setDetailOpen(true);
    } catch (err: any) {
      message.error(err.message || 'Failed to load detail');
    }
  };

  const handleSave = async () => {
    if (!detail) return;
    try {
      const dto: UpdateErrorDto = {
        status: editStatus,
        solution: editSolution,
      };
      await updateError(detail.id, dto);
      message.success('Updated');
      setDetailOpen(false);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Update failed');
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteErrors(selectedRowKeys);
      message.success(`Deleted ${result.count} error logs`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Batch delete failed');
    }
  };

  const columns: ProColumns<ErrorLog>[] = [
    {
      title: 'Level',
      dataIndex: 'level',
      width: 90,
      render: (_, record) => (
        <Tag color={LEVEL_COLORS[record.level] ?? 'default'}>
          {record.level.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'Source',
      dataIndex: 'source',
      width: 140,
    },
    {
      title: 'Message',
      dataIndex: 'message',
      width: 280,
      ellipsis: true,
      search: false,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 110,
      render: (_, record) => {
        const info = STATUS_MAP[record.status] ?? { label: String(record.status), color: 'default' };
        return <Tag color={info.color}>{info.label}</Tag>;
      },
    },
    {
      title: 'Time',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: true,
    },
    {
      title: 'Action',
      key: 'action',
      width: 160,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => handleViewDetail(record.id)}
          >
            Detail
          </Button>
          <Popconfirm
            title="Confirm delete this error log?"
            onConfirm={async () => {
              try {
                await deleteError(record.id);
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
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<ErrorLog>
        headerTitle="Error Logs"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize, level, source, status } = params;
          const result = await getErrors({ page, pageSize, level, source, status });
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
              description={`Selected ${selectedRowKeys.length} error logs`}
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

      <Modal
        title="Error Detail"
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        onOk={handleSave}
        width={720}
        okText="Save"
      >
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="Level">
                <Tag color={LEVEL_COLORS[detail.level]}>{detail.level.toUpperCase()}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Source">{detail.source}</Descriptions.Item>
              <Descriptions.Item label="Message" span={2}>
                <Paragraph style={{ marginBottom: 0 }}>{detail.message}</Paragraph>
              </Descriptions.Item>
              <Descriptions.Item label="Time">{detail.createdAt}</Descriptions.Item>
              <Descriptions.Item label="Updated">{detail.updatedAt}</Descriptions.Item>
            </Descriptions>

            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Stack Trace</div>
              <pre
                style={{
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 4,
                  fontSize: 12,
                  maxHeight: 200,
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {detail.stack || '(no stack trace)'}
              </pre>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Status</div>
              <Select
                value={editStatus}
                onChange={(v) => setEditStatus(v)}
                options={STATUS_OPTIONS}
                style={{ width: 200 }}
              />
            </div>

            <div>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>Solution / Notes</div>
              <Text
                editable={{
                  onChange: (v) => setEditSolution(v),
                  autoSize: { minRows: 3, maxRows: 8 },
                }}
                style={{ display: 'block' }}
              >
                {editSolution || '(add solution notes...)'}
              </Text>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
