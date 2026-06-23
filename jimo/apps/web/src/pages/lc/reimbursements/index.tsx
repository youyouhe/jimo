import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button, message, Popconfirm, Space, Form, Table, Input, Upload, Tooltip } from 'antd';
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
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
  getReimbursementsList,
  createReimbursement,
  updateReimbursement,
  deleteReimbursement,
  batchDeleteReimbursements,
  submitReimbursementApproval,
  type Reimbursement,
  type CreateReimbursementDto,
  type UpdateReimbursementDto,
} from '@/services/lc/reimbursement';
import ReassignModal from '@/components/ReassignModal';
import { getMyBtnPerms } from '@/services/authority-btn';
import { uploadFile } from '@/services/file';
import { getDictDetailsByType } from '@/services/dictionary';


export default function ReimbursementsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Reimbursement | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [form] = Form.useForm();
  const [reimbursementCategoryOptions, setReimbursementCategoryOptions] = useState<Record<string, { text: string }>>({});
  const [searchTitle, setSearchTitle] = useState('');
  const [searchReimbursementCategory, setSearchReimbursementCategory] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('reimbursement_category').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      setReimbursementCategoryOptions(map);
    }).catch(() => {});

  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./lc/reimbursements/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Reimbursement>[] = [
    {
      title: '报销标题',
      dataIndex: 'title',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')),
    },
    {
      title: '报销类别',
      dataIndex: 'reimbursement_category',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: reimbursementCategoryOptions,
    },
    {
      title: '报销金额（元）',
      dataIndex: 'amount',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.amount ?? 0) - Number(b.amount ?? 0)),
    },
    {
      title: '报销事由说明',
      dataIndex: 'description',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.description ?? '').localeCompare(String(b.description ?? '')),
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
                  title: record.title,
                  reimbursement_category: record.reimbursement_category,
                  amount: record.amount,
                  description: record.description,
                  attachments: record.attachments ? [{ uid: '-1', name: 'file', url: record.attachments, status: 'done' }] : [],
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
                  await deleteReimbursement(record.id);
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
          <Button
            type="link"
            size="small"
            onClick={async () => {
              try {
                await submitReimbursementApproval(record.id, record);
                message.success('已提交审批');
                actionRef.current?.reload();
              } catch (err: any) {
                message.error(err.message || '提交审批失败');
              }
            }}
          >
            提交审批
          </Button>
          
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingRecord) {
        const dto: UpdateReimbursementDto = {
          title: values.title || '',
          reimbursement_category: values.reimbursement_category || '',
          amount: String(values.amount ?? '0'),
          description: values.description || '',
          attachments: (() => {
            const v = values.attachments;
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),
        };
        await updateReimbursement(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateReimbursementDto = {
          title: values.title || '',
          reimbursement_category: values.reimbursement_category || '',
          amount: String(values.amount ?? '0'),
          description: values.description || '',
          attachments: (() => {
            const v = values.attachments;
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),
        };
        await createReimbursement(dto);
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
      const result = await batchDeleteReimbursements(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Reimbursement>
        headerTitle={<Tooltip title="记录员工报销申请及审批流程"><span>报销单</span></Tooltip>}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchTitle, searchReimbursementCategory }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getReimbursementsList({ page, pageSize, title: searchTitle || undefined, reimbursement_category: searchReimbursementCategory || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
          <Input
            key="search-title"
            placeholder="搜索报销标题"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchTitle)}
            onClear={() => setSearchTitle('')}
          />,
          <Input
            key="search-reimbursement_category"
            placeholder="搜索报销类别"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchReimbursementCategory)}
            onClear={() => setSearchReimbursementCategory('')}
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
            name="title"
            label="报销标题"
            placeholder="报销标题"
            rules={[{ required: true, message: '请输入报销标题' }]}
            
          />

          <ProFormSelect
            name="reimbursement_category"
            label="报销类别"
            rules={[{ required: true, message: '请选择报销类别' }]}
            request={async () => {
              const list = await getDictDetailsByType('reimbursement_category');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormDigit
            name="amount"
            label="报销金额（元）"
            placeholder="报销金额（元）"
            rules={[{ required: true, message: '请输入报销金额（元）' }]}
            
          />

          <ProFormTextArea
            name="description"
            label="报销事由说明"
            placeholder="报销事由说明"
            rules={[{ required: true, message: '请输入报销事由说明' }]}
            fieldProps={{ rows: 3 }}
          />

          <Form.Item
            name="attachments"
            label="票据附件（发票、收据等）"
            
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="text"
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
              <Button icon={<UploadOutlined />}>Select File</Button>
            </Upload>
          </Form.Item>
      </ModalForm>

      <ReassignModal
        open={reassignOpen}
        businessType="reimbursements"
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
