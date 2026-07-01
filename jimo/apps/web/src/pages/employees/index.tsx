import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space } from 'antd';
import { PlusOutlined, RobotOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormSelect, ProFormDigit } from '@ant-design/pro-components';
import {
  getEmployeesList,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  getEmployeeOptions,
  type EmployeeRow,
  type CreateEmployeeDto,
  type UpdateEmployeeDto,
} from '@/services/employee';
import { getDepartmentOptions, type DepartmentOption } from '@/services/department';
import SystemAgentPanel from '@/components/SystemAgentPanel';

const STATUS_OPTIONS = [
  { label: '在职', value: 1 },
  { label: '离职', value: 2 },
  { label: '休假', value: 3 },
];

/**
 * Native system page: employee management (sys_employees).
 * Hand-written, mounted at /system/employees.
 */
export default function EmployeesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [deptOptions, setDeptOptions] = useState<DepartmentOption[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);

  const loadDeptOptions = async () => {
    try {
      const list = await getDepartmentOptions();
      setDeptOptions(list as unknown as DepartmentOption[]);
    } catch { /* ignore */ }
  };

  const columns: ProColumns<EmployeeRow>[] = [
    { title: '工号', dataIndex: 'employeeNo', width: 130, copyable: true },
    { title: '姓名', dataIndex: 'name', width: 120 },
    {
      title: '部门',
      dataIndex: 'departmentName',
      width: 150,
      search: false,
      render: (_, r) => r.departmentName || '-',
    },
    { title: '职位', dataIndex: 'position', width: 120, search: false },
    { title: '电话', dataIndex: 'phone', width: 140, search: false },
    { title: '邮箱', dataIndex: 'email', width: 180, search: false },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      valueEnum: { 1: '在职', 2: '离职', 3: '休假' },
    },
    {
      title: '入职日期',
      dataIndex: 'entryDate',
      valueType: 'date',
      width: 130,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该员工？"
            description="删除后无法恢复。"
            onConfirm={async () => {
              try {
                await deleteEmployee(record.id);
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
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      const payload = {
        employeeNo: values.employeeNo,
        name: values.name,
        departmentId: values.departmentId || undefined,
        position: values.position || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        status: values.status ?? 1,
        entryDate: values.entryDate || undefined,
        leaveDate: values.leaveDate || undefined,
      };
      if (editing) {
        const dto: UpdateEmployeeDto = payload;
        await updateEmployee(editing.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateEmployeeDto = payload as CreateEmployeeDto;
        await createEmployee(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditing(null);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '操作失败');
    }
  };

  return (
    <>
      <ProTable<EmployeeRow>
        headerTitle="员工管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current, pageSize, keyword, status } = params as any;
          const res = await getEmployeesList({
            page: current,
            pageSize,
            keyword,
            status,
          });
          return { data: res.list, total: res.total, success: true };
        }}
        toolBarRender={() => [
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              loadDeptOptions();
              setModalOpen(true);
            }}
          >
            新增
          </Button>,
          <Button
            key="agent"
            icon={<RobotOutlined />}
            onClick={() => setAgentOpen(true)}
          >
            AI 助手
          </Button>,
        ]}
        search={{
          span: 6,
          labelWidth: 60,
          defaultCollapsed: false,
        }}
      />
      <ModalForm
        title={editing ? '编辑员工' : '新增员工'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setTimeout(() => setEditing(null), 300);
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
        initialValues={editing ?? undefined}
      >
        <ProFormText
          name="employeeNo"
          label="工号"
          rules={[{ required: true, message: '请输入工号' }]}
        />
        <ProFormText
          name="name"
          label="姓名"
          rules={[{ required: true, message: '请输入姓名' }]}
        />
        <ProFormSelect
          name="departmentId"
          label="部门"
          options={deptOptions.map((d) => ({ label: d.name, value: d.id }))}
          fieldProps={{ allowClear: true, showSearch: true }}
          request={async () => {
            const list = await getDepartmentOptions() as unknown as DepartmentOption[];
            setDeptOptions(list);
            return list.map((d) => ({ label: d.name, value: d.id }));
          }}
        />
        <ProFormText name="position" label="职位" />
        <ProFormText name="phone" label="电话" />
        <ProFormText name="email" label="邮箱" />
        <ProFormSelect
          name="status"
          label="状态"
          options={STATUS_OPTIONS}
          initialValue={1}
        />
        <ProFormText name="entryDate" label="入职日期（如 2024-01-15）" />
        {editing && (
          <ProFormText name="leaveDate" label="离职日期（如 2025-01-15）" />
        )}
      </ModalForm>

      <SystemAgentPanel
        open={agentOpen}
        agentType="employees"
        onClose={() => setAgentOpen(false)}
      />
    </>
  );
}
