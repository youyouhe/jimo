import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import { Button, message, Popconfirm, Space, Form, Table, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable, EditableProTable } from '@ant-design/pro-components';
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
  getPoliciesList,
  createPolicy,
  updatePolicy,
  deletePolicy,
  batchDeletePolicies,
  getDepartmentOptions,
  type Policy,
  type CreatePolicyDto,
  type UpdatePolicyDto,
  type PolicyPolicyDetail,
} from '@/services/policy';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function PoliciesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Policy | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [policyDetailsEditableKeys, setPolicyDetailsEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Policy[]>([]);
  const [policyTypeOptions, setPolicyTypeOptions] = useState<Record<string, { text: string }>>({});
  const [statusOptions, setStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchName, setSearchName] = useState('');
  const [searchPolicyCode, setSearchPolicyCode] = useState('');
  const [searchPolicyType, setSearchPolicyType] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchDepartmentId, setSearchDepartmentId] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('policy_type').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      setPolicyTypeOptions(map);
    }).catch(() => {});
    getDictDetailsByType('policy_status').then((list: any[]) => {
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
      setBtnPerms(new Set(perms['./policies/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Policy>[] = [
    {
      title: '制度名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '制度编码',
      dataIndex: 'policy_code',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.policy_code ?? '').localeCompare(String(b.policy_code ?? '')),
    },
    {
      title: '制度类型',
      dataIndex: 'policy_type',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: policyTypeOptions,
    },
    {
      title: '版本号',
      dataIndex: 'version',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.version ?? '').localeCompare(String(b.version ?? '')),
    },
    {
      title: '制度状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: statusOptions,
    },
    {
      title: '所属部门',
      dataIndex: 'department_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.department_id_display || record.department_id,
    },
    {
      title: '生效日期',
      dataIndex: 'effective_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.effective_date as string).getTime() - new Date(b.effective_date as string).getTime(),
    },
    {
      title: '失效日期',
      dataIndex: 'expiration_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.expiration_date as string).getTime() - new Date(b.expiration_date as string).getTime(),
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
                  policy_code: record.policy_code,
                  policy_type: record.policy_type,
                  version: record.version,
                  status: record.status,
                  department_id: record.department_id,
                  effective_date: record.effective_date ? dayjs(record.effective_date) : null,
                  expiration_date: record.expiration_date ? dayjs(record.expiration_date) : null,
                  description: record.description,
                  policy_details: record.policy_details || [],
                });
                setEditingRecord(record);
                setPolicyDetailsEditableKeys((record.policy_details || []).map((d: any) => d.id));
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
                  await deletePolicy(record.id);
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
        const dto: UpdatePolicyDto = {
          name: values.name || '',
          policy_code: values.policy_code || '',
          policy_type: values.policy_type || '',
          version: values.version || '',
          status: values.status || '',
          department_id: values.department_id || undefined,
          effective_date: values.effective_date && typeof values.effective_date === 'object' ? values.effective_date.toISOString() : values.effective_date || undefined,
          expiration_date: values.expiration_date && typeof values.expiration_date === 'object' ? values.expiration_date.toISOString() : values.expiration_date || undefined,
          description: values.description || '',
          policy_details: (values.policy_details || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await updatePolicy(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreatePolicyDto = {
          name: values.name || '',
          policy_code: values.policy_code || '',
          policy_type: values.policy_type || '',
          version: values.version || '',
          status: values.status || '',
          department_id: values.department_id || undefined,
          effective_date: values.effective_date && typeof values.effective_date === 'object' ? values.effective_date.toISOString() : values.effective_date || undefined,
          expiration_date: values.expiration_date && typeof values.expiration_date === 'object' ? values.expiration_date.toISOString() : values.expiration_date || undefined,
          description: values.description || '',
          policy_details: (values.policy_details || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await createPolicy(dto);
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
      const result = await batchDeletePolicies(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Policy>
        headerTitle="制度"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.policy_details?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.policy_details || []}
              pagination={false}
              columns={[
                { title: '章节编号', dataIndex: 'chapter_number' },
                { title: '标题', dataIndex: 'title' },
                { title: '内容', dataIndex: 'content' },
                { title: '排序号', dataIndex: 'sort_order' },
              ]}
              style={{ margin: '0 48px' }}
            />
          ),
        }}
        search={false}
        params={{ searchName, searchPolicyCode, searchPolicyType, searchStatus, searchDepartmentId }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getPoliciesList({ page, pageSize, name: searchName || undefined, policy_code: searchPolicyCode || undefined, policy_type: searchPolicyType || undefined, status: searchStatus || undefined, department_id: searchDepartmentId || undefined });
          currentDataRef.current = result.list;
          setExpandedRowKeys([]);
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Button
            key="expand-all"
            size="small"
            onClick={() => {
              const expandable = currentDataRef.current
                .filter(r => (r.policy_details?.length ?? 0) > 0)
                .map(r => r.id);
              if (expandedRowKeys.length === expandable.length) {
                setExpandedRowKeys([]);
              } else {
                setExpandedRowKeys(expandable);
              }
            }}
          >
            {expandedRowKeys.length > 0 ? '折叠全部' : '展开全部'}
          </Button>,
          <Space key="filters" wrap size={8}>
          <Input
            key="search-name"
            placeholder="搜索制度名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-policy_code"
            placeholder="搜索制度编码"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchPolicyCode)}
            onClear={() => setSearchPolicyCode('')}
          />,
          <Input
            key="search-policy_type"
            placeholder="搜索制度类型"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchPolicyType)}
            onClear={() => setSearchPolicyType('')}
          />,
          <Input
            key="search-status"
            placeholder="搜索制度状态"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStatus)}
            onClear={() => setSearchStatus('')}
          />,
          <Input
            key="search-department_id"
            placeholder="搜索所属部门"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchDepartmentId)}
            onClear={() => setSearchDepartmentId('')}
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
                setPolicyDetailsEditableKeys([]);
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
            setPolicyDetailsEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="name"
            label="制度名称"
            placeholder="制度名称"
            rules={[{ required: true, message: '请输入制度名称' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="policy_code"
            label="制度编码"
            placeholder="制度编码"
            
            disabled={!!editingRecord}
          />

          <ProFormSelect
            name="policy_type"
            label="制度类型"
            
            request={async () => {
              const list = await getDictDetailsByType('policy_type');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormText
            name="version"
            label="版本号"
            placeholder="版本号"
            
            
          />

          <ProFormSelect
            name="status"
            label="制度状态"
            
            request={async () => {
              const list = await getDictDetailsByType('policy_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormSelect
            name="department_id"
            label="所属部门"
            
            request={async () => {
              const res = await getDepartmentOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormDateTimePicker
            name="effective_date"
            label="生效日期"
            placeholder="生效日期"
            
            
          />

          <ProFormDateTimePicker
            name="expiration_date"
            label="失效日期"
            placeholder="失效日期"
            
            
          />

          <ProFormTextArea
            name="description"
            label="制度描述"
            placeholder="制度描述"
            
            fieldProps={{ rows: 3 }}
          />

          <Form.Item name="policy_details" label="制度明细">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('policy_details') || [];
                return (
                  <>
                    <EditableProTable<PolicyPolicyDetail>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('policy_details', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: policyDetailsEditableKeys,
                        onChange: setPolicyDetailsEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('policy_details', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('policy_details') || [];
                            form.setFieldValue('policy_details', cur.filter((r: any) => r.id !== row.id));
                            setPolicyDetailsEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '章节编号',
          dataIndex: 'chapter_number',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '标题',
          dataIndex: 'title',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '内容',
          dataIndex: 'content',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '排序号',
          dataIndex: 'sort_order',
          valueType: 'digit',
          formItemProps: { rules: [{ required: false }] },
        },

                        { title: '操作', valueType: 'option', width: 60 },
                      ]}
                    />
                    <Button
                      type="dashed"
                      block
                      icon={<PlusOutlined />}
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
                        const newRow = { id: tempId, chapter_number: '', title: '', content: '', sort_order: 0 };
                        form.setFieldValue('policy_details', [...rows, newRow]);
                        setPolicyDetailsEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加制度明细
                    </Button>
                  </>
                );
              }}
            </Form.Item>
          </Form.Item>
      </ModalForm>
    </>
  );
}
