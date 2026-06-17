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
  getTrainingCoursesList,
  createTrainingCours,
  updateTrainingCours,
  deleteTrainingCours,
  batchDeleteTrainingCourses,
  type TrainingCours,
  type CreateTrainingCoursDto,
  type UpdateTrainingCoursDto,
  type TrainingCoursModule,
  type TrainingCoursModuleTask,
} from '@/services/training-cours';
import { getMyBtnPerms } from '@/services/authority-btn';


function TrainingCoursModuleTaskEditor({ row, form }: { row: any; form: any }) {
  const grandRows: any[] = row.tasks || [];
  const [grandKeys, setGrandKeys] = useState<React.Key[]>(() => grandRows.map((r: any) => r.id));
  return (
    <>
      <EditableProTable<TrainingCoursModuleTask>
        rowKey="id"
        size="small"
        value={grandRows}
        onChange={(data) => {
          const cur: any[] = form.getFieldValue('modules') || [];
          form.setFieldValue('modules', cur.map((r: any) => r.id === row.id ? { ...r, tasks: data ?? [] } : r));
        }}
        recordCreatorProps={false}
        editable={{
          type: 'multiple',
          editableKeys: grandKeys,
          onChange: setGrandKeys,
          onValuesChange: (_r, ds) => {
            const cur: any[] = form.getFieldValue('modules') || [];
            form.setFieldValue('modules', cur.map((r: any) => r.id === row.id ? { ...r, tasks: ds } : r));
          },
          actionRender: (grandRow, _cfg, _doms) => [
            <a key="del" onClick={() => {
              const cur: any[] = form.getFieldValue('modules') || [];
              form.setFieldValue('modules', cur.map((r: any) => r.id === row.id ? { ...r, tasks: (r.tasks || []).filter((g: any) => g.id !== grandRow.id) } : r));
              setGrandKeys((ks: React.Key[]) => ks.filter((k) => k !== grandRow.id));
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
                title: '任务描述',
                dataIndex: 'task_desc',
                valueType: 'text',
                formItemProps: { rules: [{ required: false }] },
              },
              {
                title: '预计工时(小时)',
                dataIndex: 'due_hours',
                valueType: 'digit',
                formItemProps: { rules: [{ required: false }] },
              },
              {
                title: '排序',
                dataIndex: 'sort_order',
                valueType: 'digit',
                formItemProps: { rules: [{ required: true }] },
              },
          { title: '操作', valueType: 'option', width: 60 },
        ]}
      />
      <Button type="dashed" size="small" block icon={<PlusOutlined />} style={{ marginTop: 4 }} onClick={() => {
        const tempId = Date.now().toString() + '_' + Math.random().toString(36).slice(2, 8);
        const newGrand = { id: tempId, task_name: '', task_desc: '', due_hours: 0, sort_order: 0 };
        const cur: any[] = form.getFieldValue('modules') || [];
        form.setFieldValue('modules', cur.map((r: any) => r.id === row.id ? { ...r, tasks: [...(r.tasks || []), newGrand] } : r));
        setGrandKeys((ks: React.Key[]) => [...ks, tempId]);
      }}>添加模块任务</Button>
    </>
  );
}

export default function TrainingCoursesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<TrainingCours | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [modulesEditableKeys, setModulesEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<TrainingCours[]>([]);
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
      setBtnPerms(new Set(perms['./training-courses/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<TrainingCours>[] = [
    {
      title: '课程名称',
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
      title: '是否发布',
      dataIndex: 'is_published',
      valueType: 'switch',
      width: 100,
      search: false,
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
                  is_published: record.is_published,
                  modules: record.modules || [],
                });
                setEditingRecord(record);
                setModulesEditableKeys((record.modules || []).map((d: any) => d.id));
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
                  await deleteTrainingCours(record.id);
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
        const dto: UpdateTrainingCoursDto = {
          name: values.name || '',
          description: values.description || '',
          start_date: values.start_date && typeof values.start_date === 'object' ? values.start_date.toISOString() : values.start_date || undefined,
          end_date: values.end_date && typeof values.end_date === 'object' ? values.end_date.toISOString() : values.end_date || undefined,
          is_published: values.is_published ?? false,
          modules: (values.modules || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            tasks: (d.tasks || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),
          })),
        };
        await updateTrainingCours(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateTrainingCoursDto = {
          name: values.name || '',
          description: values.description || '',
          start_date: values.start_date && typeof values.start_date === 'object' ? values.start_date.toISOString() : values.start_date || undefined,
          end_date: values.end_date && typeof values.end_date === 'object' ? values.end_date.toISOString() : values.end_date || undefined,
          is_published: values.is_published ?? false,
          modules: (values.modules || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            tasks: (d.tasks || []).map((g: any) => ({ ...g, id: g.id?.length < 36 ? undefined : g.id })),
          })),
        };
        await createTrainingCours(dto);
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
      const result = await batchDeleteTrainingCourses(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<TrainingCours>
        headerTitle="培训课程（类型3：三层嵌套示例）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.modules?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.modules || []}
              pagination={false}
              expandable={{
                rowExpandable: (r) => (r.tasks?.length ?? 0) > 0,
                expandedRowRender: (childRow) => (
                  <Table size="small" rowKey="id" dataSource={childRow.tasks || []} pagination={false}
                    columns={[{ title: '任务名称', dataIndex: 'task_name' }, { title: '任务描述', dataIndex: 'task_desc' }, { title: '预计工时(小时)', dataIndex: 'due_hours' }, { title: '排序', dataIndex: 'sort_order' }]}
                    style={{ margin: '0 24px' }} />
                ),
              }}
              columns={[
                { title: '模块名称', dataIndex: 'module_name' },
                { title: '模块描述', dataIndex: 'module_desc' },
                { title: '排序', dataIndex: 'sort_order' },
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
          const result = await getTrainingCoursesList({ page, pageSize, name: searchName || undefined });
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
                .filter(r => (r.modules?.length ?? 0) > 0)
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
            placeholder="搜索课程名称"
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
                setModulesEditableKeys([]);
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
            setModulesEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="name"
            label="课程名称"
            placeholder="课程名称"
            rules={[{ required: true, message: '请输入课程名称' }]}
            disabled={!!editingRecord}
          />

          <ProFormTextArea
            name="description"
            label="课程描述"
            placeholder="课程描述"
            
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
            rules={[{ required: true, message: '请输入结束日期' }]}
            
          />

          <ProFormSwitch
            name="is_published"
            label="是否发布"
          />

          <Form.Item name="modules" label="课程模块">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('modules') || [];
                return (
                  <>
                    <EditableProTable<TrainingCoursModule>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('modules', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: modulesEditableKeys,
                        onChange: setModulesEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('modules', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('modules') || [];
                            form.setFieldValue('modules', cur.filter((r: any) => r.id !== row.id));
                            setModulesEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '模块名称',
          dataIndex: 'module_name',
          valueType: 'text',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '模块描述',
          dataIndex: 'module_desc',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '排序',
          dataIndex: 'sort_order',
          valueType: 'digit',
          formItemProps: { rules: [{ required: true }] },
        },
            {
              title: '模块任务',
              dataIndex: 'tasks',
              editable: () => false,
              render: (_: any, row: any) => <TrainingCoursModuleTaskEditor row={row} form={form} />,
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
                        const newRow = { id: tempId, module_name: '', module_desc: '', sort_order: 0, tasks: [] };
                        form.setFieldValue('modules', [...rows, newRow]);
                        setModulesEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加课程模块
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
