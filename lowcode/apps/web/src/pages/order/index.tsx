import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import { Button, message, Popconfirm, Space, Form, Table, Tabs, Input } from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable, EditableProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,
} from '@ant-design/pro-components';
import {
  getOrderList,
  createOrder,
  updateOrder,
  deleteOrder,
  batchDeleteOrder,
  type Order,
  type CreateOrderDto,
  type UpdateOrderDto,
} from '@/services/order';
import { getMyBtnPerms } from '@/services/authority-btn';

export default function OrderPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Order | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [detailsEditableKeys, setDetailsEditableKeys] = useState<React.Key[]>([]);
  const [performanceEditableKeys, setPerformanceEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Order[]>([]);
  const [searchName, setSearchName] = useState('');
  const [searchPriceMin, setSearchPriceMin] = useState('');
  const [searchPriceMax, setSearchPriceMax] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setter(val);
    }, 400);
  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./order/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Order>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (a.name ?? '').localeCompare(b.name ?? ''),
    },
    {
      title: '总价',
      dataIndex: 'price',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => parseFloat(a.price ?? '0') - parseFloat(b.price ?? '0'),
    },
    {
      title: '订单明细',
      dataIndex: 'details',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.details || [];
        return items.length > 0 ? items.length + ' 条' : '-';
      },
    },
    {
      title: '履约',
      dataIndex: 'performance',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.performance || [];
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
                  name: record.name,
                  price: record.price,
                  details: record.details || [],
                  performance: (record.performance || []).map((d: any) => ({
                    ...d,
                    time: d.time ? dayjs(d.time) : null,
                  })),
                });
                setEditingRecord(record);
                setDetailsEditableKeys((record.details || []).map((d: any) => d.id));
                setPerformanceEditableKeys((record.performance || []).map((d: any) => d.id));
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
          name: values.name || '',
          price: String(values.price ?? '0'),
          details: (values.details || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
          performance: (values.performance || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            time: d.time && typeof d.time === 'object' ? d.time.toISOString() : d.time,
          })),
        };
        await updateOrder(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateOrderDto = {
          name: values.name || '',
          price: String(values.price ?? '0'),
          details: (values.details || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
          performance: (values.performance || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            time: d.time && typeof d.time === 'object' ? d.time.toISOString() : d.time,
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
      const result = await batchDeleteOrder(selectedRowKeys);
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
        headerTitle="订单"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.details?.length ?? 0) > 0 || (record.performance?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Tabs
              style={{ margin: '0 48px' }}
              items={[
                {
                  key: 'details',
                  label: '订单明细',
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={record.details || []}
                      pagination={false}
                      columns={[
                        { title: '明细名称', dataIndex: 'name' },
                        { title: '数量', dataIndex: 'number' },
                        { title: '单价', dataIndex: 'price' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'performance',
                  label: '履约',
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={record.performance || []}
                      pagination={false}
                      columns={[
                        { title: '名称', dataIndex: 'name' },
                        { title: '时间', dataIndex: 'time' },
                        { title: '数量', dataIndex: 'amount' },
                        { title: '备注', dataIndex: 'memo' },
                      ]}
                    />
                  ),
                }
              ]}
            />
          ),
        }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        search={false}
        params={{ searchName, searchPriceMin, searchPriceMax }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getOrderList({ page, pageSize, name: searchName || undefined, priceMin: searchPriceMin || undefined, priceMax: searchPriceMax || undefined });
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
                .filter(r => (r.details?.length ?? 0) > 0 || (r.performance?.length ?? 0) > 0)
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
          <Input
            key="search-name"
            placeholder="搜索订单名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-price-min"
            placeholder="价格最小值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchPriceMin)}
            onClear={() => setSearchPriceMin('')}
          />,
          <Input
            key="search-price-max"
            placeholder="价格最大值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchPriceMax)}
            onClear={() => setSearchPriceMax('')}
          />,
          btnPerms.has('add') && (
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditingRecord(null);
                setDetailsEditableKeys([]);
                setPerformanceEditableKeys([]);
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
            setDetailsEditableKeys([]);
            setPerformanceEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="name"
            label="名称"
            placeholder="名称"
            
            
          />

          <ProFormDigit
            name="price"
            label="总价"
            placeholder="总价"
            
            
          />

          <Tabs
            items={[
          {
            key: 'details',
            label: '订单明细',
            forceRender: true,
            children: (
          <Form.Item name="details" label="订单明细">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('details') || [];
                return (
                  <>
                    <EditableProTable<OrderDetail>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('details', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: detailsEditableKeys,
                        onChange: setDetailsEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('details', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('details') || [];
                            form.setFieldValue('details', cur.filter((r: any) => r.id !== row.id));
                            setDetailsEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '明细名称',
          dataIndex: 'name',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '数量',
          dataIndex: 'number',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '单价',
          dataIndex: 'price',
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
                        const newRow = { id: tempId, name: '', number: '', price: '' };
                        form.setFieldValue('details', [...rows, newRow]);
                        setDetailsEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加订单明细
                    </Button>
                  </>
                );
              }}
            </Form.Item>
          </Form.Item>
            ),
          },
          {
            key: 'performance',
            label: '履约',
            forceRender: true,
            children: (
          <Form.Item name="performance" label="履约">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('performance') || [];
                return (
                  <>
                    <EditableProTable<OrderPerformance>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('performance', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: performanceEditableKeys,
                        onChange: setPerformanceEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('performance', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('performance') || [];
                            form.setFieldValue('performance', cur.filter((r: any) => r.id !== row.id));
                            setPerformanceEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '名称',
          dataIndex: 'name',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '时间',
          dataIndex: 'time',
          valueType: 'dateTime',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '数量',
          dataIndex: 'amount',
          valueType: 'digit',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '备注',
          dataIndex: 'memo',
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
                        const newRow = { id: tempId, name: '', time: null, amount: 0, memo: '' };
                        form.setFieldValue('performance', [...rows, newRow]);
                        setPerformanceEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加履约
                    </Button>
                  </>
                );
              }}
            </Form.Item>
          </Form.Item>
            ),
          }
            ]}
          />
      </ModalForm>
    </>
  );
}
