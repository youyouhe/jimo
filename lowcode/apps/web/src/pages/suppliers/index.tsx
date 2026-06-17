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
  getSuppliersList,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  batchDeleteSuppliers,
  type Supplier,
  type CreateSupplierDto,
  type UpdateSupplierDto,
} from '@/services/supplier';
import { getMyBtnPerms } from '@/services/authority-btn';


export default function SuppliersPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Supplier | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [searchName, setSearchName] = useState('');
  const [searchContactPerson, setSearchContactPerson] = useState('');
  const [searchPhone, setSearchPhone] = useState('');
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
      setBtnPerms(new Set(perms['./suppliers/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Supplier>[] = [
    {
      title: '供应商名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '联系人',
      dataIndex: 'contact_person',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.contact_person ?? '').localeCompare(String(b.contact_person ?? '')),
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.phone ?? '').localeCompare(String(b.phone ?? '')),
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.email ?? '').localeCompare(String(b.email ?? '')),
    },
    {
      title: '是否启用',
      dataIndex: 'is_active',
      valueType: 'switch',
      width: 100,
      search: false,
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
                  contact_person: record.contact_person,
                  phone: record.phone,
                  email: record.email,
                  address: record.address,
                  is_active: record.is_active,
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
                  await deleteSupplier(record.id);
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
        const dto: UpdateSupplierDto = {
          name: values.name || '',
          contact_person: values.contact_person || '',
          phone: values.phone || '',
          email: values.email || '',
          address: values.address || '',
          is_active: values.is_active ?? false,
        };
        await updateSupplier(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateSupplierDto = {
          name: values.name || '',
          contact_person: values.contact_person || '',
          phone: values.phone || '',
          email: values.email || '',
          address: values.address || '',
          is_active: values.is_active ?? false,
        };
        await createSupplier(dto);
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
      const result = await batchDeleteSuppliers(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Supplier>
        headerTitle="供应商（类型1：独立业务表示例）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchName, searchContactPerson, searchPhone }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getSuppliersList({ page, pageSize, name: searchName || undefined, contact_person: searchContactPerson || undefined, phone: searchPhone || undefined });
          
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
            placeholder="搜索供应商名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-contact_person"
            placeholder="搜索联系人"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchContactPerson)}
            onClear={() => setSearchContactPerson('')}
          />,
          <Input
            key="search-phone"
            placeholder="搜索联系电话"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchPhone)}
            onClear={() => setSearchPhone('')}
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
            label="供应商名称"
            placeholder="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="contact_person"
            label="联系人"
            placeholder="联系人"
            
            
          />

          <ProFormText
            name="phone"
            label="联系电话"
            placeholder="联系电话"
            
            
          />

          <ProFormText
            name="email"
            label="邮箱"
            placeholder="邮箱"
            
            
          />

          <ProFormTextArea
            name="address"
            label="地址"
            placeholder="地址"
            
            fieldProps={{ rows: 3 }}
          />

          <ProFormSwitch
            name="is_active"
            label="是否启用"
          />
      </ModalForm>
    </>
  );
}
