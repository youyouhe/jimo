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
  getOrdersList,
  createOrder,
  updateOrder,
  deleteOrder,
  batchDeleteOrders,
  type Order,
  type CreateOrderDto,
  type UpdateOrderDto,
  type OrderOrderItem,
  type OrderOrderItemProductBatche,
} from '@/services/order';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


function OrderOrderItemProductBatcheEditor({ row, form }: { row: any; form: any }) {
  const grandRows: any[] = row.product_batches || [];
  const [grandKeys, setGrandKeys] = useState<React.Key[]>(() => grandRows.map((r: any) => r.id));
  return (
    <>
      <EditableProTable<OrderOrderItemProductBatche>
        rowKey="id"
        size="small"
        value={grandRows}
        onChange={(data) => {
          const cur: any[] = form.getFieldValue('order_items') || [];
          form.setFieldValue('order_items', cur.map((r: any) => r.id === row.id ? { ...r, product_batches: data ?? [] } : r));
        }}
        recordCreatorProps={false}
        editable={{
          type: 'multiple',
          editableKeys: grandKeys,
          onChange: setGrandKeys,
          onValuesChange: (_r, ds) => {
            const cur: any[] = form.getFieldValue('order_items') || [];
            form.setFieldValue('order_items', cur.map((r: any) => r.id === row.id ? { ...r, product_batches: ds } : r));
          },
          actionRender: (grandRow, _cfg, _doms) => [
            <a key="del" onClick={() => {
              const cur: any[] = form.getFieldValue('order_items') || [];
              form.setFieldValue('order_items', cur.map((r: any) => r.id === row.id ? { ...r, product_batches: (r.product_batches || []).filter((g: any) => g.id !== grandRow.id) } : r));
              setGrandKeys((ks: React.Key[]) => ks.filter((k) => k !== grandRow.id));
            }} style={{ color: '#ff4d4f' }}>删除</a>,
          ],
        }}
        columns={[
              {
                title: '批次号',
                dataIndex: 'batch_no',
                valueType: 'text',
                formItemProps: { rules: [{ required: true }] },
              },
              {
                title: '仓库名称',
                dataIndex: 'warehouse',
                valueType: 'text',
                formItemProps: { rules: [{ required: true }] },
              },
              {
                title: '该批次出货数量',
                dataIndex: 'batch_quantity',
                valueType: 'digit',
                formItemProps: { rules: [{ required: true }] },
              },
              {
                title: '生产日期',
                dataIndex: 'production_date',
                valueType: 'dateTime',
                formItemProps: { rules: [{ required: false }] },
              },
          { title: '操作', valueType: 'option', width: 60 },
        ]}
      />
      <Button type="dashed" size="small" block icon={<PlusOutlined />} style={{ marginTop: 4 }} onClick={() => {
        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
        const newGrand = { id: tempId, batch_no: '', warehouse: '', batch_quantity: 0, production_date: null };
        const cur: any[] = form.getFieldValue('order_items') || [];
        form.setFieldValue('order_items', cur.map((r: any) => r.id === row.id ? { ...r, product_batches: [...(r.product_batches || []), newGrand] } : r));
        setGrandKeys((ks: React.Key[]) => [...ks, tempId]);
      }}>添加商品批次（该订单商品来自哪些库存批次）</Button>
    </>
  );
}

