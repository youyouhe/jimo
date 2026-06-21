import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
} from '@ant-design/pro-components';
import {
  getDepartmentsList,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentOptions,
  type Department,
  type CreateDepartmentDto,
  type UpdateDepartmentDto,
} from '@/services/department';
import { getUsers } from '@/services/user';

/**
 * Native system page: department management (sys_departments).
 * Hand-written (not autocode-generated), mounted at /system/departments.
 */
export default function DepartmentsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

  const columns: ProColumns<Department>[] = [
    { title: '部门名称', dataIndex: 'name', width: 180 },
    { title: '部门编码', dataIndex: 'code', width: 160, copyable: true },
    {
      title: '上级部门',
      dataIndex: 'parent_id_display',
      width: 160,
      search: false,
      render: (_, r) => r.parent_id_display || '-',
    },
    {
      title: '负责人',
      dataIndex: 'lead_display',
      width: 140,
      search: false,
      render: (_, r) => r.lead_display || '-',
    },
    { title: '描述', dataIndex: 'description', ellipsis: true, search: false },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
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
            title="确认删除该部门？"
            description="删除后无法恢复。"
            onConfirm={async () => {
              try {
                await deleteDepartment(record.id);
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
        name: values.name,
        code: values.code,
        description: values.description,
        parentId: values.parentId || null,
        leadId: values.leadId || null,
      };
      if (editing) {
        const dto: UpdateDepartmentDto = payload;
        await updateDepartment(editing.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateDepartmentDto = payload;
        await createDepartment(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditing(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  return (
    <>
      <ProTable<Department>
        headerTitle="部门管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, name, code } = params;
          const result = await getDepartmentsList({ page, pageSize, name, code });
          return { data: result.list, total: result.total, success: true };
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            新建部门
          </Button>,
        ]}
      />

      <ModalForm
        title={editing ? '编辑部门' : '新建部门'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditing(null);
        }}
        initialValues={
          editing
            ? {
                name: editing.name,
                code: editing.code,
                description: editing.description || undefined,
                parentId: editing.parentId || undefined,
                leadId: editing.leadId || undefined,
              }
            : {}
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnHidden: true }}
      >
        <ProFormText
          name="name"
          label="部门名称"
          placeholder="例如: 采购部"
          rules={[{ required: true, message: '请输入部门名称' }]}
        />
        <ProFormText
          name="code"
          label="部门编码"
          placeholder="例如: D001"
          rules={[{ required: true, message: '请输入部门编码' }]}
          disabled={!!editing}
        />
        <ProFormTextArea
          name="description"
          label="描述"
          placeholder="部门职责说明（可选）"
          fieldProps={{ rows: 3 }}
        />
        <ProFormSelect
          name="parentId"
          label="上级部门"
          allowClear
          request={async () => {
            const res = await getDepartmentOptions();
            return res.map((d) => ({ label: d.name, value: d.id }));
          }}
        />
        <ProFormSelect
          name="leadId"
          label="部门负责人"
          placeholder="选择部门负责人（用于审批 SELF_DEPT_LEAD 解析）"
          allowClear
          showSearch
          request={async () => {
            const res = await getUsers({ pageSize: 999 });
            return (res.list || []).map((u) => ({
              label: u.nickname || u.username,
              value: u.id,
            }));
          }}
        />
      </ModalForm>
    </>
  );
}
