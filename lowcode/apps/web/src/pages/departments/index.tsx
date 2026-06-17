import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button, message, Popconfirm, Space, Form, Table, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,
} from '@ant-design/pro-components';
import {
  getDepartmentsList,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  batchDeleteDepartments,
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
  const [searchManagerName, setSearchManagerName] = useState('');
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
      title: '负责人',
      dataIndex: 'manager_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.manager_name ?? '').localeCompare(String(b.manager_name ?? '')),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.phone ?? '').localeCompare(String(b.phone ?? '')),
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
                  manager_name: record.manager_name,
                  phone: record.phone,
                  description: record.description,
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
          manager_name: values.manager_name || '',
          phone: values.phone || '',
          description: values.description || '',
        };
        await updateDepartment(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateDepartmentDto = {
          name: values.name || '',
          manager_name: values.manager_name || '',
          phone: values.phone || '',
          description: values.description || '',
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
        headerTitle="部门表（为类型4挂载已有表准备）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchName, searchManagerName }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getDepartmentsList({ page, pageSize, name: searchName || undefined, manager_name: searchManagerName || undefined });
          
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
            key="search-manager_name"
            placeholder="搜索负责人"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchManagerName)}
            onClear={() => setSearchManagerName('')}
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
            disabled={!!editingRecord}
          />

          <ProFormText
            name="manager_name"
            label="负责人"
            placeholder="负责人"
            
            
          />

          <ProFormText
            name="phone"
            label="联系电话"
            placeholder="联系电话"
            
            
          />

          <ProFormTextArea
            name="description"
            label="部门描述"
            placeholder="部门描述"
            
            fieldProps={{ rows: 3 }}
          />
      </ModalForm>
    </>
  );
}
