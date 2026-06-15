import { useRef, useState, useEffect } from 'react';
import { Button, Drawer, message, Popconfirm, Select, Space, Spin, Tag } from 'antd';
import { PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormSelect,
  ProFormSwitch,
} from '@ant-design/pro-components';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
  getUserRoleIds,
  assignUserRoles,
  type User,
  type CreateUserDto,
  type UpdateUserDto,
} from '@/services/user';
import { getRoles, type Role } from '@/services/role';

const ROLE_COLOR_MAP: Record<string, string> = {
  super_admin: 'red',
  admin: 'blue',
  editor: 'green',
  viewer: 'default',
};

const ROLE_LABEL_MAP: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
};

export default function UsersPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Role data from API
  const [allRoles, setAllRoles] = useState<Role[]>([]);

  // Multi-role assignment drawer state
  const [roleDrawerOpen, setRoleDrawerOpen] = useState(false);
  const [roleTargetUser, setRoleTargetUser] = useState<User | null>(null);
  const [assignedRoleIds, setAssignedRoleIds] = useState<string[]>([]);
  const [roleLoading, setRoleLoading] = useState(false);
  const [roleSaving, setRoleSaving] = useState(false);

  useEffect(() => {
    getRoles({ page: 1, pageSize: 50 })
      .then((res) => setAllRoles(res.list))
      .catch(() => {});
  }, []);

  const roleOptions = allRoles.map((r) => ({
    label: `${r.name} (${r.code})`,
    value: r.code,
  }));

  const roleIdOptions = allRoles.map((r) => ({
    label: `${r.name} (${r.code})`,
    value: r.id,
  }));

  // ── Multi-role drawer handlers ──
  const openRoleDrawer = async (user: User) => {
    setRoleTargetUser(user);
    setRoleDrawerOpen(true);
    setRoleLoading(true);
    setAssignedRoleIds([]);
    try {
      const ids = await getUserRoleIds(user.id);
      setAssignedRoleIds(ids);
    } catch (err: any) {
      message.error(err.message || 'Load roles failed');
    } finally {
      setRoleLoading(false);
    }
  };

  const handleRoleSave = async () => {
    if (!roleTargetUser) return;
    setRoleSaving(true);
    try {
      await assignUserRoles(roleTargetUser.id, assignedRoleIds);
      message.success('Roles updated');
      setRoleDrawerOpen(false);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Save failed');
    } finally {
      setRoleSaving(false);
    }
  };

  const columns: ProColumns<User>[] = [
    {
      title: 'Username',
      dataIndex: 'username',
      width: 140,
      copyable: true,
      ellipsis: true,
    },
    {
      title: 'Nickname',
      dataIndex: 'nickname',
      width: 140,
      ellipsis: true,
    },
    {
      title: 'Email',
      dataIndex: 'email',
      width: 200,
      ellipsis: true,
      search: false,
    },
    {
      title: 'Phone',
      dataIndex: 'phone',
      width: 150,
      search: false,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      width: 120,
      search: false,
      render: (_, record) => (
        <Tag color={ROLE_COLOR_MAP[record.role] || 'default'}>
          {ROLE_LABEL_MAP[record.role] || record.role}
        </Tag>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 100,
      search: false,
      render: (_, record) =>
        record.status === 1 ? (
          <Tag color="green">Active</Tag>
        ) : (
          <Tag color="red">Disabled</Tag>
        ),
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'Actions',
      key: 'action',
      width: 240,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<SafetyCertificateOutlined />}
            style={{ color: '#1677ff' }}
            onClick={() => openRoleDrawer(record)}
          >
            Roles
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingUser(record);
              setModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this user?"
            description="The user will be soft-deleted and cannot log in."
            onConfirm={async () => {
              try {
                await deleteUser(record.id);
                message.success('User deleted');
                actionRef.current?.reload();
              } catch (err: any) {
                message.error(err.message || 'Delete failed');
              }
            }}
            okText="Confirm"
            cancelText="Cancel"
          >
            <Button type="link" size="small" danger>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingUser) {
        const dto: UpdateUserDto = {
          nickname: values.nickname,
          email: values.email || null,
          phone: values.phone || null,
          role: values.role,
          status: values.status ? 1 : 2,
        };
        await updateUser(editingUser.id, dto);
        message.success('User updated');
      } else {
        const dto: CreateUserDto = {
          username: values.username,
          password: values.password,
          nickname: values.nickname,
          email: values.email || undefined,
          phone: values.phone || undefined,
          role: values.role,
          status: values.status ? 1 : 2,
        };
        await createUser(dto);
        message.success('User created');
      }
      setModalOpen(false);
      setEditingUser(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  return (
    <>
      <ProTable<User>
        headerTitle="User Management"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, username, nickname } = params;
          const result = await getUsers({ page, pageSize, username, nickname });
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
              setEditingUser(null);
              setModalOpen(true);
            }}
          >
            New User
          </Button>,
        ]}
      />

      <ModalForm
        title={editingUser ? 'Edit User' : 'New User'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingUser(null);
          }
        }}
        initialValues={
          editingUser
            ? {
                username: editingUser.username,
                nickname: editingUser.nickname,
                email: editingUser.email,
                phone: editingUser.phone,
                role: editingUser.role,
                status: editingUser.status === 1,
              }
            : { status: true, role: 'viewer' }
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnHidden: true }}
      >
        <ProFormText
          name="username"
          label="Username"
          placeholder="e.g. john_doe"
          rules={[
            { required: true, message: 'Username is required' },
            { min: 3, message: 'At least 3 characters' },
            { max: 64, message: 'At most 64 characters' },
          ]}
          disabled={!!editingUser}
        />
        <ProFormText.Password
          name="password"
          label="Password"
          placeholder="Enter password"
          rules={[
            { required: !editingUser, message: 'Password is required' },
            { min: 6, message: 'At least 6 characters' },
          ]}
          fieldProps={{ visibilityToggle: true }}
        />
        <ProFormText
          name="nickname"
          label="Nickname"
          placeholder="e.g. John Doe"
          rules={[{ required: true, message: 'Nickname is required' }]}
        />
        <ProFormText
          name="email"
          label="Email"
          placeholder="e.g. john@example.com"
          rules={[{ type: 'email', message: 'Invalid email format' }]}
        />
        <ProFormText
          name="phone"
          label="Phone"
          placeholder="e.g. +86 13800138000"
        />
        <ProFormSelect
          name="role"
          label="Primary Role"
          options={roleOptions}
          rules={[{ required: true, message: 'Role is required' }]}
          placeholder="Select primary role"
        />
        <ProFormSwitch name="status" label="Active" />
      </ModalForm>

      {/* ── Multi-Role Assignment Drawer ── */}
      <Drawer
        title={
          <span>
            <SafetyCertificateOutlined style={{ marginRight: 8 }} />
            Assign Roles — {roleTargetUser?.nickname || roleTargetUser?.username || ''}
            {roleTargetUser && (
              <Tag color="blue" style={{ marginLeft: 8 }}>
                {roleTargetUser.username}
              </Tag>
            )}
          </span>
        }
        open={roleDrawerOpen}
        onClose={() => setRoleDrawerOpen(false)}
        width={420}
        extra={
          <Space>
            <Button onClick={() => setRoleDrawerOpen(false)}>Cancel</Button>
            <Button type="primary" loading={roleSaving} onClick={handleRoleSave}>
              Save
            </Button>
          </Space>
        }
        destroyOnHidden
      >
        {roleLoading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Spin size="large" />
          </div>
        ) : (
          <>
            <div style={{ marginBottom: 12, color: '#666', fontSize: 13 }}>
              Select one or more roles for this user. Multi-role support via RBAC.
            </div>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="Select roles..."
              value={assignedRoleIds}
              onChange={(vals) => setAssignedRoleIds(vals)}
              options={roleIdOptions}
              optionFilterProp="label"
            />
          </>
        )}
      </Drawer>
    </>
  );
}
