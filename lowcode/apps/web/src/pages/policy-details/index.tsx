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
  ProFormSelect,
} from '@ant-design/pro-components';
import {
  getPolicyDetailsList,
  createPolicyDetail,
  updatePolicyDetail,
  deletePolicyDetail,
  batchDeletePolicyDetails,
  getPolicyOptions,
  type PolicyDetail,
  type CreatePolicyDetailDto,
  type UpdatePolicyDetailDto,
} from '@/services/policy-detail';
import { getMyBtnPerms } from '@/services/authority-btn';


export default function PolicyDetailsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PolicyDetail | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [searchChapterNumber, setSearchChapterNumber] = useState('');
  const [searchTitle, setSearchTitle] = useState('');
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
      setBtnPerms(new Set(perms['./policy-details/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<PolicyDetail>[] = [
    {
      title: '所属制度',
      dataIndex: 'policy_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.policy_id_display || record.policy_id,
    },
    {
      title: '章节编号',
      dataIndex: 'chapter_number',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.chapter_number ?? '').localeCompare(String(b.chapter_number ?? '')),
    },
    {
      title: '标题',
      dataIndex: 'title',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')),
    },
    {
      title: '排序号',
      dataIndex: 'sort_order',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)),
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
                  policy_id: record.policy_id,
                  chapter_number: record.chapter_number,
                  title: record.title,
                  content: record.content,
                  sort_order: record.sort_order,
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
                  await deletePolicyDetail(record.id);
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
        const dto: UpdatePolicyDetailDto = {
          policy_id: values.policy_id || undefined,
          chapter_number: values.chapter_number || '',
          title: values.title || '',
          content: values.content || '',
          sort_order: values.sort_order ?? 0,
        };
        await updatePolicyDetail(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreatePolicyDetailDto = {
          policy_id: values.policy_id || undefined,
          chapter_number: values.chapter_number || '',
          title: values.title || '',
          content: values.content || '',
          sort_order: values.sort_order ?? 0,
        };
        await createPolicyDetail(dto);
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
      const result = await batchDeletePolicyDetails(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<PolicyDetail>
        headerTitle="制度明细"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchChapterNumber, searchTitle }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getPolicyDetailsList({ page, pageSize, chapter_number: searchChapterNumber || undefined, title: searchTitle || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
          <Input
            key="search-chapter_number"
            placeholder="搜索章节编号"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchChapterNumber)}
            onClear={() => setSearchChapterNumber('')}
          />,
          <Input
            key="search-title"
            placeholder="搜索标题"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchTitle)}
            onClear={() => setSearchTitle('')}
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
          <ProFormSelect
            name="policy_id"
            label="所属制度"
            rules={[{ required: true, message: '请选择所属制度' }]}
            request={async () => {
              const res = await getPolicyOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormText
            name="chapter_number"
            label="章节编号"
            placeholder="章节编号"
            
            
          />

          <ProFormText
            name="title"
            label="标题"
            placeholder="标题"
            rules={[{ required: true, message: '请输入标题' }]}
            
          />

          <ProFormTextArea
            name="content"
            label="内容"
            placeholder="内容"
            rules={[{ required: true, message: '请输入内容' }]}
            fieldProps={{ rows: 3 }}
          />

          <ProFormDigit
            name="sort_order"
            label="排序号"
            placeholder="排序号"
            
            
          />
      </ModalForm>
    </>
  );
}
