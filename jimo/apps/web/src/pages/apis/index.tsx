import { useRef, useState, useEffect, useCallback } from 'react';
import { Button, message, Popconfirm, Space, Tag, Menu, Spin } from 'antd';
import { PlusOutlined, ApiOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormTextArea, ProFormSelect } from '@ant-design/pro-components';
import {
  getApis,
  createApi,
  updateApi,
  deleteApi,
  batchDeleteApis,
  getApiGroups,
  type Api,
  type CreateApiDto,
  type UpdateApiDto,
  type ApiGroupItem,
} from '@/services/api';

const METHOD_OPTIONS = [
  { label: 'GET', value: 'GET' },
  { label: 'POST', value: 'POST' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' },
  { label: 'DELETE', value: 'DELETE' },
];

const METHOD_COLORS: Record<string, string> = {
  GET: 'blue',
  POST: 'green',
  PUT: 'cyan',
  PATCH: 'orange',
  DELETE: 'red',
};

export default function ApisPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApi, setEditingApi] = useState<Api | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string>('');
  const [groups, setGroups] = useState<ApiGroupItem[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    try {
      const data = await getApiGroups(true);
      setGroups((data as ApiGroupItem[]) || []);
    } catch {
      setGroups([]);
    } finally {
      setGroupsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const columns: ProColumns<Api>[] = [
    {
      title: 'Method',
      dataIndex: 'method',
      width: 100,
      render: (_, record) => (
        <Tag color={METHOD_COLORS[record.method] ?? 'default'}>
          {record.method}
        </Tag>
      ),
    },
    {
      title: '路径',
      dataIndex: 'path',
      width: 280,
      copyable: true,
      ellipsis: true,
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      search: false,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingApi(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该API？"
            description="删除后将会移除对应的权限策略。"
            onConfirm={async () => {
              try {
                await deleteApi(record.id);
                message.success('删除成功');
                actionRef.current?.reload();
                loadGroups();
              } catch (err: any) {
                message.error(err.message || '删除失败');
              }
            }}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingApi) {
        const dto: UpdateApiDto = {
          method: values.method,
          path: values.path,
          description: values.description || '',
          apiGroup: values.apiGroup || 'default',
        };
        await updateApi(editingApi.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateApiDto = {
          method: values.method,
          path: values.path,
          description: values.description || '',
          apiGroup: values.apiGroup || 'default',
        };
        await createApi(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingApi(null);
      actionRef.current?.reload();
      loadGroups();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteApis(selectedRowKeys);
      message.success(`成功删除 ${result.count} 个API`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
      loadGroups();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  const menuItems = [
    {
      key: '',
      label: (
        <span>
          <ApiOutlined style={{ marginRight: 8 }} />
          全部分组
          <span style={{ float: 'right', color: '#999' }}>
            {groups.reduce((sum, g) => sum + g.count, 0)}
          </span>
        </span>
      ),
    },
    ...groups.map((g) => ({
      key: g.group,
      label: (
        <span>
          {g.group}
          <span style={{ float: 'right', color: '#999' }}>{g.count}</span>
        </span>
      ),
    })),
  ];

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      {/* Left sidebar */}
      <div
        style={{
          width: 220,
          flexShrink: 0,
          background: '#fff',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 16px',
            fontSize: 14,
            fontWeight: 600,
            borderBottom: '1px solid #f0f0f0',
          }}
        >
          API 分组
        </div>
        <div style={{ maxHeight: 'calc(100vh - 200px)', overflow: 'auto' }}>
          {groupsLoading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <Spin />
            </div>
          ) : (
            <Menu
              mode="inline"
              selectedKeys={[selectedGroup]}
              style={{ border: 'none' }}
              items={menuItems}
              onClick={({ key }) => {
                setSelectedGroup(key);
                actionRef.current?.reload();
              }}
            />
          )}
        </div>
      </div>

      {/* Right table */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <ProTable<Api>
          headerTitle={
            selectedGroup ? `${selectedGroup} APIs` : 'API 管理'
          }
          actionRef={actionRef}
          rowKey="id"
          columns={columns}
          rowSelection={{
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(keys as string[]),
          }}
          params={{ apiGroup: selectedGroup }}
          request={async (params) => {
            const { current: page, pageSize, method, path, apiGroup } = params;
            const result = await getApis({
              page,
              pageSize,
              method,
              path,
              apiGroup: apiGroup || undefined,
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
              onClick={() => {
                setEditingApi(null);
                setModalOpen(true);
              }}
            >
              新建API
            </Button>,
            selectedRowKeys.length > 0 && (
              <Popconfirm
                key="batch-delete"
                title="确认批量删除？"
                description={`已选择 ${selectedRowKeys.length} 个API，删除后将会移除对应的权限策略。`}
                onConfirm={handleBatchDelete}
                okText="确认"
                cancelText="取消"
              >
                <Button danger>
                  批量删除 ({selectedRowKeys.length})
                </Button>
              </Popconfirm>
            ),
          ]}
        />
      </div>

      <ModalForm
        title={editingApi ? '编辑API' : '新建API'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingApi(null);
          }
        }}
        initialValues={
          editingApi
            ? {
                method: editingApi.method,
                path: editingApi.path,
                description: editingApi.description,
                apiGroup: editingApi.apiGroup,
              }
            : { method: 'GET', apiGroup: selectedGroup || 'default' }
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true, width: 560 }}
      >
        <ProFormSelect
          name="method"
          label="请求方法"
          options={METHOD_OPTIONS}
          rules={[{ required: true, message: '请选择请求方法' }]}
        />
        <ProFormText
          name="path"
          label="路径"
          placeholder="例如: /api/v1/users"
          rules={[
            { required: true, message: '请输入API路径' },
            { pattern: /^\//, message: '路径必须以 / 开头' },
          ]}
        />
        <ProFormText
          name="apiGroup"
          label="API分组"
          placeholder="例如: lc/student"
          rules={[{ required: true, message: '请输入API分组名称' }]}
        />
        <ProFormTextArea
          name="description"
          label="描述"
          placeholder="API功能描述（可选）"
          fieldProps={{ rows: 3 }}
        />
      </ModalForm>
    </div>
  );
}
