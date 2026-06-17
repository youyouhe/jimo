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
} from '@ant-design/pro-components';
import {
  getStudentsList,
  createStudent,
  updateStudent,
  deleteStudent,
  batchDeleteStudents,
  getStudentClubOptions,
  getClubOptions,
  type Student,
  type CreateStudentDto,
  type UpdateStudentDto,
  type StudentClubs,
} from '@/services/student';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function StudentsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Student | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [clubRecordsEditableKeys, setClubRecordsEditableKeys] = useState<React.Key[]>([]);
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  const currentDataRef = useRef<Student[]>([]);
  const [genderOptions, setGenderOptions] = useState<Record<string, { text: string }>>({});
  const [searchName, setSearchName] = useState('');
  const [searchStudentNo, setSearchStudentNo] = useState('');
  const [searchGender, setSearchGender] = useState('');
  const [searchEnrollmentYearMin, setSearchEnrollmentYearMin] = useState('');
  const [searchEnrollmentYearMax, setSearchEnrollmentYearMax] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {
    getDictDetailsByType('gender').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      setGenderOptions(map);
    }).catch(() => {});

  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./students/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
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
      title: '学号',
      dataIndex: 'student_no',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.student_no ?? '').localeCompare(String(b.student_no ?? '')),
    },
    {
      title: '性别',
      dataIndex: 'gender',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: genderOptions,
    },
    {
      title: '入学年份',
      dataIndex: 'enrollment_year',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.enrollment_year ?? 0) - Number(b.enrollment_year ?? 0)),
    },
    {
      title: '社团记录',
      dataIndex: 'club_records',
      valueType: 'text',
      width: 150,
      search: false,
      render: (_, record) => {
        const items = record.club_records || [];
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
                  student_no: record.student_no,
                  gender: record.gender,
                  enrollment_year: record.enrollment_year,
                  club_records: (record.club_records || []).map((d: any) => ({ ...d, join_date: d.join_date ? dayjs(d.join_date) : null })),
                });
                setEditingRecord(record);
                setClubRecordsEditableKeys((record.club_records || []).map((d: any) => d.id));
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
          gender: values.gender || '',
          enrollment_year: values.enrollment_year ?? 0,
          club_records: (values.club_records || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            join_date: d.join_date && typeof d.join_date === 'object' ? d.join_date.toISOString() : d.join_date,
          })),
        };
        await updateStudent(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateStudentDto = {
          name: values.name || '',
          student_no: values.student_no || '',
          gender: values.gender || '',
          enrollment_year: values.enrollment_year ?? 0,
          club_records: (values.club_records || []).map((d: any) => ({
            ...d,
            id: d.id?.length < 36 ? undefined : d.id,
            join_date: d.join_date && typeof d.join_date === 'object' ? d.join_date.toISOString() : d.join_date,
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
      const result = await batchDeleteStudents(selectedRowKeys);
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
        headerTitle="学生表（更新：类型5 M:N - 用 existing 模式挂 student_clubs 实现学生↔社团多对多）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        expandable={{
          expandedRowKeys,
          onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as string[]),
          rowExpandable: (record) => (record.club_records?.length ?? 0) > 0,
          expandedRowRender: (record) => (
            <Table
              size="small"
              rowKey="id"
              dataSource={record.club_records || []}
              pagination={false}
              columns={[
                { title: '社团', dataIndex: 'club_id', render: (_: any, r: any) => r.club_id_display || r.club_id },
                { title: '加入日期', dataIndex: 'join_date' },
                { title: '角色', dataIndex: 'role' },
              ]}
              style={{ margin: '0 48px' }}
            />
          ),
        }}
        search={false}
        params={{ searchName, searchStudentNo, searchGender, searchEnrollmentYearMin, searchEnrollmentYearMax }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getStudentsList({ page, pageSize, name: searchName || undefined, student_no: searchStudentNo || undefined, gender: searchGender || undefined, enrollment_yearMin: searchEnrollmentYearMin || undefined, enrollment_yearMax: searchEnrollmentYearMax || undefined });
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
                .filter(r => (r.club_records?.length ?? 0) > 0)
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
            placeholder="搜索姓名"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
          />,
          <Input
            key="search-student_no"
            placeholder="搜索学号"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStudentNo)}
            onClear={() => setSearchStudentNo('')}
          />,
          <Input
            key="search-gender"
            placeholder="搜索性别"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchGender)}
            onClear={() => setSearchGender('')}
          />,
          <Input
            key="search-enrollment_year-min"
            placeholder="入学年份最小值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchEnrollmentYearMin)}
            onClear={() => setSearchEnrollmentYearMin('')}
          />,
          <Input
            key="search-enrollment_year-max"
            placeholder="入学年份最大值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchEnrollmentYearMax)}
            onClear={() => setSearchEnrollmentYearMax('')}
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
                setClubRecordsEditableKeys([]);
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
            setClubRecordsEditableKeys([]);
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
            rules={[{ required: true, message: '请输入姓名' }]}
            
          />

          <ProFormText
            name="student_no"
            label="学号"
            placeholder="学号"
            rules={[{ required: true, message: '请输入学号' }]}
            disabled={!!editingRecord}
          />

          <ProFormSelect
            name="gender"
            label="性别"
            rules={[{ required: true, message: '请选择性别' }]}
            request={async () => {
              const list = await getDictDetailsByType('gender');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormDigit
            name="enrollment_year"
            label="入学年份"
            placeholder="入学年份"
            rules={[{ required: true, message: '请输入入学年份' }]}
            
          />

          <Form.Item name="club_records" label="社团记录">
            <Form.Item noStyle shouldUpdate>
              {() => {
                const rows: any[] = form.getFieldValue('club_records') || [];
                return (
                  <>
                    <EditableProTable<StudentClubs>
                      rowKey="id"
                      value={rows}
                      onChange={(data) => { form.setFieldValue('club_records', data ?? []); }}
                      recordCreatorProps={false}
                      editable={{
                        type: 'multiple',
                        editableKeys: clubRecordsEditableKeys,
                        onChange: setClubRecordsEditableKeys,
                        onValuesChange: (_record, dataSource) => { form.setFieldValue('club_records', dataSource); },
                        actionRender: (row, _config, _defaultDoms) => [
                          <a key="delete" onClick={() => {
                            const cur: any[] = form.getFieldValue('club_records') || [];
                            form.setFieldValue('club_records', cur.filter((r: any) => r.id !== row.id));
                            setClubRecordsEditableKeys((keys: React.Key[]) => keys.filter((k) => k !== row.id));
                          }} style={{ color: '#ff4d4f' }}>删除</a>,
                        ],
                      }}
                      columns={[
        {
          title: '社团',
          dataIndex: 'club_id',
          valueType: 'select',
          render: (_: any, r: any) => r.club_id_display || r.club_id,
          formItemProps: { rules: [{ required: true }] },
          request: async () => {
            const res = await getClubOptions();
            return res.map((item: any) => ({ label: item.name, value: item.id }));
          },
          fieldProps: { showSearch: true },
        },
        {
          title: '加入日期',
          dataIndex: 'join_date',
          valueType: 'dateTime',
          formItemProps: { rules: [{ required: true }] },
        },
        {
          title: '角色',
          dataIndex: 'role',
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
                        const newRow = { id: tempId, club_id: '', join_date: null, role: '' };
                        form.setFieldValue('club_records', [...rows, newRow]);
                        setClubRecordsEditableKeys((keys: React.Key[]) => [...keys, tempId]);
                      }}
                    >
                      添加社团记录
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
