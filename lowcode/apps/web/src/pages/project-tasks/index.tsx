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
  getProjectTasksList,
  createProjectTask,
  updateProjectTask,
  deleteProjectTask,
  batchDeleteProjectTasks,
  getProjectOptions,
  type ProjectTask,
  type CreateProjectTaskDto,
  type UpdateProjectTaskDto,
} from '@/services/project-task';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function ProjectTasksPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ProjectTask | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [statusOptions, setStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchProjectId, setSearchProjectId] = useState('');
  const [searchTaskName, setSearchTaskName] = useState('');
  const [searchAssignee, setSearchAssignee] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('contract_status').then((list: any[]) => {
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
      setBtnPerms(new Set(perms['./project-tasks/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<ProjectTask>[] = [
    {
      title: '所属项目',
      dataIndex: 'project_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.project_id_display || record.project_id,
    },
    {
      title: '任务名称',
      dataIndex: 'task_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.task_name ?? '').localeCompare(String(b.task_name ?? '')),
    },
    {
      title: '负责人',
      dataIndex: 'assignee',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.assignee ?? '').localeCompare(String(b.assignee ?? '')),
    },
    {
      title: '任务状态',
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
                  project_id: record.project_id,
                  task_name: record.task_name,
                  assignee: record.assignee,
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
                  await deleteProjectTask(record.id);
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
        const dto: UpdateProjectTaskDto = {
          project_id: values.project_id || undefined,
          task_name: values.task_name || '',
          assignee: values.assignee || '',
          status: values.status || '',
        };
        await updateProjectTask(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateProjectTaskDto = {
          project_id: values.project_id || undefined,
          task_name: values.task_name || '',
          assignee: values.assignee || '',
          status: values.status || '',
        };
        await createProjectTask(dto);
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
      const result = await batchDeleteProjectTasks(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<ProjectTask>
        headerTitle="项目任务表（类型4准备：含 project_id FK，后续被 projects 挂载）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchProjectId, searchTaskName, searchAssignee, searchStatus }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getProjectTasksList({ page, pageSize, project_id: searchProjectId || undefined, task_name: searchTaskName || undefined, assignee: searchAssignee || undefined, status: searchStatus || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
          <Input
            key="search-project_id"
            placeholder="搜索所属项目"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchProjectId)}
            onClear={() => setSearchProjectId('')}
          />,
          <Input
            key="search-task_name"
            placeholder="搜索任务名称"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchTaskName)}
            onClear={() => setSearchTaskName('')}
          />,
          <Input
            key="search-assignee"
            placeholder="搜索负责人"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchAssignee)}
            onClear={() => setSearchAssignee('')}
          />,
          <Input
            key="search-status"
            placeholder="搜索任务状态"
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
          <ProFormSelect
            name="project_id"
            label="所属项目"
            rules={[{ required: true, message: '请选择所属项目' }]}
            request={async () => {
              const res = await getProjectOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormText
            name="task_name"
            label="任务名称"
            placeholder="任务名称"
            rules={[{ required: true, message: '请输入任务名称' }]}
            
          />

          <ProFormText
            name="assignee"
            label="负责人"
            placeholder="负责人"
            
            
          />

          <ProFormSelect
            name="status"
            label="任务状态"
            rules={[{ required: true, message: '请选择任务状态' }]}
            request={async () => {
              const list = await getDictDetailsByType('contract_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />
      </ModalForm>
    </>
  );
}
