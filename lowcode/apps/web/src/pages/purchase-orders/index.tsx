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
  getPurchaseOrdersList,
  createPurchaseOrder,
  updatePurchaseOrder,
  deletePurchaseOrder,
  batchDeletePurchaseOrders,
  getSupplierOptions,
  type PurchaseOrder,
  type CreatePurchaseOrderDto,
  type UpdatePurchaseOrderDto,
  type PurchaseOrderItem,
} from '@/services/purchase-order';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function PurchaseOrdersPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PurchaseOrder | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [itemsEditableKeys, setItemsEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<PurchaseOrder[]>([]);
  const [statusOptions, setStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchOrderNo, setSearchOrderNo] = useState('');
  const [searchSupplierId, setSearchSupplierId] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('order_status').then((list: any[]) => {
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
      setBtnPerms(new Set(perms['./purchase-orders/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<PurchaseOrder>[] = [
    {
      title: '订单编号',
      dataIndex: 'order_no',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.order_no ?? '').localeCompare(String(b.order_no ?? '')),
    },
    {
      title: '供应商',
      dataIndex: 'supplier_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.supplier_id_display || record.supplier_id,
    },
    {
      title: '订单日期',
      dataIndex: 'order_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.order_date as string).getTime() - new Date(b.order_date as string).getTime(),
    },
    {
      title: '订单状态',
      dataIndex: 'status',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: statusOptions,
    },
    {
      title: '总金额',
      dataIndex: 'total_amount',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.total_amount ?? 0) - Number(b.total_amount ?? 0)),
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
                  order_no: record.order_no,
                  supplier_id: record.supplier_id,
                  order_date: record.order_date ? dayjs(record.order_date) : null,
                  status: record.status,
                  remark: record.remark,
                  items: record.items || [],
                });
                setEditingRecord(record);
                setItemsEditableKeys((record.items || []).map((d: any) => d.id));
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
                  await deletePurchaseOrder(record.id);
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
        const dto: UpdatePurchaseOrderDto = {
          supplier_id: values.supplier_id || undefined,
          order_date: values.order_date && typeof values.order_date === 'object' ? values.order_date.toISOString() : values.order_date || undefined,
          status: values.status || '',
          remark: values.remark || '',
          items: (values.items || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await updatePurchaseOrder(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreatePurchaseOrderDto = {
          order_no: values.order_no || '',
          supplier_id: values.supplier_id || undefined,
          order_date: values.order_date && typeof values.order_date === 'object' ? values.order_date.toISOString() : values.order_date || undefined,
          status: values.status || '',
          remark: values.remark || '',
          items: (values.items || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await createPurchaseOrder(dto);
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
      const result = await batchDeletePurchaseOrders(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<PurchaseOrder>
        headerTitle="采购订单（类型2：主表+子表示例）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.items?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.items || []}
              pagination={false}
              columns={[
                { title: '物料名称', dataIndex: 'material_name' },
                { title: '规格型号', dataIndex: 'specification' },
                { title: '数量', dataIndex: 'quantity' },
                { title: '单价', dataIndex: 'unit_price' },
                { title: '小计金额', dataIndex: 'amount' },
              ]}
              style={{ margin: '0 48px' }}
            />
          ),
        }}
        search={false}
        params={{ searchOrderNo, searchSupplierId, searchStatus }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getPurchaseOrdersList({ page, pageSize, order_no: searchOrderNo || undefined, supplier_id: searchSupplierId || undefined, status: searchStatus || undefined });
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
                .filter(r => (r.items?.length ?? 0) > 0)
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
            key="search-order_no"
            placeholder="搜索订单编号"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchOrderNo)}
            onClear={() => setSearchOrderNo('')}
          />,
          <Input
            key="search-supplier_id"
            placeholder="搜索供应商"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchSupplierId)}
            onClear={() => setSearchSupplierId('')}
          />,
          <Input
            key="search-status"
            placeholder="搜索订单状态"
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
                setItemsEditableKeys([]);
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
            setItemsEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="order_no"
            label="订单编号"
            placeholder="订单编号"
            rules={[{ required: true, message: '请输入订单编号' }]}
            disabled={!!editingRecord}
          />

          <ProFormSelect
            name="supplier_id"
            label="供应商"
            rules={[{ required: true, message: '请选择供应商' }]}
            request={async () => {
              const res = await getSupplierOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormDateTimePicker
            name="order_date"
            label="订单日期"
            placeholder="订单日期"
            rules={[{ required: true, message: '请输入订单日期' }]}
            
          />

          <ProFormSelect
            name="status"
            label="订单状态"
            rules={[{ required: true, message: '请选择订单状态' }]}
            request={async () => {
              const list = await getDictDetailsByType('order_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormTextArea
            name="remark"
            label="备注"
            placeholder="备注"
            
            fieldProps={{ rows: 3 }}
          />

          <Form.Item name="items" label="订单明细">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('items') || [];
                return (
                  <>
                    <EditableProTable<PurchaseOrderItem>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('items', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: itemsEditableKeys,
                        onChange: setItemsEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('items', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('items') || [];
                            form.setFieldValue('items', cur.filter((r: any) => r.id !== row.id));
                            setItemsEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '物料名称',
          dataIndex: 'material_name',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '规格型号',
          dataIndex: 'specification',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
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
          title: '小计金额',
          dataIndex: 'amount',
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
                        const newRow = { id: tempId, material_name: '', specification: '', quantity: 0, unit_price: 0, amount: 0 };
                        form.setFieldValue('items', [...rows, newRow]);
                        setItemsEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加订单明细
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
