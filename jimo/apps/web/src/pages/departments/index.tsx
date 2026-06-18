import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button, message, Popconfirm, Space, Form, Table, Input, Tooltip } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,
  ProFormSelect,
} from '@ant-design/pro-components';
import {
  getDepartmentsList,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  batchDeleteDepartments,
  getDepartmentOptions,
  type Department,
  type CreateDepartmentDto,
  type UpdateDepartmentDto,
} from '@/services/department';
import { getMyBtnPerms } from '@/services/authority-btn';


export default function DepartmentsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Department | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [searchName, setSearchName] = useState('');
  const [searchCode, setSearchCode] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./departments/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Department>[] = [
    {
      title: '部门名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '部门编码',
      dataIndex: 'code',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')),
    },
    {
      title: '部门描述',
      dataIndex: 'description',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.description ?? '').localeCompare(String(b.description ?? '')),
    },
    {
      title: '上级部门',
      dataIndex: 'parent_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.parent_id_display || record.parent_id,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '创建人',
      dataIndex: 'createdBy',
      valueType: 'text',
      width: 120,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          {btnPerms.has('edit') && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  name: record.name,
                  code: record.code,
                  description: record.description,
                  parent_id: record.parent_id,
                });
                setEditingRecord(record);
                
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          {btnPerms.has('delete') && (
            <Popconfirm
              title="确认删除？"
              description="删除后无法恢复。"
              onConfirm={async () => {
                try {
                  await deleteDepartment(record.id);
                  message.success('删除成功');
                  actionRef.current?.reload();
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
          )}
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingRecord) {
        const dto: UpdateDepartmentDto = {
          name: values.name || '',
          code: values.code || '',
          description: values.description || '',
          parent_id: values.parent_id || undefined,
        };
        await updateDepartment(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateDepartmentDto = {
          name: values.name || '',
          code: values.code || '',
          description: values.description || '',
          parent_id: values.parent_id || undefined,
        };
        await createDepartment(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingRecord(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteDepartments(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Department>
        headerTitle={<Tooltip title="存储组织架构中的部门信息，支持树形层级"><span>部门表</span></Tooltip>}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchName, searchCode }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getDepartmentsList({ page, pageSize, name: searchName || undefined, code: searchCode || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
          <Input
            key="search-name"
            placeholder="搜索部门名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-code"
            placeholder="搜索部门编码"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchCode)}
            onClear={() => setSearchCode('')}
          />,
          </Space>,
          btnPerms.has('add') && (
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditingRecord(null);
                
                setModalOpen(true);
              }}
            >
              新建
            </Button>
          ),
          btnPerms.has('batchDelete') && selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="确认批量删除？"
              description={`已选择 ${selectedRowKeys.length} 条记录，删除后无法恢复。`}
              onConfirm={handleBatchDelete}
              okText="确认"
              cancelText="取消"
            >
              <Button danger>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ].filter(Boolean)}
      />

      <ModalForm
        title={editingRecord ? '编辑' : '新建'}
        open={modalOpen}
        form={form}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="name"
            label="部门名称"
            placeholder="部门名称"
            rules={[{ required: true, message: '请输入部门名称' }]}
            
          />

          <ProFormText
            name="code"
            label="部门编码"
            placeholder="部门编码"
            rules={[{ required: true, message: '请输入部门编码' }]}
            disabled={!!editingRecord}
          />

          <ProFormTextArea
            name="description"
            label="部门描述"
            placeholder="部门描述"
            
            fieldProps={{ rows: 3 }}
          />

          <ProFormSelect
            name="parent_id"
            label="上级部门"
            
            request={async () => {
              const res = await getDepartmentOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />
      </ModalForm>
    </>
  );
}
