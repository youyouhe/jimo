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
  ProFormDateTimePicker,
} from '@ant-design/pro-components';
import {
  getProjectsList,
  createProject,
  updateProject,
  deleteProject,
  batchDeleteProjects,
  getProjectTaskOptions,
  type Project,
  type CreateProjectDto,
  type UpdateProjectDto,
  type ProjectTasks,
} from '@/services/project';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function ProjectsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Project | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [tasksEditableKeys, setTasksEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Project[]>([]);
  const [searchName, setSearchName] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {


  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./projects/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Project>[] = [
    {
      title: '项目名称',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '开始日期',
      dataIndex: 'start_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.start_date as string).getTime() - new Date(b.start_date as string).getTime(),
    },
    {
      title: '结束日期',
      dataIndex: 'end_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.end_date as string).getTime() - new Date(b.end_date as string).getTime(),
    },
    {
      title: '是否进行中',
      dataIndex: 'is_active',
      valueType: 'switch',
      width: 100,
      search: false,
    },
    {
      title: '任务列表',
      dataIndex: 'tasks',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.tasks || [];
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
                  description: record.description,
                  start_date: record.start_date ? dayjs(record.start_date) : null,
                  end_date: record.end_date ? dayjs(record.end_date) : null,
                  is_active: record.is_active,
                  tasks: record.tasks || [],
                });
                setEditingRecord(record);
                setTasksEditableKeys((record.tasks || []).map((d: any) => d.id));
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
                  await deleteProject(record.id);
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
        const dto: UpdateProjectDto = {
          name: values.name || '',
          description: values.description || '',
          start_date: values.start_date && typeof values.start_date === 'object' ? values.start_date.toISOString() : values.start_date || undefined,
          end_date: values.end_date && typeof values.end_date === 'object' ? values.end_date.toISOString() : values.end_date || undefined,
          is_active: values.is_active ?? false,
          tasks: (values.tasks || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await updateProject(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateProjectDto = {
          name: values.name || '',
          description: values.description || '',
          start_date: values.start_date && typeof values.start_date === 'object' ? values.start_date.toISOString() : values.start_date || undefined,
          end_date: values.end_date && typeof values.end_date === 'object' ? values.end_date.toISOString() : values.end_date || undefined,
          is_active: values.is_active ?? false,
          tasks: (values.tasks || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await createProject(dto);
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
      const result = await batchDeleteProjects(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Project>
        headerTitle="项目表（类型4：挂载已有表示例 - 用 existing 模式挂 project_tasks）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.tasks?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.tasks || []}
              pagination={false}
              columns={[
                { title: '任务名称', dataIndex: 'task_name' },
                { title: '负责人', dataIndex: 'assignee' },
                { title: '任务状态', dataIndex: 'status' },
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
          const result = await getProjectsList({ page, pageSize, name: searchName || undefined });
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
                .filter(r => (r.tasks?.length ?? 0) > 0)
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
            placeholder="搜索项目名称"
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
                setTasksEditableKeys([]);
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
            setTasksEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="name"
            label="项目名称"
            placeholder="项目名称"
            rules={[{ required: true, message: '请输入项目名称' }]}
            disabled={!!editingRecord}
          />

          <ProFormTextArea
            name="description"
            label="项目描述"
            placeholder="项目描述"
            
            fieldProps={{ rows: 3 }}
          />

          <ProFormDateTimePicker
            name="start_date"
            label="开始日期"
            placeholder="开始日期"
            rules={[{ required: true, message: '请输入开始日期' }]}
            
          />

          <ProFormDateTimePicker
            name="end_date"
            label="结束日期"
            placeholder="结束日期"
            
            
          />

          <ProFormSwitch
            name="is_active"
            label="是否进行中"
          />

          <Form.Item name="tasks" label="任务列表">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('tasks') || [];
                return (
                  <>
                    <EditableProTable<ProjectTasks>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('tasks', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: tasksEditableKeys,
                        onChange: setTasksEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('tasks', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('tasks') || [];
                            form.setFieldValue('tasks', cur.filter((r: any) => r.id !== row.id));
                            setTasksEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '任务名称',
          dataIndex: 'task_name',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '负责人',
          dataIndex: 'assignee',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '任务状态',
          dataIndex: 'status',
          valueType: 'select',
          formItemProps: { rules: [{ required: true }] },
          request: async () => {
            const list = await getDictDetailsByType('contract_status');
            return list.map((item: any) => ({ label: item.label, value: item.value }));
          },
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
                        const newRow = { id: tempId, task_name: '', assignee: '', status: '' };
                        form.setFieldValue('tasks', [...rows, newRow]);
                        setTasksEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加任务列表
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
