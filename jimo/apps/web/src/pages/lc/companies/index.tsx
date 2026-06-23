import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
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
  ProFormDateTimePicker,
} from '@ant-design/pro-components';
import {
  getCompaniesList,
  createCompany,
  updateCompany,
  deleteCompany,
  batchDeleteCompanies,
  type Company,
  type CreateCompanyDto,
  type UpdateCompanyDto,
} from '@/services/lc/company';
import ReassignModal from '@/components/ReassignModal';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function CompaniesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Company | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [form] = Form.useForm();
  const [statusOptions, setStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchName, setSearchName] = useState('');
  const [searchCode, setSearchCode] = useState('');
  const [searchShortName, setSearchShortName] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchContactPerson, setSearchContactPerson] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('company_status').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      setStatusOptions(map);
    }).catch(() => {});

  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./lc/companies/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Company>[] = [
    {
      title: '公司名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '公司编码',
      dataIndex: 'code',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.code ?? '').localeCompare(String(b.code ?? '')),
    },
    {
      title: '公司简称',
      dataIndex: 'short_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.short_name ?? '').localeCompare(String(b.short_name ?? '')),
    },
    {
      title: '公司状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: statusOptions,
    },
    {
      title: '联系人',
      dataIndex: 'contact_person',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.contact_person ?? '').localeCompare(String(b.contact_person ?? '')),
    },
    {
      title: '成立日期',
      dataIndex: 'established_at',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.established_at as string).getTime() - new Date(b.established_at as string).getTime(),
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
                  short_name: record.short_name,
                  status: record.status,
                  address: record.address,
                  contact_person: record.contact_person,
                  contact_phone: record.contact_phone,
                  description: record.description,
                  established_at: record.established_at ? dayjs(record.established_at) : null,
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
                  await deleteCompany(record.id);
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
        const dto: UpdateCompanyDto = {
          name: values.name || '',
          code: values.code || '',
          short_name: values.short_name || '',
          status: values.status || '',
          address: values.address || '',
          contact_person: values.contact_person || '',
          contact_phone: values.contact_phone || '',
          description: values.description || '',
          established_at: values.established_at && typeof values.established_at === 'object' ? values.established_at.toISOString() : values.established_at || undefined,
        };
        await updateCompany(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateCompanyDto = {
          name: values.name || '',
          code: values.code || '',
          short_name: values.short_name || '',
          status: values.status || '',
          address: values.address || '',
          contact_person: values.contact_person || '',
          contact_phone: values.contact_phone || '',
          description: values.description || '',
          established_at: values.established_at && typeof values.established_at === 'object' ? values.established_at.toISOString() : values.established_at || undefined,
        };
        await createCompany(dto);
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
      const result = await batchDeleteCompanies(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Company>
        headerTitle={<Tooltip title="存储公司基本信息"><span>公司表</span></Tooltip>}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchName, searchCode, searchShortName, searchStatus, searchContactPerson }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getCompaniesList({ page, pageSize, name: searchName || undefined, code: searchCode || undefined, short_name: searchShortName || undefined, status: searchStatus || undefined, contact_person: searchContactPerson || undefined });
          
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
            placeholder="搜索公司名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-code"
            placeholder="搜索公司编码"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchCode)}
            onClear={() => setSearchCode('')}
          />,
          <Input
            key="search-short_name"
            placeholder="搜索公司简称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchShortName)}
            onClear={() => setSearchShortName('')}
          />,
          <Input
            key="search-status"
            placeholder="搜索公司状态"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStatus)}
            onClear={() => setSearchStatus('')}
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
          selectedRowKeys.length > 0 && (
            <Button
              key="reassign"
              onClick={() => setReassignOpen(true)}
            >
              移交 ({selectedRowKeys.length})
            </Button>
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
            label="公司名称"
            placeholder="公司名称"
            rules={[{ required: true, message: '请输入公司名称' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="code"
            label="公司编码"
            placeholder="公司编码"
            rules={[{ required: true, message: '请输入公司编码' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="short_name"
            label="公司简称"
            placeholder="公司简称"
            
            
          />

          <ProFormSelect
            name="status"
            label="公司状态"
            
            request={async () => {
              const list = await getDictDetailsByType('company_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormTextArea
            name="address"
            label="公司地址"
            placeholder="公司地址"
            
            fieldProps={{ rows: 3 }}
          />

          <ProFormText
            name="contact_person"
            label="联系人"
            placeholder="联系人"
            
            
          />

          <ProFormText
            name="contact_phone"
            label="联系电话"
            placeholder="联系电话"
            
            
          />

          <ProFormTextArea
            name="description"
            label="公司描述"
            placeholder="公司描述"
            
            fieldProps={{ rows: 3 }}
          />

          <ProFormDateTimePicker
            name="established_at"
            label="成立日期"
            placeholder="成立日期"
            
            
          />
      </ModalForm>

      <ReassignModal
        open={reassignOpen}
        businessType="companies"
        ids={selectedRowKeys}
        onClose={() => setReassignOpen(false)}
        onSuccess={() => {
          setSelectedRowKeys([]);
          actionRef.current?.reload();
        }}
      />
    </>
  );
}
