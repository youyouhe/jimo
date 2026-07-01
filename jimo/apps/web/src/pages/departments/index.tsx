import { useEffect, useState } from 'react';
import { Button, message, Popconfirm, Space, Table, Card } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, RobotOutlined, EditOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
} from '@ant-design/pro-components';
import {
  getDepartmentTree,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  getDepartmentOptions,
  type DepartmentTreeNode,
  type CreateDepartmentDto,
  type UpdateDepartmentDto,
} from '@/services/department';
import { getUserOptions } from '@/services/user';
import SystemAgentPanel from '@/components/SystemAgentPanel';

/**
 * Department management — tree table (hierarchical display like dictionary details).
 */
export default function DepartmentsPage() {
  const [treeData, setTreeData] = useState<DepartmentTreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DepartmentTreeNode | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);

  const loadTree = async () => {
    setLoading(true);
    try {
      const data = await getDepartmentTree();
      setTreeData(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTree(); }, []);

  const columns: ColumnsType<DepartmentTreeNode> = [
    { title: '部门名称', dataIndex: 'name', width: 200 },
    { title: '部门编码', dataIndex: 'code', width: 140 },
    {
      title: '负责人',
      dataIndex: 'leadId',
      width: 120,
      render: (_, r) => (r as any).lead_display || '-',
    },
    { title: '描述', dataIndex: 'description', ellipsis: true },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (_, r) => r.createdAt ? new Date(r.createdAt).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => { setEditing(record); setModalOpen(true); }}
          />
          <Popconfirm
            title="确认删除该部门？"
            description="子部门不会被自动删除。"
            onConfirm={async () => {
              try {
                await deleteDepartment(record.id);
                message.success('删除成功');
                loadTree();
              } catch (err: any) {
                message.error(err.message || '删除失败');
              }
            }}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} />
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
        await updateDepartment(editing.id, payload as UpdateDepartmentDto);
        message.success('更新成功');
      } else {
        await createDepartment(payload as CreateDepartmentDto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditing(null);
      loadTree();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  return (
    <>
      <Card
        title="部门管理"
        extra={
          <Space>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => { setEditing(null); setModalOpen(true); }}
            >
              新建部门
            </Button>
            <Button icon={<RobotOutlined />} onClick={() => setAgentOpen(true)}>
              AI 助手
            </Button>
            <Button icon={<ReloadOutlined />} onClick={loadTree} loading={loading} />
          </Space>
        }
      >
        <Table<DepartmentTreeNode>
          rowKey="id"
          loading={loading}
          dataSource={treeData}
          pagination={false}
          size="small"
          columns={columns}
          expandable={{}}
          rowClassName={(record) => record.parentId ? 'dept-row-child' : 'dept-row-root'}
        />
      </Card>

      <style>{`
        .dept-row-root td { background: #f0f5ff !important; font-weight: 500; }
        .dept-row-child td { background: #fff !important; }
        .dept-row-root:hover td { background: #d6e4ff !important; }
        .dept-row-child:hover td { background: #f5f5f5 !important; }
      `}</style>

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
            const res = await getUserOptions();
            return res.map((u) => ({ label: u.label, value: u.id }));
          }}
        />
      </ModalForm>

      <SystemAgentPanel
        open={agentOpen}
        agentType="departments"
        onClose={() => setAgentOpen(false)}
      />
    </>
  );
}
