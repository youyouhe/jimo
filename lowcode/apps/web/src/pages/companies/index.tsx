import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import { Button, message, Popconfirm, Space, Form, Table, Input, Upload } from 'antd';
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
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
} from '@/services/company';
import { getMyBtnPerms } from '@/services/authority-btn';
import { uploadFile } from '@/services/file';
import { getDictDetailsByType } from '@/services/dictionary';


export default function CompaniesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Company | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [statusOptions, setStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchName, setSearchName] = useState('');
  const [searchShortName, setSearchShortName] = useState('');
  const [searchCreditCode, setSearchCreditCode] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
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
      setBtnPerms(new Set(perms['./companies/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Company>[] = [
    {
      title: '公司全称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '公司简称',
      dataIndex: 'short_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.short_name ?? '').localeCompare(String(b.short_name ?? '')),
    },
    {
      title: '公司Logo',
      dataIndex: 'logo',
      valueType: 'image',
      width: 120,
      search: false,
      render: (_, record) => record.logo ? <img src={record.logo} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 4 }} /> : '-',
    },
    {
      title: '统一社会信用代码',
      dataIndex: 'credit_code',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.credit_code ?? '').localeCompare(String(b.credit_code ?? '')),
    },
    {
      title: '成立日期',
      dataIndex: 'established_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.established_date as string).getTime() - new Date(b.established_date as string).getTime(),
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
                  short_name: record.short_name,
                  logo: record.logo ? [{ uid: '-1', name: 'file', url: record.logo, status: 'done' }] : [],
                  credit_code: record.credit_code,
                  address: record.address,
                  phone: record.phone,
                  email: record.email,
                  website: record.website,
                  description: record.description,
                  established_date: record.established_date ? dayjs(record.established_date) : null,
                  status: record.status,
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
          short_name: values.short_name || '',
          logo: (() => {
            const v = values.logo;
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),
          credit_code: values.credit_code || '',
          address: values.address || '',
          phone: values.phone || '',
          email: values.email || '',
          website: values.website || '',
          description: values.description || '',
          established_date: values.established_date && typeof values.established_date === 'object' ? values.established_date.toISOString() : values.established_date || undefined,
          status: values.status || '',
        };
        await updateCompany(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateCompanyDto = {
          name: values.name || '',
          short_name: values.short_name || '',
          logo: (() => {
            const v = values.logo;
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),
          credit_code: values.credit_code || '',
          address: values.address || '',
          phone: values.phone || '',
          email: values.email || '',
          website: values.website || '',
          description: values.description || '',
          established_date: values.established_date && typeof values.established_date === 'object' ? values.established_date.toISOString() : values.established_date || undefined,
          status: values.status || '',
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
        headerTitle="公司"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchName, searchShortName, searchCreditCode, searchStatus }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getCompaniesList({ page, pageSize, name: searchName || undefined, short_name: searchShortName || undefined, credit_code: searchCreditCode || undefined, status: searchStatus || undefined });
          
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
            placeholder="搜索公司全称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
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
            key="search-credit_code"
            placeholder="搜索统一社会信用代码"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchCreditCode)}
            onClear={() => setSearchCreditCode('')}
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
            label="公司全称"
            placeholder="公司全称"
            rules={[{ required: true, message: '请输入公司全称' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="short_name"
            label="公司简称"
            placeholder="公司简称"
            
            
          />

          <Form.Item
            name="logo"
            label="公司Logo"
            
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="picture-card"
              accept="image/*"
              maxCount={1}
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await uploadFile(file as File);
                  onSuccess(result);
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <div><PlusOutlined /> Upload</div>
            </Upload>
          </Form.Item>

          <ProFormText
            name="credit_code"
            label="统一社会信用代码"
            placeholder="统一社会信用代码"
            
            disabled={!!editingRecord}
          />

          <ProFormText
            name="address"
            label="公司地址"
            placeholder="公司地址"
            
            
          />

          <ProFormText
            name="phone"
            label="联系电话"
            placeholder="联系电话"
            
            
          />

          <ProFormText
            name="email"
            label="公司邮箱"
            placeholder="公司邮箱"
            
            
          />

          <ProFormText
            name="website"
            label="公司网站"
            placeholder="公司网站"
            
            
          />

          <ProFormTextArea
            name="description"
            label="公司描述"
            placeholder="公司描述"
            
            fieldProps={{ rows: 3 }}
          />

          <ProFormDateTimePicker
            name="established_date"
            label="成立日期"
            placeholder="成立日期"
            
            
          />

          <ProFormSelect
            name="status"
            label="公司状态"
            
            request={async () => {
              const list = await getDictDetailsByType('company_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />
      </ModalForm>
    </>
  );
}
