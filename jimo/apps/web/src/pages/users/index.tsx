import { useRef, useState, useEffect } from 'react';
import { Button, message, Popconfirm, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
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

type EditableUser = User & { roleIds?: string[] };

export default function UsersPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<EditableUser | null>(null);
  const [allRoles, setAllRoles] = useState<Role[]>([]);

  useEffect(() => {
    getRoles({ page: 1, pageSize: 50 })
      .then((res) => setAllRoles(res.list))
      .catch(() => {});
  }, []);

  const roleIdOptions = allRoles.map((r) => ({
    label: `${r.name} (${r.code})`,
    value: r.id,
  }));

  // Open the edit modal with the user's current role IDs pre-fetched (the list
  // view only carries role codes, but the form submits role IDs).
  const openEdit = async (user: User) => {
    const roleIds = await getUserRoleIds(user.id).catch(() => []);
    setEditingUser({ ...user, roleIds });
    setModalOpen(true);
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
      title: 'Roles',
      dataIndex: 'roles',
      width: 180,
      search: false,
      render: (_, record) => {
        const roles = record.roles ?? [];
        if (roles.length === 0) return <Tag>—</Tag>;
        return (
          <Space size={[4, 4]} wrap>
            {roles.map((code) => (
              <Tag key={code} color={ROLE_COLOR_MAP[code] || 'default'}>
                {ROLE_LABEL_MAP[code] || code}
              </Tag>
            ))}
          </Space>
        );
      },
    },
    {
      title: 'Department',
      dataIndex: 'deptName',
      width: 120,
      search: false,
      render: (_, record) => record.deptName || '-',
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
      width: 160,
      search: false,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(record)}>
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
      const roleIds: string[] = values.roleIds ?? [];
      if (editingUser) {
        const dto: UpdateUserDto = {
          nickname: values.nickname,
          email: values.email || null,
          phone: values.phone || null,
          roleIds,
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
          roleIds,
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
                roleIds: editingUser.roleIds ?? [],
                status: editingUser.status === 1,
              }
            : { status: true, roleIds: [] }
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
          name="roleIds"
          label="Roles"
          options={roleIdOptions}
          fieldProps={{
            mode: 'multiple',
            optionFilterProp: 'label',
            placeholder: 'Select one or more roles',
          }}
          rules={[{ required: true, message: 'At least one role is required' }]}
        />
        <ProFormSwitch name="status" label="Active" />
      </ModalForm>
    </>
  );
}
