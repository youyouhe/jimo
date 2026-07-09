import { useRef, useState, useEffect } from 'react';
import { Button, Drawer, message, Popconfirm, Space, Spin, Tag, Tree } from 'antd';
import type { DataNode } from 'antd/es/tree';
import { PlusOutlined, SafetyCertificateOutlined, RobotOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormTextArea, ProFormSwitch } from '@ant-design/pro-components';
import {
  getRoles,
  createRole,
  updateRole,
  deleteRole,
  getRoleMenus,
  setRoleMenus,
  type Role,
  type CreateRoleDto,
  type UpdateRoleDto,
} from '@/services/role';
import { getMenuTree, type MenuItem } from '@/services/menu';
import SystemAgentPanel from '@/components/SystemAgentPanel';

const { DirectoryTree } = Tree;

/**
 * Convert menu tree items to Antd DataNode tree for Tree component.
 */
function menuToTreeNode(menus: MenuItem[]): DataNode[] {
  return menus.map((m) => ({
    key: m.id,
    title: (
      <Space>
        {m.menuType === 1 ? '📁' : m.menuType === 3 ? '🔘' : '📄'}
        <span style={m.menuType === 1 ? { fontWeight: 600 } : undefined}>
          {m.name}
        </span>
        <span style={{ color: '#999', fontSize: 12 }}>{m.path || ''}</span>
      </Space>
    ),
    children: m.children && m.children.length > 0 ? menuToTreeNode(m.children) : undefined,
  }));
}

