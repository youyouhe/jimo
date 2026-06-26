import { useRef, useState } from 'react';
import {
  Button,
  Drawer,
  message,
  Popconfirm,
  Space,
  Badge,
  Tag,
  Descriptions,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  EyeOutlined,
  StopOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { history } from '@umijs/max';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  getProcessList,
  updateProcess,
  deleteProcess,
  type BpmProcessDefinition,
  type ProcessStatus,
} from '@/services/bpm';
import VersionTimeline from './VersionTimeline';
import DeployButton from './DeployButton';

const STATUS_BADGE_MAP: Record<
  ProcessStatus,
  { badge: 'default' | 'processing' | 'success' | 'error' | 'warning'; label: string }
> = {
  draft: { badge: 'default', label: 'Draft' },
  published: { badge: 'processing', label: 'Published' },
  deployed: { badge: 'success', label: 'Deployed' },
  disabled: { badge: 'error', label: 'Disabled' },
};

export default function ProcessManagerPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentRecord, setCurrentRecord] =
    useState<BpmProcessDefinition | null>(null);

  const openDetail = (record: BpmProcessDefinition) => {
    setCurrentRecord(record);
    setDrawerOpen(true);
  };

  const closeDetail = () => {
    setDrawerOpen(false);
    setCurrentRecord(null);
  };

  const handleToggleStatus = async (record: BpmProcessDefinition) => {
    try {
      const newStatus: ProcessStatus =
        record.status === 'disabled' ? 'draft' : 'disabled';
      await updateProcess(record.id, { status: newStatus });
      message.success(
        newStatus === 'disabled' ? 'Process disabled' : 'Process enabled',
      );
      actionRef.current?.reload();
      if (currentRecord?.id === record.id) {
        setCurrentRecord({ ...record, status: newStatus });
      }
    } catch (err: any) {
      message.error(err?.message || 'Operation failed');
    }
  };

  const handleDelete = async (record: BpmProcessDefinition) => {
    try {
      await deleteProcess(record.id);
      message.success('Process deleted');
      if (currentRecord?.id === record.id) {
        closeDetail();
      }
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err?.message || 'Delete failed');
    }
  };

  const columns: ProColumns<BpmProcessDefinition>[] = [
    {
      title: 'Keyword',
      dataIndex: 'keyword',
      hideInTable: true,
      fieldProps: { placeholder: 'Search by name or key' },
    },
    {
      title: 'Name',
      dataIndex: 'name',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_, record) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={() => openDetail(record)}
        >
          {record.name}
        </Button>
      ),
    },
    {
      title: 'Key',
      dataIndex: 'key',
      width: 160,
      copyable: true,
      ellipsis: true,
      search: false,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 120,
      valueType: 'select',
      fieldProps: { allowClear: true, placeholder: 'Filter by status' },
      valueEnum: {
        draft: { text: 'Draft', status: 'Default' },
        published: { text: 'Published', status: 'Processing' },
        deployed: { text: 'Deployed', status: 'Success' },
        disabled: { text: 'Disabled', status: 'Error' },
      },
      render: (_, record) => {
        const meta = STATUS_BADGE_MAP[record.status];
        if (!meta) return <Tag>{record.status}</Tag>;
        return (
          <Badge status={meta.badge} text={meta.label} />
        );
      },
    },
    {
      title: 'Category',
      dataIndex: 'category',
      width: 120,
      ellipsis: true,
      fieldProps: { allowClear: true, placeholder: 'Filter by category' },
      render: (_, record) =>
        record.category ? (
          <Tag>{record.category}</Tag>
        ) : (
          <Tag color="default">-</Tag>
        ),
    },
    {
      title: 'Version',
      dataIndex: 'currentVersionId',
      width: 100,
      search: false,
      render: (_, record) =>
        record.currentVersionId ? (
          <Tag color="blue">v*</Tag>
        ) : (
          <Tag color="default">-</Tag>
        ),
    },
    {
      title: 'Updated At',
      dataIndex: 'updatedAt',
      width: 180,
      valueType: 'dateTime',
      search: false,
      sorter: true,
    },
    {
      title: 'Actions',
      key: 'action',
      width: 280,
      search: false,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => openDetail(record)}
          >
            View
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() =>
              history.push(`/tools/bpm-designer?id=${record.id}`)
            }
          >
            Edit
          </Button>
          <DeployButton
            definitionId={record.id}
            onSuccess={() => actionRef.current?.reload()}
          />
          <Popconfirm
            title={
              record.status === 'disabled'
                ? 'Enable this process?'
                : 'Disable this process?'
            }
            onConfirm={() => handleToggleStatus(record)}
            okText="Confirm"
            cancelText="Cancel"
          >
            <Button
              type="link"
              size="small"
              icon={
                record.status === 'disabled' ? (
                  <CheckCircleOutlined />
                ) : (
                  <StopOutlined />
                )
              }
            >
              {record.status === 'disabled' ? 'Enable' : 'Disable'}
            </Button>
          </Popconfirm>
          <Popconfirm
            title="Delete this process?"
            description="The process will be soft-deleted and cannot be recovered."
            onConfirm={() => handleDelete(record)}
            okText="Confirm"
            cancelText="Cancel"
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
            >
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<BpmProcessDefinition>
        headerTitle="Process Management"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const {
            current: page,
            pageSize,
            keyword,
            status,
            category,
          } = params;
          const result = await getProcessList({
            page,
            pageSize,
            keyword,
            status: status as ProcessStatus | undefined,
            category,
          });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => history.push('/tools/bpm-designer')}
          >
            New Process
          </Button>,
        ]}
      />

      {/* Detail Drawer */}
      <Drawer
        title={
          currentRecord ? `Process: ${currentRecord.name}` : 'Process Detail'
        }
        open={drawerOpen}
        onClose={closeDetail}
        width={560}
        destroyOnHidden
      >
        {currentRecord && (
          <>
            <Descriptions
              column={1}
              bordered
              size="small"
              style={{ marginBottom: 24 }}
            >
              <Descriptions.Item label="Name">
                {currentRecord.name}
              </Descriptions.Item>
              <Descriptions.Item label="Key">
                <Typography.Text copyable>
                  {currentRecord.key}
                </Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                <Badge
                  status={
                    STATUS_BADGE_MAP[currentRecord.status]?.badge ??
                    'default'
                  }
                  text={
                    STATUS_BADGE_MAP[currentRecord.status]?.label ??
                    currentRecord.status
                  }
                />
              </Descriptions.Item>
              <Descriptions.Item label="Category">
                {currentRecord.category || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Description">
                {currentRecord.description || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Created At">
                {currentRecord.createdAt}
              </Descriptions.Item>
              <Descriptions.Item label="Updated At">
                {currentRecord.updatedAt}
              </Descriptions.Item>
            </Descriptions>

            <Typography.Title level={5}>Version History</Typography.Title>
            <VersionTimeline
              definitionId={currentRecord.id}
              currentVersionId={currentRecord.currentVersionId}
            />
          </>
        )}
      </Drawer>
    </>
  );
}
