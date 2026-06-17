import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import { Button, message, Popconfirm, Space, Form, Table, Input, Tooltip } from 'antd';
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
  getBillsList,
  createBill,
  updateBill,
  deleteBill,
  batchDeleteBills,
  getProjectOptions,
  getBillItemOptions,
  type Bill,
  type CreateBillDto,
  type UpdateBillDto,
  type BillBillItem,
} from '@/services/bill';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function BillsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Bill | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [billItemsEditableKeys, setBillItemsEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Bill[]>([]);
  const [statusOptions, setStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchBillNo, setSearchBillNo] = useState('');
  const [searchBillName, setSearchBillName] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const [searchProjectId, setSearchProjectId] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('bill_status').then((list: any[]) => {
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
      setBtnPerms(new Set(perms['./bills/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Bill>[] = [
    {
      title: '账单编号',
      dataIndex: 'bill_no',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.bill_no ?? '').localeCompare(String(b.bill_no ?? '')),
    },
    {
      title: '账单名称',
      dataIndex: 'bill_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.bill_name ?? '').localeCompare(String(b.bill_name ?? '')),
    },
    {
      title: '账单日期',
      dataIndex: 'bill_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.bill_date as string).getTime() - new Date(b.bill_date as string).getTime(),
    },
    {
      title: '账单总金额',
      dataIndex: 'amount',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.amount ?? 0) - Number(b.amount ?? 0)),
    },
    {
      title: '账单状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: statusOptions,
    },
    {
      title: '关联项目',
      dataIndex: 'project_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.project_id_display || record.project_id,
    },
    {
      title: '账单明细',
      dataIndex: 'bill_items',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.bill_items || [];
        return items.length > 0 ? items.length + ' 条' : '-';
      },
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
                  bill_no: record.bill_no,
                  bill_name: record.bill_name,
                  bill_date: record.bill_date ? dayjs(record.bill_date) : null,
                  amount: record.amount,
                  status: record.status,
                  project_id: record.project_id,
                  remark: record.remark,
                  bill_items: record.bill_items || [],
                });
                setEditingRecord(record);
                setBillItemsEditableKeys((record.bill_items || []).map((d: any) => d.id));
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
                  await deleteBill(record.id);
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
        const dto: UpdateBillDto = {
          bill_no: values.bill_no || '',
          bill_name: values.bill_name || '',
          bill_date: values.bill_date && typeof values.bill_date === 'object' ? values.bill_date.toISOString() : values.bill_date || undefined,
          status: values.status || '',
          project_id: values.project_id || undefined,
          remark: values.remark || '',
          bill_items: (values.bill_items || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await updateBill(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateBillDto = {
          bill_no: values.bill_no || '',
          bill_name: values.bill_name || '',
          bill_date: values.bill_date && typeof values.bill_date === 'object' ? values.bill_date.toISOString() : values.bill_date || undefined,
          amount: String(values.amount ?? '0'),
          status: values.status || '',
          project_id: values.project_id || undefined,
          remark: values.remark || '',
          bill_items: (values.bill_items || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await createBill(dto);
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
      const result = await batchDeleteBills(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Bill>
        headerTitle={<Tooltip title="记录项目账单的基本信息与金额汇总"><span>账单表</span></Tooltip>}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.bill_items?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.bill_items || []}
              pagination={false}
              columns={[
                { title: '明细名称', dataIndex: 'item_name' },
                { title: '数量', dataIndex: 'quantity' },
                { title: '单价', dataIndex: 'unit_price' },
                { title: '金额', dataIndex: 'amount' },
                { title: '描述', dataIndex: 'description' },
              ]}
              style={{ margin: '0 48px' }}
            />
          ),
        }}
        search={false}
        params={{ searchBillNo, searchBillName, searchStatus, searchProjectId }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getBillsList({ page, pageSize, bill_no: searchBillNo || undefined, bill_name: searchBillName || undefined, status: searchStatus || undefined, project_id: searchProjectId || undefined });
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
                .filter(r => (r.bill_items?.length ?? 0) > 0)
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
            key="search-bill_no"
            placeholder="搜索账单编号"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchBillNo)}
            onClear={() => setSearchBillNo('')}
          />,
          <Input
            key="search-bill_name"
            placeholder="搜索账单名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchBillName)}
            onClear={() => setSearchBillName('')}
          />,
          <Input
            key="search-status"
            placeholder="搜索账单状态"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStatus)}
            onClear={() => setSearchStatus('')}
          />,
          <Input
            key="search-project_id"
            placeholder="搜索关联项目"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchProjectId)}
            onClear={() => setSearchProjectId('')}
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
                setBillItemsEditableKeys([]);
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
            setBillItemsEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="bill_no"
            label="账单编号"
            placeholder="账单编号"
            rules={[{ required: true, message: '请输入账单编号' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="bill_name"
            label="账单名称"
            placeholder="账单名称"
            rules={[{ required: true, message: '请输入账单名称' }]}
            
          />

          <ProFormDateTimePicker
            name="bill_date"
            label="账单日期"
            placeholder="账单日期"
            rules={[{ required: true, message: '请输入账单日期' }]}
            
          />

          <ProFormDigit
            name="amount"
            label="账单总金额"
            placeholder="账单总金额"
            rules={[{ required: true, message: '请输入账单总金额' }]}
            
          />

          <ProFormSelect
            name="status"
            label="账单状态"
            rules={[{ required: true, message: '请选择账单状态' }]}
            request={async () => {
              const list = await getDictDetailsByType('bill_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormSelect
            name="project_id"
            label="关联项目"
            rules={[{ required: true, message: '请选择关联项目' }]}
            request={async () => {
              const res = await getProjectOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormTextArea
            name="remark"
            label="备注"
            placeholder="备注"
            
            fieldProps={{ rows: 3 }}
          />

          <Form.Item name="bill_items" label="账单明细">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('bill_items') || [];
                return (
                  <>
                    <EditableProTable<BillBillItem>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('bill_items', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: billItemsEditableKeys,
                        onChange: setBillItemsEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('bill_items', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('bill_items') || [];
                            form.setFieldValue('bill_items', cur.filter((r: any) => r.id !== row.id));
                            setBillItemsEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '明细名称',
          dataIndex: 'item_name',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '数量',
          dataIndex: 'quantity',
          valueType: 'digit',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '单价',
          dataIndex: 'unit_price',
          valueType: 'digit',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '金额',
          dataIndex: 'amount',
          valueType: 'digit',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '描述',
          dataIndex: 'description',
          valueType: 'text',
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
                        const newRow = { id: tempId, item_name: '', quantity: 0, unit_price: 0, amount: 0, description: '' };
                        form.setFieldValue('bill_items', [...rows, newRow]);
                        setBillItemsEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加账单明细
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
