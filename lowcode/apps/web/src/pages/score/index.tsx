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
  getScoreList,
  createScore,
  updateScore,
  deleteScore,
  batchDeleteScore,
  getStudentOptions,
  getCourseOptions,
  type Score,
  type CreateScoreDto,
  type UpdateScoreDto,
} from '@/services/score';
import { getMyBtnPerms } from '@/services/authority-btn';
import { getDictDetailsByType } from '@/services/dictionary';

export default function ScorePage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Score | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [courseTypeMap, setCourseTypeMap] = useState<Record<string, string>>({});
  const [searchStudent, setSearchStudent] = useState('');
  const [searchCourse, setSearchCourse] = useState('');
  const [searchMyscoreMin, setSearchMyscoreMin] = useState('');
  const [searchMyscoreMax, setSearchMyscoreMax] = useState('');
  const [searchMemo, setSearchMemo] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  useEffect(() => {

    getDictDetailsByType('course_type').then((list: any[]) => {
      const m: Record<string, string> = {};
      list.forEach((item: any) => { m[item.value] = item.label; });
      setCourseTypeMap(m);
    }).catch(() => {});
  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./score/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Score>[] = [
    {
      title: '学生',
      dataIndex: 'student',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => record.student_display || record.student,
    },
    {
      title: '学科',
      dataIndex: 'course',
      valueType: 'text',
      width: 180,
      search: false,
      render: (_, record) => { const code = record.course_display || record.course; return courseTypeMap[code ?? ''] ?? code; },
    },
    {
      title: '得分',
      dataIndex: 'myscore',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => (Number(a.myscore ?? 0) - Number(b.myscore ?? 0)),
    },
    {
      title: '备注',
      dataIndex: 'memo',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.memo ?? '').localeCompare(String(b.memo ?? '')),
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
                  student: record.student,
                  course: record.course,
                  myscore: record.myscore,
                  memo: record.memo,
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
                  await deleteScore(record.id);
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
        const dto: UpdateScoreDto = {
          student: values.student || '',
          course: values.course || '',
          myscore: String(values.myscore ?? '0'),
          memo: values.memo || '',
        };
        await updateScore(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateScoreDto = {
          student: values.student || '',
          course: values.course || '',
          myscore: String(values.myscore ?? '0'),
          memo: values.memo || '',
        };
        await createScore(dto);
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
      const result = await batchDeleteScore(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Score>
        headerTitle="学科成绩"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchStudent, searchCourse, searchMyscoreMin, searchMyscoreMax, searchMemo }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getScoreList({ page, pageSize, student: searchStudent || undefined, course: searchCourse || undefined, myscoreMin: searchMyscoreMin || undefined, myscoreMax: searchMyscoreMax || undefined, memo: searchMemo || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Input
            key="search-student"
            placeholder="搜索学生"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStudent)}
            onClear={() => setSearchStudent('')}
          />,
          <Input
            key="search-course"
            placeholder="搜索学科"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchCourse)}
            onClear={() => setSearchCourse('')}
          />,
          <Input
            key="search-myscore-min"
            placeholder="得分最小值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchMyscoreMin)}
            onClear={() => setSearchMyscoreMin('')}
          />,
          <Input
            key="search-myscore-max"
            placeholder="得分最大值"
            allowClear
            style={{ width: 120 }}
            onChange={makeDebounce(setSearchMyscoreMax)}
            onClear={() => setSearchMyscoreMax('')}
          />,
          <Input
            key="search-memo"
            placeholder="搜索备注"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchMemo)}
            onClear={() => setSearchMemo('')}
          />,
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
            name="student"
            label="学生"
            
            request={async () => {
              const res = await getStudentOptions();
              return res.map((item: any) => ({ label: item.name, value: item.id }));
            }}
          />

          <ProFormSelect
            name="course"
            label="学科"
            
            request={async () => {
              const res = await getCourseOptions();
              return res.map((item: any) => ({ label: item.course, value: item.id }));
            }}
          />

          <ProFormDigit
            name="myscore"
            label="得分"
            placeholder="得分"
            
            
          />

          <ProFormText
            name="memo"
            label="备注"
            placeholder="备注"
            
            
          />
      </ModalForm>
    </>
  );
}