export default function OrdersPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Order | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [orderItemsEditableKeys, setOrderItemsEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Order[]>([]);
  const [orderStatusOptions, setOrderStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchOrderNo, setSearchOrderNo] = useState('');
  const [searchCustomerName, setSearchCustomerName] = useState('');
  const [searchOrderStatus, setSearchOrderStatus] = useState('');
  const [searchOrderDate, setSearchOrderDate] = useState('');
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
      setOrderStatusOptions(map);
    }).catch(() => {});

  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./orders/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Order>[] = [
    {
      title: '订单编号',
      dataIndex: 'order_no',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.order_no ?? '').localeCompare(String(b.order_no ?? '')),
    },
    {
      title: '客户名称',
      dataIndex: 'customer_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.customer_name ?? '').localeCompare(String(b.customer_name ?? '')),
    },
    {
      title: '订单状态',
      dataIndex: 'order_status',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: orderStatusOptions,
    },
    {
      title: '订单总金额',
      dataIndex: 'total_amount',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.total_amount ?? 0) - Number(b.total_amount ?? 0)),
    },
    {
      title: '下单日期',
      dataIndex: 'order_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.order_date as string).getTime() - new Date(b.order_date as string).getTime(),
    },
    {
      title: '订单商品明细',
      dataIndex: 'order_items',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.order_items || [];
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
                  order_no: record.order_no,
                  customer_name: record.customer_name,
                  order_status: record.order_status,
                  total_amount: record.total_amount,
                  order_date: record.order_date ? dayjs(record.order_date) : null,
                  order_items: record.order_items || [],
                });
                setEditingRecord(record);
                setOrderItemsEditableKeys((record.order_items || []).map((d: any) => d.id));
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
                  await deleteOrder(record.id);
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
        const dto: UpdateOrderDto = {
          order_no: values.order_no || '',
          customer_name: values.customer_name || '',
          order_status: values.order_status || '',
          total_amount: String(values.total_amount ?? '0'),
          order_date: values.order_date && typeof values.order_date === 'object' ? values.order_date.toISOString() : values.order_date || undefined,
          order_items: (values.order_items || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            product_batches: (d.product_batches || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),
          })),
        };
        await updateOrder(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateOrderDto = {
          order_no: values.order_no || '',
          customer_name: values.customer_name || '',
          order_status: values.order_status || '',
          total_amount: String(values.total_amount ?? '0'),
          order_date: values.order_date && typeof values.order_date === 'object' ? values.order_date.toISOString() : values.order_date || undefined,
          order_items: (values.order_items || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            product_batches: (d.product_batches || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),
          })),
        };
        await createOrder(dto);
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
      const result = await batchDeleteOrders(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Order>
        headerTitle="订单表，记录客户订单信息，包含订单商品及商品批次的嵌套结构"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.order_items?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.order_items || []}
              pagination={false}
              expandable={{
                rowExpandable: (r) => (r.product_batches?.length ?? 0) > 0,
                expandedRowRender: (childRow) => (
                  <Table size="small" rowKey="id" dataSource={childRow.product_batches || []} pagination={false}
                    columns={[{ title: '批次号', dataIndex: 'batch_no' }, { title: '仓库名称', dataIndex: 'warehouse' }, { title: '该批次出货数量', dataIndex: 'batch_quantity' }, { title: '生产日期', dataIndex: 'production_date' }]}
                    style={{ margin: '0 24px' }} />
                ),
              }}
              columns={[
                { title: '商品名称', dataIndex: 'product_name' },
                { title: '商品数量', dataIndex: 'quantity' },
                { title: '商品单价', dataIndex: 'unit_price' },
                { title: '小计金额', dataIndex: 'subtotal' },
              ]}
              style={{ margin: '0 48px' }}
            />
          ),
        }}
        search={false}
        params={{ searchOrderNo, searchCustomerName, searchOrderStatus, searchOrderDate }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getOrdersList({ page, pageSize, order_no: searchOrderNo || undefined, customer_name: searchCustomerName || undefined, order_status: searchOrderStatus || undefined, order_date: searchOrderDate || undefined });
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
                .filter(r => (r.order_items?.length ?? 0) > 0)
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
            key="search-customer_name"
            placeholder="搜索客户名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchCustomerName)}
            onClear={() => setSearchCustomerName('')}
          />,
          <Input
            key="search-order_status"
            placeholder="搜索订单状态"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchOrderStatus)}
            onClear={() => setSearchOrderStatus('')}
          />,
          <Input
            key="search-order_date"
            placeholder="搜索下单日期"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchOrderDate)}
            onClear={() => setSearchOrderDate('')}
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
                setOrderItemsEditableKeys([]);
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
            setOrderItemsEditableKeys([]);
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

          <ProFormText
            name="customer_name"
            label="客户名称"
            placeholder="客户名称"
            rules={[{ required: true, message: '请输入客户名称' }]}
            
          />

          <ProFormSelect
            name="order_status"
            label="订单状态"
            rules={[{ required: true, message: '请选择订单状态' }]}
            request={async () => {
              const list = await getDictDetailsByType('order_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormDigit
            name="total_amount"
            label="订单总金额"
            placeholder="订单总金额"
            
            
          />

          <ProFormDateTimePicker
            name="order_date"
            label="下单日期"
            placeholder="下单日期"
            rules={[{ required: true, message: '请输入下单日期' }]}
            
          />

          <Form.Item name="order_items" label="订单商品明细">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('order_items') || [];
                return (
                  <>
                    <EditableProTable<OrderOrderItem>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('order_items', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: orderItemsEditableKeys,
                        onChange: setOrderItemsEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('order_items', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('order_items') || [];
                            form.setFieldValue('order_items', cur.filter((r: any) => r.id !== row.id));
                            setOrderItemsEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '商品名称',
          dataIndex: 'product_name',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '商品数量',
          dataIndex: 'quantity',
          valueType: 'digit',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '商品单价',
          dataIndex: 'unit_price',
          valueType: 'digit',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '小计金额',
          dataIndex: 'subtotal',
          valueType: 'digit',
          formItemProps: { rules: [{ required: false }] },
        },
            {
              title: '商品批次（该订单商品来自哪些库存批次）',
              dataIndex: 'product_batches',
              editable: () => false,
              render: (_: any, row: any) => <OrderOrderItemProductBatcheEditor row={row} form={form} />,
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
                        const newRow = { id: tempId, product_name: '', quantity: 0, unit_price: 0, subtotal: 0, product_batches: [] };
                        form.setFieldValue('order_items', [...rows, newRow]);
                        setOrderItemsEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加订单商品明细
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
