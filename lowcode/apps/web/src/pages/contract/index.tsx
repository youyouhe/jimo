import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button, message, Popconfirm, Space, Form, Table, Input } from 'antd';
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
  getContractList,
  createContract,
  updateContract,
  deleteContract,
  batchDeleteContract,
  type Contract,
  type CreateContractDto,
  type UpdateContractDto,
  type ContractDetail,
  type ContractDetailBatch,
} from '@/services/contract';
import { getMyBtnPerms } from '@/services/authority-btn';

function ContractDetailBatchEditor({ row, form }: { row: any; form: any }) {
  const grandRows: any[] = row.batch || [];
  const [grandKeys, setGrandKeys] = useState<React.Key[]>(() => grandRows.map((r: any) => r.id));
  return (
    <>
      <EditableProTable<ContractDetailBatch>
        rowKey="id"
        size="small"
        value={grandRows}
        onChange={(data) => {
          const cur: any[] = form.getFieldValue('detail') || [];
          form.setFieldValue('detail', cur.map((r: any) => r.id === row.id ? { ...r, batch: data ?? [] } : r));
        }}
        recordCreatorProps={false}
        editable={{
          type: 'multiple',
          editableKeys: grandKeys,
          onChange: setGrandKeys,
          onValuesChange: (_r, ds) => {
            const cur: any[] = form.getFieldValue('detail') || [];
            form.setFieldValue('detail', cur.map((r: any) => r.id === row.id ? { ...r, batch: ds } : r));
          },
          actionRender: (grandRow, _cfg, _doms) => [
            <a key="del" onClick={() => {
              const cur: any[] = form.getFieldValue('detail') || [];
              form.setFieldValue('detail', cur.map((r: any) => r.id === row.id ? { ...r, batch: (r.batch || []).filter((g: any) => g.id !== grandRow.id) } : r));
              setGrandKeys((ks: React.Key[]) => ks.filter((k) => k !== grandRow.id));
            }} style={{ color: '#ff4d4f' }}>删除</a>,
          ],
        }}
        columns={[
          {
            title: '批次名称',
            dataIndex: 'batch',
            valueType: 'text',
            formItemProps: { rules: [{ required: false }] },
          },
          {
            title: '数量',
            dataIndex: 'number',
            valueType: 'digit',
            formItemProps: { rules: [{ required: false }] },
          },
          {
            title: '总价',
            dataIndex: 'price',
            valueType: 'text',
            formItemProps: { rules: [{ required: false }] },
          },
          { title: '操作', valueType: 'option', width: 60 },
        ]}
      />
      <Button type="dashed" size="small" block icon={<PlusOutlined />} style={{ marginTop: 4 }} onClick={() => {
        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
        const newGrand = { id: tempId, batch: '', number: 0, price: '' };
        const cur: any[] = form.getFieldValue('detail') || [];
        form.setFieldValue('detail', cur.map((r: any) => r.id === row.id ? { ...r, batch: [...(r.batch || []), newGrand] } : r));
        setGrandKeys((ks: React.Key[]) => [...ks, tempId]);
      }}>添加批次</Button>
    </>
  );
}

export default function ContractPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Contract | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [detailEditableKeys, setDetailEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Contract[]>([]);
  const [searchName, setSearchName] = useState('');
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
      setBtnPerms(new Set(perms['./contract/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Contract>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '明细',
      dataIndex: 'detail',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.detail || [];
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
                  detail: record.detail || [],
                });
                setEditingRecord(record);
                setDetailEditableKeys((record.detail || []).map((d: any) => d.id));
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
                  await deleteContract(record.id);
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
        const dto: UpdateContractDto = {
          name: values.name || '',
          detail: (values.detail || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            batch: (d.batch || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),
          })),
        };
        await updateContract(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateContractDto = {
          name: values.name || '',
          detail: (values.detail || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            batch: (d.batch || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),
          })),
        };
        await createContract(dto);
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
      const result = await batchDeleteContract(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Contract>
        headerTitle="合同"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.detail?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.detail || []}
              pagination={false}
              expandable={{
                rowExpandable: (r) => (r.batch?.length ?? 0) > 0,
                expandedRowRender: (childRow) => (
                  <Table size="small" rowKey="id" dataSource={childRow.batch || []} pagination={false}
                    columns={[{ title: '批次名称', dataIndex: 'batch' }, { title: '数量', dataIndex: 'number' }, { title: '总价', dataIndex: 'price' }]}
                    style={{ margin: '0 24px' }} />
                ),
              }}
              columns={[
                { title: '明细', dataIndex: 'name' },
                { title: '备注', dataIndex: 'demo' },
              ]}
              style={{ margin: '0 48px' }}
            />
          ),
        }}
        search={false}
        params={{ searchName }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getContractList({ page, pageSize, name: searchName || undefined });
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
                .filter(r => (r.detail?.length ?? 0) > 0)
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
            placeholder="搜索名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
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
                setDetailEditableKeys([]);
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
            setDetailEditableKeys([]);
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

          <Form.Item name="detail" label="明细">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('detail') || [];
                return (
                  <>
                    <EditableProTable<ContractDetail>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('detail', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: detailEditableKeys,
                        onChange: setDetailEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('detail', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('detail') || [];
                            form.setFieldValue('detail', cur.filter((r: any) => r.id !== row.id));
                            setDetailEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '明细',
          dataIndex: 'name',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '备注',
          dataIndex: 'demo',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
            {
              title: '批次',
              dataIndex: 'batch',
              valueType: 'option',
              width: 200,
              render: (_: any, row: any) => <ContractDetailBatchEditor row={row} form={form} />,
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
                        const newRow = { id: tempId, name: '', demo: '', batch: [] };
                        form.setFieldValue('detail', [...rows, newRow]);
                        setDetailEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加明细
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
