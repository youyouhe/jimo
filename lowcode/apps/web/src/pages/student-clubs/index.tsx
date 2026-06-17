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
  getStudentClubsList,
  createStudentClub,
  updateStudentClub,
  deleteStudentClub,
  batchDeleteStudentClubs,
  getStudentOptions,
  getClubOptions,
  type StudentClub,
  type CreateStudentClubDto,
  type UpdateStudentClubDto,
} from '@/services/student-club';
import { getMyBtnPerms } from '@/services/authority-btn';


export default function StudentClubsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<StudentClub | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [searchStudentId, setSearchStudentId] = useState('');
  const [searchClubId, setSearchClubId] = useState('');
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
      setBtnPerms(new Set(perms['./student-clubs/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<StudentClub>[] = [
    {
      title: '学生',
      dataIndex: 'student_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.student_id_display || record.student_id,
    },
    {
      title: '社团',
      dataIndex: 'club_id',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.club_id_display || record.club_id,
    },
    {
      title: '加入日期',
      dataIndex: 'join_date',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.join_date as string).getTime() - new Date(b.join_date as string).getTime(),
    },
    {
      title: '角色(成员/干事/社长)',
      dataIndex: 'role',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.role ?? '').localeCompare(String(b.role ?? '')),
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
                  student_id: record.student_id,
                  club_id: record.club_id,
                  join_date: record.join_date ? dayjs(record.join_date) : null,
                  role: record.role,
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
                  await deleteStudentClub(record.id);
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
        const dto: UpdateStudentClubDto = {
          student_id: values.student_id || undefined,
          club_id: values.club_id || undefined,
          join_date: values.join_date && typeof values.join_date === 'object' ? values.join_date.toISOString() : values.join_date || undefined,
          role: values.role || '',
        };
        await updateStudentClub(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateStudentClubDto = {
          student_id: values.student_id || undefined,
          club_id: values.club_id || undefined,
          join_date: values.join_date && typeof values.join_date === 'object' ? values.join_date.toISOString() : values.join_date || undefined,
          role: values.role || '',
        };
        await createStudentClub(dto);
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
      const result = await batchDeleteStudentClubs(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<StudentClub>
        headerTitle="学生社团关联表（类型5 M:N中间表）"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchStudentId, searchClubId }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getStudentClubsList({ page, pageSize, student_id: searchStudentId || undefined, club_id: searchClubId || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
          <Input
            key="search-student_id"
            placeholder="搜索学生"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStudentId)}
            onClear={() => setSearchStudentId('')}
          />,
          <Input
            key="search-club_id"
            placeholder="搜索社团"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchClubId)}
            onClear={() => setSearchClubId('')}
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
            name="student_id"
            label="学生"
            rules={[{ required: true, message: '请选择学生' }]}
            request={async () => {
              const res = await getStudentOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormSelect
            name="club_id"
            label="社团"
            rules={[{ required: true, message: '请选择社团' }]}
            request={async () => {
              const res = await getClubOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormDateTimePicker
            name="join_date"
            label="加入日期"
            placeholder="加入日期"
            rules={[{ required: true, message: '请输入加入日期' }]}
            
          />

          <ProFormText
            name="role"
            label="角色(成员/干事/社长)"
            placeholder="角色(成员/干事/社长)"
            
            
          />
      </ModalForm>
    </>
  );
}
