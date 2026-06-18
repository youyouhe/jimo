import { useRef, useState } from 'react';
import { history } from '@umijs/max';
import { Button, Drawer, message, Popconfirm, Space, Typography, Tabs, Input, Tag, Switch } from 'antd';
import { PlusOutlined, EyeOutlined, RocketOutlined, DeleteOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable, ModalForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  getAutoCodePackages,
  createAutoCodePackage,
  getAutoCodePackageDetail,
  updateAutoCodePackage,
  deleteAutoCodePackage,
  type AutoCodePackage,
  type CreateAutoCodePackageDto,
  type UpdateAutoCodePackageDto,
} from '@/services/autocode';

const { Text, Title } = Typography;
const { TextArea } = Input;

function getFileLabel(path: string): string {
  if (path.includes('schema')) return 'Schema';
  if (path.includes('create-') && path.includes('.dto')) return 'Create DTO';
  if (path.includes('query-') && path.includes('.dto')) return 'Query DTO';
  if (path.includes('update-') && path.includes('.dto')) return 'Update DTO';
  if (path.endsWith('.service.ts')) return 'Service';
  if (path.endsWith('.controller.ts')) return 'Controller';
  if (path.endsWith('.module.ts')) return 'Module';
  if (path.includes('/services/')) return 'Frontend Service';
  if (path.includes('/pages/')) return 'Frontend Page';
  return path.split('/').pop() || path;
}

