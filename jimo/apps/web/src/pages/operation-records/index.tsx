import { useRef, useState, useMemo } from 'react';
import { Button, message, Popconfirm, Tag, Drawer, Select, DatePicker, Space, Input } from 'antd';
import { DeleteOutlined, ClearOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import dayjs, { Dayjs } from 'dayjs';
import {
  getRecords,
  deleteRecord,
  batchDeleteRecords,
  type OperationRecord,
} from '@/services/operation-record';
import { useUserStore } from '@/stores/user';

const { RangePicker } = DatePicker;

const METHOD_COLORS: Record<string, string> = {
  GET: 'default',
  POST: 'blue',
  PATCH: 'orange',
  DELETE: 'red',
  PUT: 'purple',
};

function statusColor(status: number): string {
  if (status < 200) return 'default';
  if (status < 300) return 'green';
  if (status < 400) return 'blue';
  if (status < 500) return 'orange';
  return 'red';
}

function formatJsonForDisplay(raw: string | undefined): string {
  if (!raw) return '(empty)';
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return raw;
  }
}

export default function OperationRecordsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerRecord, setDrawerRecord] = useState<OperationRecord | null>(null);
  const userRoles = useUserStore((s) => s.userInfo?.roles) ?? [];
  const isSuperAdmin = userRoles.includes('super_admin');

  const columns: ProColumns<OperationRecord>[] = [
    {
      title: 'IP',
      dataIndex: 'ip',
      width: 140,
      copyable: true,
      search: false,
    },
    {
      title: 'Method',
      dataIndex: 'method',
      width: 100,
      render: (_, record) => (
        <Tag color={METHOD_COLORS[record.method] || 'default'}>{record.method}</Tag>
      ),
      renderFormItem: () => (
        <Select
          allowClear
          placeholder="All"
          options={['GET', 'POST', 'PATCH', 'DELETE', 'PUT'].map((m) => ({
            value: m,
            label: m,
          }))}
        />
      ),
    },
    {
      title: 'Path',
      dataIndex: 'path',
      width: 220,
      ellipsis: true,
      copyable: true,
      renderFormItem: () => <Input placeholder="Search path..." allowClear />,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      render: (_, record) => {
        const col = statusColor(record.status);
        return <Tag color={col}>{record.status}</Tag>;
      },
      renderFormItem: () => (
        <Select
          allowClear
          placeholder="All"
          options={[
            { value: '2xx', label: '2xx' },
            { value: '4xx', label: '4xx' },
            { value: '5xx', label: '5xx' },
          ]}
        />
      ),
      // Parse "2xx"/"4xx"/"5xx" into actual numeric filter values
      search: {
        transform: (value: string) => {
          if (value === '2xx') return { status: 200 };
          if (value === '4xx') return { status: 400 };
          if (value === '5xx') return { status: 500 };
          return { status: undefined };
        },
      },
    },
    {
      title: 'Latency',
      dataIndex: 'latency',
      width: 100,
      search: false,
      render: (_, record) => `${record.latency}ms`,
    },
    {
      title: 'User Agent',
      dataIndex: 'agent',
      ellipsis: true,
      search: false,
    },
    {
      title: 'Time',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      defaultSortOrder: 'descend',
      search: false,
    },
    {
      title: 'Action',
      key: 'action',
      width: 80,
      search: false,
      fixed: 'right',
      render: (_, record) =>
        isSuperAdmin ? (
          <Popconfirm
            title="Delete this record?"
            description="This action cannot be undone."
            onConfirm={async () => {
              try {
                await deleteRecord(record.id);
                message.success('Deleted');
                actionRef.current?.reload();
                setSelectedRowKeys((prev) => prev.filter((k) => k !== record.id));
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
        ) : null,
    },
  ];

  /**
   * Build date quick-filter presets for the RangePicker in the toolbar.
   */
  const datePresets = useMemo(() => {
    const today = dayjs().endOf('day');
    const presets: { label: string; value: [Dayjs, Dayjs] }[] = [
      { label: 'Today', value: [dayjs().startOf('day'), today] },
      {
        label: 'Last 7 days',
        value: [dayjs().subtract(6, 'day').startOf('day'), today],
      },
      {
        label: 'Last 30 days',
        value: [dayjs().subtract(29, 'day').startOf('day'), today],
      },
    ];
    return presets;
  }, []);

  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs] | null>(null);

  return (
    <>
      <ProTable<OperationRecord>
        headerTitle="Operation Audit Log"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, method, path } = params;
          // Parse status from 2xx/4xx/5xx filter
          const statusRaw = params.status as unknown;
          let status: number | undefined;
          if (typeof statusRaw === 'string') {
            const val = statusRaw as string;
            if (val === '2xx') status = 200;
            else if (val === '4xx') status = 400;
            else if (val === '5xx') status = 500;
          }
          const startDate = dateRange ? dateRange[0].toISOString() : undefined;
          const endDate = dateRange ? dateRange[1].toISOString() : undefined;
          const result = await getRecords({
            page,
            pageSize,
            method,
            path,
            status,
            startDate,
            endDate,
          });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        rowSelection={
          isSuperAdmin
            ? {
                selectedRowKeys,
                onChange: (keys) => setSelectedRowKeys(keys as string[]),
              }
            : undefined
        }
        onRow={(record) => ({
          style: { cursor: 'pointer' },
          onClick: () => {
            setDrawerRecord(record);
            setDrawerOpen(true);
          },
        })}
        toolBarRender={() => [
          <RangePicker
            key="dateRange"
            presets={datePresets as any}
            value={dateRange as any}
            onChange={(values) => {
              if (values && values[0] && values[1]) {
                setDateRange([values[0], values[1]]);
              } else {
                setDateRange(null);
              }
              setTimeout(() => actionRef.current?.reload(), 0);
            }}
            allowClear
          />,
          isSuperAdmin && selectedRowKeys.length > 0 ? (
            <Popconfirm
              key="batch-delete"
              title={`Delete ${selectedRowKeys.length} records?`}
              description="This action cannot be undone."
              onConfirm={async () => {
                try {
                  const result = await batchDeleteRecords(selectedRowKeys);
                  message.success(`Deleted ${result.count} records`);
                  setSelectedRowKeys([]);
                  actionRef.current?.reload();
                } catch (err: any) {
                  message.error(err.message || 'Batch delete failed');
                }
              }}
              okText="Confirm"
              cancelText="Cancel"
            >
              <Button danger icon={<DeleteOutlined />}>
                Batch Delete ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ) : null,
          dateRange ? (
            <Button
              key="clear-date"
              icon={<ClearOutlined />}
              onClick={() => {
                setDateRange(null);
                setTimeout(() => actionRef.current?.reload(), 0);
              }}
            >
              Clear Date
            </Button>
          ) : null,
        ]}
      />

      <Drawer
        title="Record Detail"
        open={drawerOpen}
        onClose={() => {
          setDrawerOpen(false);
          setDrawerRecord(null);
        }}
        width={640}
        destroyOnClose
      >
        {drawerRecord && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <strong>Body (Request):</strong>
              <pre
                style={{
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {formatJsonForDisplay(drawerRecord.body)}
              </pre>
            </div>
            <div>
              <strong>Response:</strong>
              <pre
                style={{
                  background: '#f5f5f5',
                  padding: 12,
                  borderRadius: 4,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {formatJsonForDisplay(drawerRecord.resp)}
              </pre>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
