import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
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
  ProFormDateTimePicker,
} from '@ant-design/pro-components';
import {
  getStudentsList,
  createStudent,
  updateStudent,
  deleteStudent,
  batchDeleteStudents,
  type Student,
  type CreateStudentDto,
  type UpdateStudentDto,
} from '@/services/lc/student';
import ReassignModal from '@/components/ReassignModal';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';


export default function StudentsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Student | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [reassignOpen, setReassignOpen] = useState(false);
  const [form] = Form.useForm();
  const [genderOptions, setGenderOptions] = useState<Record<string, { text: string }>>({});
  const [enrollmentStatusOptions, setEnrollmentStatusOptions] = useState<Record<string, { text: string }>>({});
  const [searchStudentNo, setSearchStudentNo] = useState('');
  const [searchName, setSearchName] = useState('');
  const [searchGender, setSearchGender] = useState('');
  const [searchClassName, setSearchClassName] = useState('');
  const [searchEnrollmentStatus, setSearchEnrollmentStatus] = useState('');
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
    getDictDetailsByType('enrollment_status').then((list: any[]) => {
      const map: Record<string, { text: string }> = {};
      list.forEach((item: any) => { map[item.value] = { text: item.label }; });
      setEnrollmentStatusOptions(map);
    }).catch(() => {});

  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./lc/students/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Student>[] = [
    {
      title: '学号',
      dataIndex: 'student_no',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.student_no ?? '').localeCompare(String(b.student_no ?? '')),
    },
    {
      title: '姓名',
      dataIndex: 'name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')),
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
      title: '出生日期',
      dataIndex: 'birth_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.birth_date as string).getTime() - new Date(b.birth_date as string).getTime(),
    },
    {
      title: '班级',
      dataIndex: 'class_name',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.class_name ?? '').localeCompare(String(b.class_name ?? '')),
    },
    {
      title: '学籍状态',
      dataIndex: 'enrollment_status',
      valueType: 'select',
      width: 120,
      search: false,
      valueEnum: enrollmentStatusOptions,
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
                  student_no: record.student_no,
                  name: record.name,
                  gender: record.gender,
                  birth_date: record.birth_date ? dayjs(record.birth_date) : null,
                  class_name: record.class_name,
                  phone: record.phone,
                  email: record.email,
                  enrollment_status: record.enrollment_status,
                  address: record.address,
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
          student_no: values.student_no || '',
          name: values.name || '',
          gender: values.gender || '',
          birth_date: values.birth_date && typeof values.birth_date === 'object' ? values.birth_date.toISOString() : values.birth_date || undefined,
          class_name: values.class_name || '',
          phone: values.phone || '',
          email: values.email || '',
          enrollment_status: values.enrollment_status || '',
          address: values.address || '',
        };
        await updateStudent(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateStudentDto = {
          student_no: values.student_no || '',
          name: values.name || '',
          gender: values.gender || '',
          birth_date: values.birth_date && typeof values.birth_date === 'object' ? values.birth_date.toISOString() : values.birth_date || undefined,
          class_name: values.class_name || '',
          phone: values.phone || '',
          email: values.email || '',
          enrollment_status: values.enrollment_status || '',
          address: values.address || '',
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
        headerTitle="学生表"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchStudentNo, searchName, searchGender, searchClassName, searchEnrollmentStatus }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getStudentsList({ page, pageSize, student_no: searchStudentNo || undefined, name: searchName || undefined, gender: searchGender || undefined, class_name: searchClassName || undefined, enrollment_status: searchEnrollmentStatus || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
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
            key="search-name"
            placeholder="搜索姓名"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchName)}
            onClear={() => setSearchName('')}
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
            key="search-class_name"
            placeholder="搜索班级"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchClassName)}
            onClear={() => setSearchClassName('')}
          />,
          <Input
            key="search-enrollment_status"
            placeholder="搜索学籍状态"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchEnrollmentStatus)}
            onClear={() => setSearchEnrollmentStatus('')}
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
            name="student_no"
            label="学号"
            placeholder="学号"
            rules={[{ required: true, message: '请输入学号' }]}
            disabled={!!editingRecord}
          />

          <ProFormText
            name="name"
            label="姓名"
            placeholder="姓名"
            rules={[{ required: true, message: '请输入姓名' }]}
            
          />

          <ProFormSelect
            name="gender"
            label="性别"
            
            request={async () => {
              const list = await getDictDetailsByType('gender');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormDateTimePicker
            name="birth_date"
            label="出生日期"
            placeholder="出生日期"
            
            
          />

          <ProFormText
            name="class_name"
            label="班级"
            placeholder="班级"
            
            
          />

          <ProFormText
            name="phone"
            label="联系电话"
            placeholder="联系电话"
            
            
          />

          <ProFormText
            name="email"
            label="邮箱"
            placeholder="邮箱"
            
            
          />

          <ProFormSelect
            name="enrollment_status"
            label="学籍状态"
            
            request={async () => {
              const list = await getDictDetailsByType('enrollment_status');
              return list.map((item: any) => ({ label: item.label, value: item.value }));
            }}
          />

          <ProFormTextArea
            name="address"
            label="家庭地址"
            placeholder="家庭地址"
            
            fieldProps={{ rows: 3 }}
          />
      </ModalForm>

      <ReassignModal
        open={reassignOpen}
        businessType="students"
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