export default function AutocodePackagesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [includeDeleted, setIncludeDeleted] = useState(false);

  // Create/Edit modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AutoCodePackage | null>(null);

  // Detail drawer state
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRecord, setDetailRecord] = useState<AutoCodePackage | null>(null);
  const [detailFiles, setDetailFiles] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('');

  const handleViewDetail = async (id: string) => {
    try {
      const record = await getAutoCodePackageDetail(id);
      setDetailRecord(record);
      setDetailFiles(record.templates || {});
      const filePaths = Object.keys(record.templates || {});
      if (filePaths.length > 0) {
        setActiveTab(filePaths[0]!);
      }
      setDetailOpen(true);
    } catch (err: any) {
      message.error(err.message || 'Failed to load package detail');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAutoCodePackage(id);
      message.success('Package deleted');
      actionRef.current?.reload();
    } catch (err: any) {
      const errMsg = err?.response?.data?.msg || err?.message || 'Delete failed';
      message.error(errMsg);
    }
  };

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      let templates: Record<string, string> = {};
      if (values.templatesRaw) {
        try {
          templates = JSON.parse(values.templatesRaw);
        } catch {
          message.error('Templates must be valid JSON (key: filepath, value: source code)');
          return false;
        }
      }

      if (editingRecord) {
        const dto: UpdateAutoCodePackageDto = {
          name: values.name,
          description: values.description || '',
          templates,
        };
        await updateAutoCodePackage(editingRecord.id, dto);
        message.success('Package updated');
      } else {
        const dto: CreateAutoCodePackageDto = {
          name: values.name,
          description: values.description || '',
          templates,
        };
        await createAutoCodePackage(dto);
        message.success('Package created');
      }

      setModalOpen(false);
      setEditingRecord(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      const errMsg = err?.response?.data?.msg || err?.message || 'Operation failed';
      message.error(errMsg);
      return false;
    }
  };

  const columns: ProColumns<AutoCodePackage>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      width: 180,
      search: true,  // Enable name search
    },
    {
      title: 'Description',
      dataIndex: 'description',
      width: 200,
      search: false,
      render: (_, record) => record.description || '-',
    },
    {
      title: 'Table Name',
      dataIndex: 'tableName',
      width: 140,
      search: false,
      render: (_, record) => record.tableName ? <Tag>{record.tableName}</Tag> : '-',
    },
    {
      title: 'Fields',
      search: false,
      width: 80,
      render: (_, record) => {
        const count = record.fields?.length ?? 0;
        return count > 0 ? <Tag color="blue">{count}</Tag> : '-';
      },
    },
    {
      title: 'Templates',
      search: false,
      width: 90,
      render: (_, record) => {
        const count = Object.keys(record.templates || {}).length;
        return count > 0 ? <Tag color="green">{count}</Tag> : '-';
      },
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'Deleted At',
      dataIndex: 'deletedAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      hideInTable: !includeDeleted,
      render: (_, record) =>
        record.deletedAt ? (
          <Tag color="red" icon={<DeleteOutlined />}>
            {new Date(record.deletedAt).toLocaleString()}
          </Tag>
        ) : '-',
    },
    {
      title: 'Action',
      key: 'action',
      width: 260,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<RocketOutlined />}
            onClick={() => {
              // Navigate to code generator with package pre-loaded
              history.push(`/tools/autocode?packageId=${record.id}`);
            }}
          >
            Apply
          </Button>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={() => handleViewDetail(record.id)}
          >
            View
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingRecord(record);
              setModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this package? Its directory menu will also be removed."
            onConfirm={() => handleDelete(record.id)}
            okText="Delete"
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

  const tabItems = Object.entries(detailFiles).map(([path, content]) => ({
    key: path,
    label: getFileLabel(path),
    children: (
      <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
        <pre
          style={{
            background: '#1e1e1e',
            color: '#d4d4d4',
            padding: 16,
            borderRadius: 6,
            fontSize: 13,
            lineHeight: 1.6,
            overflowX: 'auto',
            whiteSpace: 'pre',
            margin: 0,
          }}
        >
          <code>{content}</code>
        </pre>
      </div>
    ),
  }));

  return (
    <div style={{ padding: '0 0 24px 0' }}>
      <Title level={4} style={{ marginBottom: 16 }}>
        <PlusOutlined /> Template Packages
      </Title>

      <ProTable<AutoCodePackage>
        headerTitle="Package List"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, name } = params;
          const result = await getAutoCodePackages({ page, pageSize, name, includeDeleted });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Space key="deleted-toggle">
            <span style={{ color: '#666', fontSize: 13 }}>Show Deleted</span>
            <Switch
              size="small"
              checked={includeDeleted}
              onChange={(v) => {
                setIncludeDeleted(v);
                actionRef.current?.reload();
              }}
            />
          </Space>,
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingRecord(null);
              setModalOpen(true);
            }}
          >
            Create Package
          </Button>,
        ]}
      />

      {/* Create/Edit Modal */}
      <ModalForm
        title={editingRecord ? 'Edit Package' : 'Create Package'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingRecord(null);
          }
        }}
        initialValues={
          editingRecord
            ? {
                name: editingRecord.name,
                description: editingRecord.description,
                templatesRaw: JSON.stringify(editingRecord.templates, null, 2),
              }
            : { templatesRaw: '{}' }
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="name"
          label="Package Name"
          placeholder="e.g. Standard CRUD Template"
          rules={[{ required: true, message: 'Please enter package name' }]}
        />
        <ProFormTextArea
          name="description"
          label="Description"
          placeholder="Optional description"
          fieldProps={{ rows: 2 }}
        />
        <ProFormTextArea
          name="templatesRaw"
          label="Templates (JSON)"
          tooltip="也可在代码生成器中使用 'Save as Package' 自动保存"
          placeholder='e.g. {"path/to/file.ts": "source code..."}'
          rules={[{ required: true, message: 'Please enter templates JSON' }]}
          fieldProps={{ rows: 10 }}
        />
      </ModalForm>

      {/* Detail Drawer */}
      <Drawer
        title={
          <Space>
            <Text strong>Package Detail</Text>
            {detailRecord && (
              <Text type="secondary">
                ({detailRecord.name} - {Object.keys(detailFiles).length} templates)
              </Text>
            )}
          </Space>
        }
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setDetailRecord(null);
          setDetailFiles({});
        }}
        width="80%"
      >
        {Object.keys(detailFiles).length > 0 && (
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            tabPosition="left"
            style={{ minHeight: 400 }}
            items={tabItems}
          />
        )}
        {Object.keys(detailFiles).length === 0 && (
          <Text type="secondary">No templates stored in this package.</Text>
        )}
      </Drawer>
    </div>
  );
}