export default function RolesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);

  // Permission drawer state
  const [permDrawerOpen, setPermDrawerOpen] = useState(false);
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [menuTree, setMenuTree] = useState<DataNode[]>([]);
  const [checkedMenuIds, setCheckedMenuIds] = useState<string[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const [halfCheckedMenuIds, setHalfCheckedMenuIds] = useState<React.Key[]>([]);
  const [permLoading, setPermLoading] = useState(false);
  const [permSaving, setPermSaving] = useState(false);

  /**
   * Collect all leaf node keys (menus that have no children).
   * Non-leaf nodes are auto-determined by their children's check state.
   */
  const getAllLeafKeys = (nodes: DataNode[]): string[] => {
    const keys: string[] = [];
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        keys.push(...getAllLeafKeys(node.children));
      } else {
        keys.push(node.key as string);
      }
    }
    return keys;
  };

  /**
   * Collect ALL node keys (for full check tracking)
   */
  const getAllKeys = (nodes: DataNode[]): string[] => {
    const keys: string[] = [];
    for (const node of nodes) {
      keys.push(node.key as string);
      if (node.children && node.children.length > 0) {
        keys.push(...getAllKeys(node.children));
      }
    }
    return keys;
  };

  const openPermissionDrawer = async (role: Role) => {
    setPermRole(role);
    setPermDrawerOpen(true);
    setPermLoading(true);
    setCheckedMenuIds([]);
    setHalfCheckedMenuIds([]);

    try {
      const [tree, assignedIds] = await Promise.all([
        getMenuTree(),
        getRoleMenus(role.id),
      ]);
      setMenuTree(menuToTreeNode(tree));
      setCheckedMenuIds(assignedIds);
    } catch (err: any) {
      message.error(err.message || '加载菜单数据失败');
    } finally {
      setPermLoading(false);
    }
  };

  const handlePermSave = async () => {
    if (!permRole) return;
    setPermSaving(true);
    try {
      await setRoleMenus(permRole.id, checkedMenuIds);
      message.success('权限设置已保存');
      setPermDrawerOpen(false);
      // Reload casbin policies are synced server-side
    } catch (err: any) {
      message.error(err.message || '保存失败');
    } finally {
      setPermSaving(false);
    }
  };

  const columns: ProColumns<Role>[] = [
    {
      title: '角色编码',
      dataIndex: 'code',
      width: 160,
      copyable: true,
    },
    {
      title: '角色名称',
      dataIndex: 'name',
      width: 160,
    },
    {
      title: '描述',
      dataIndex: 'description',
      ellipsis: true,
      search: false,
    },
    {
      title: '默认角色',
      dataIndex: 'is_default',
      width: 100,
      search: false,
      render: (_, record) =>
        record.is_default ? <Tag color="blue">默认</Tag> : null,
    },
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
      width: 200,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<SafetyCertificateOutlined />}
            style={{ color: '#1677ff' }}
            onClick={() => openPermissionDrawer(record)}
          >
            权限
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingRole(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该角色？"
            description="删除后无法恢复，已绑定该角色的用户将失去对应权限。"
            onConfirm={async () => {
              try {
                await deleteRole(record.id);
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
      if (editingRole) {
        const dto: UpdateRoleDto = {
          name: values.name,
          description: values.description,
          is_default: values.is_default ? 1 : 0,
        };
        await updateRole(editingRole.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateRoleDto = {
          code: values.code,
          name: values.name,
          description: values.description,
          is_default: values.is_default ? 1 : 0,
        };
        await createRole(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingRole(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  return (
    <>
      <ProTable<Role>
        headerTitle="角色管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, code, name } = params;
          const result = await getRoles({ page, pageSize, code, name });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingRole(null);
              setModalOpen(true);
            }}
          >
            新建角色
          </Button>,
          <Button
            key="agent"
            icon={<RobotOutlined />}
            onClick={() => setAgentOpen(true)}
          >
            AI 助手
          </Button>,
        ]}
      />

      <ModalForm
        title={editingRole ? '编辑角色' : '新建角色'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingRole(null);
          }
        }}
        initialValues={
          editingRole
            ? {
                code: editingRole.code,
                name: editingRole.name,
                description: editingRole.description,
                is_default: Boolean(editingRole.is_default),
              }
            : { is_default: false }
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnHidden: true }}
      >
        <ProFormText
          name="code"
          label="角色编码"
          placeholder="例如: editor"
          rules={[
            { required: true, message: '请输入角色编码' },
            { pattern: /^[a-z_]+$/, message: '仅支持小写字母和下划线' },
          ]}
          disabled={!!editingRole}
        />
        <ProFormText
          name="name"
          label="角色名称"
          placeholder="例如: 编辑员"
          rules={[{ required: true, message: '请输入角色名称' }]}
        />
        <ProFormTextArea
          name="description"
          label="描述"
          placeholder="角色功能描述（可选）"
          fieldProps={{ rows: 3 }}
        />
        <ProFormSwitch name="is_default" label="设为默认角色" />
      </ModalForm>

      {/* ── Permission Assignment Drawer ── */}
      <Drawer
        title={
          <span>
            <SafetyCertificateOutlined style={{ marginRight: 8 }} />
            设置权限 — {permRole?.name || ''}
            {permRole && (
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {permRole.code}
              </Tag>
            )}
          </span>
        }
        open={permDrawerOpen}
        onClose={() => setPermDrawerOpen(false)}
        width={480}
        extra={
          <Space>
            <Button onClick={() => setPermDrawerOpen(false)}>取消</Button>
            <Button type="primary" loading={permSaving} onClick={handlePermSave}>
              保存
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {permLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
              勾选该角色可访问的菜单（选中父节点会自动包含所有子节点）
            </div>
            <Tree
              checkable
              defaultExpandAll
              treeData={menuTree}
              checkedKeys={{
                checked: checkedMenuIds,
                halfChecked: halfCheckedMenuIds,
              }}
              onCheck={(checkedKeys, info) => {
                if (Array.isArray(checkedKeys)) {
                  // checkStrictly fallback — plain key array
                  setCheckedMenuIds(checkedKeys.map(String));
                  setHalfCheckedMenuIds([]);
                } else {
                  setCheckedMenuIds(checkedKeys.checked.map(String));
                  setHalfCheckedMenuIds(checkedKeys.halfChecked ?? []);
                }
              }}
            />
          </>
        )}
      </Drawer>

      <SystemAgentPanel
        open={agentOpen}
        agentType="roles"
        onClose={() => setAgentOpen(false)}
      />
    </>
  );
}
