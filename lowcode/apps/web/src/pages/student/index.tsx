import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Button, message, Popconfirm, Space, Form, Table, Input, Tabs } from 'antd';
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
  getStudentList,
  createStudent,
  updateStudent,
  deleteStudent,
  batchDeleteStudent,
  getScoreOptions,
  getCourseOptions,
  type Student,
  type CreateStudentDto,
  type UpdateStudentDto,
} from '@/services/student';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';

export default function StudentPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Student | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [familyEditableKeys, setFamilyEditableKeys] = useState<React.Key[]>([]);
  const [scoreEditableKeys, setScoreEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Student[]>([]);
  const [searchName, setSearchName] = useState('');
  const [searchAgeMin, setSearchAgeMin] = useState('');
  const [searchAgeMax, setSearchAgeMax] = useState('');
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
  const [courseTypeMap, setCourseTypeMap] = useState<Record<string, string>>({});
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./student/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);
  useEffect(() => {
    getDictDetailsByType('course_type').then((list: any[]) => {
      const map: Record<string, string> = {};
      list.forEach((d: any) => { map[d.value] = d.label; });
      setCourseTypeMap(map);
    }).catch(() => {});
  }, []);

  const columns: ProColumns<Student>[] = [
    {
      title: '姓名',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
    },
    {
      title: '年龄',
      dataIndex: 'age',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.age ?? 0) - Number(b.age ?? 0)),
    },
    {
      title: '家庭',
      dataIndex: 'family',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.family || [];
        return items.length > 0 ? items.length + ' 条' : '-';
      },
    },
    {
      title: '成绩',
      dataIndex: 'score',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.score || [];
        if (items.length === 0) return '-';
        const names = items.slice(0, 3).map(i => i.myscore).filter(Boolean).join(', ');
        return items.length > 3 ? names + '... 等' + items.length + '条' : names;
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
                  age: record.age,
                  family: record.family || [],
                  score: record.score || [],
                });
                setEditingRecord(record);
                setFamilyEditableKeys((record.family || []).map((d: any) => d.id));
                setScoreEditableKeys((record.score || []).map((d: any) => d.id));
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
                  await deleteStudent(record.id);
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
        const dto: UpdateStudentDto = {
          name: values.name || '',
          age: values.age ?? 0,
          family: (values.family || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
          score: (values.score || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await updateStudent(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateStudentDto = {
          name: values.name || '',
          age: values.age ?? 0,
          family: (values.family || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
          score: (values.score || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
          })),
        };
        await createStudent(dto);
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
      const result = await batchDeleteStudent(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Student>
        headerTitle="学生信息"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.family?.length ?? 0) > 0 || (record.score?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Tabs
              style={{ margin: '0 48px' }}
              items={[
                {
                  key: 'family',
                  label: '家庭',
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={record.family || []}
                      pagination={false}
                      columns={[
                        { title: '姓名', dataIndex: 'name' },
                        { title: '关系', dataIndex: 'relation' },
                      ]}
                    />
                  ),
                },
                {
                  key: 'score',
                  label: '成绩',
                  children: (
                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={record.score || []}
                      pagination={false}
                      columns={[
                        { title: '学科', dataIndex: 'course', render: (_: any, r: any) => courseTypeMap[r.course_display] || r.course_display || r.course },
                        { title: '得分', dataIndex: 'myscore' },
                        { title: '备注', dataIndex: 'memo' },
                      ]}
                    />
                  ),
                }
              ]}
            />
          ),
        }}
        search={false}
        params={{ searchName, searchAgeMin, searchAgeMax }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getStudentList({ page, pageSize, name: searchName || undefined, ageMin: searchAgeMin || undefined, ageMax: searchAgeMax || undefined });
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
                .filter(r => (r.family?.length ?? 0) > 0 || (r.score?.length ?? 0) > 0)
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
            placeholder="搜索姓名"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-age-min"
            placeholder="年龄最小值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchAgeMin)}
            onClear={() => setSearchAgeMin('')}
          />,
          <Input
            key="search-age-max"
            placeholder="年龄最大值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchAgeMax)}
            onClear={() => setSearchAgeMax('')}
          />,
          btnPerms.has('add') && (
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditingRecord(null);
                setFamilyEditableKeys([]);
                setScoreEditableKeys([]);
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
            setFamilyEditableKeys([]);
            setScoreEditableKeys([]);
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="name"
            label="姓名"
            placeholder="姓名"
            
            
          />

          <ProFormDigit
            name="age"
            label="年龄"
            placeholder="年龄"
            
            
          />

          <Tabs
            items={[
          {
            key: 'family',
            label: '家庭',
            forceRender: true,
            children: (
          <Form.Item name="family" label="家庭">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('family') || [];
                return (
                  <>
                    <EditableProTable<StudentFamily>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('family', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: familyEditableKeys,
                        onChange: setFamilyEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('family', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('family') || [];
                            form.setFieldValue('family', cur.filter((r: any) => r.id !== row.id));
                            setFamilyEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '姓名',
          dataIndex: 'name',
          valueType: 'text',
          formItemProps: { rules: [{ required: false }] },
        },
        {
          title: '关系',
          dataIndex: 'relation',
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
                        const newRow = { id: tempId, name: '', relation: '' };
                        form.setFieldValue('family', [...rows, newRow]);
                        setFamilyEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加家庭
                    </Button>
                  </>
                );
              }}
            </Form.Item>
          </Form.Item>
            ),
          },
          {
            key: 'score',
            label: '成绩',
            forceRender: true,
            children: (
          <Form.Item name="score" label="成绩">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('score') || [];
                return (
                  <>
                    <EditableProTable<Score>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('score', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: scoreEditableKeys,
                        onChange: setScoreEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('score', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('score') || [];
                            form.setFieldValue('score', cur.filter((r: any) => r.id !== row.id));
                            setScoreEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '学科',
          dataIndex: 'course',
          valueType: 'select',
          render: (_: any, r: any) => courseTypeMap[r.course_display] || r.course_display || r.course,
          formItemProps: { rules: [{ required: false }] },
          request: async () => {
            const [res, items] = await Promise.all([
              getCourseOptions(),
              getDictDetailsByType('course_type'),
            ]);
            const m: Record<string, string> = {};
            items.forEach((d: any) => { m[d.value] = d.label; });
            setCourseTypeMap((prev: Record<string, string>) => ({ ...prev, ...m }));
            return res.map((item: any) => ({ label: m[item.course] || item.course, value: item.id }));
          },
          fieldProps: { showSearch: true },
        },
        {
          title: '得分',
          dataIndex: 'myscore',
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
                        const newRow = { id: tempId, course: '', myscore: 0, memo: '' };
                        form.setFieldValue('score', [...rows, newRow]);
                        setScoreEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加成绩
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
