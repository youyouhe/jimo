import { useEffect, useState } from 'react';
import {
  Card,
  Descriptions,
  Avatar,
  Button,
  Space,
  Modal,
  Form,
  Input,
  message,
  Tag,
  Typography,
} from 'antd';
import { UserOutlined, EditOutlined, LockOutlined } from '@ant-design/icons';
import { PageContainer, ProCard } from '@ant-design/pro-components';
import {
  getProfile,
  updateProfile,
  changePassword,
  type UserInfo,
  type UpdateProfileDto,
  type ChangePasswordDto,
} from '@/services/user';

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editForm] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const data = await getProfile();
      setProfile(data);
    } catch (err: any) {
      message.error(err.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleEditOpen = () => {
    editForm.setFieldsValue({
      nickname: profile?.nickname,
      email: profile?.email,
      phone: profile?.phone,
      avatar: profile?.avatar,
    });
    setEditModalOpen(true);
  };

  const handleEditSubmit = async () => {
    try {
      const values = await editForm.validateFields();
      setSubmitting(true);
      const dto: UpdateProfileDto = {
        nickname: values.nickname,
        email: values.email || undefined,
        phone: values.phone || undefined,
        avatar: values.avatar || undefined,
      };
      await updateProfile(dto);
      message.success('Profile updated');
      setEditModalOpen(false);
      await fetchProfile();
    } catch (err: any) {
      if (err.message) {
        message.error(err.message || 'Update failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordSubmit = async () => {
    try {
      const values = await passwordForm.validateFields();
      setSubmitting(true);
      const dto: ChangePasswordDto = {
        oldPassword: values.oldPassword,
        newPassword: values.newPassword,
      };
      await changePassword(dto);
      message.success('Password changed successfully');
      setPasswordModalOpen(false);
      passwordForm.resetFields();
    } catch (err: any) {
      if (err.message) {
        message.error(err.message || 'Change failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const statusMap: Record<number, { color: string; text: string }> = {
    1: { color: 'green', text: 'Active' },
    2: { color: 'red', text: 'Disabled' },
  };

  const roleColorMap: Record<string, string> = {
    super_admin: 'red',
    admin: 'blue',
    editor: 'orange',
    viewer: 'default',
  };

  return (
    <PageContainer
      header={{ title: 'Profile' }}
      loading={loading}
    >
      <ProCard title="Personal Information" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 24 }}>
          <Avatar
            size={96}
            src={profile?.avatar}
            icon={!profile?.avatar ? <UserOutlined /> : undefined}
            style={{ flexShrink: 0 }}
          />
          <div style={{ flex: 1 }}>
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Username">
                {profile?.username}
              </Descriptions.Item>
              <Descriptions.Item label="Nickname">
                {profile?.nickname || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Email">
                {profile?.email || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Phone">
                {profile?.phone || '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Roles">
                {profile?.roles?.length ? (
                  <Space size={[4, 4]} wrap>
                    {profile.roles.map((code) => (
                      <Tag key={code} color={roleColorMap[code] || 'default'}>
                        {code}
                      </Tag>
                    ))}
                  </Space>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Status">
                {profile?.status ? (
                  <Tag color={statusMap[profile.status]?.color}>
                    {statusMap[profile.status]?.text}
                  </Tag>
                ) : (
                  '-'
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Created At">
                {profile?.createdAt
                  ? new Date(profile.createdAt).toLocaleString()
                  : '-'}
              </Descriptions.Item>
              <Descriptions.Item label="Last Login">
                {profile?.lastLoginAt
                  ? new Date(profile.lastLoginAt).toLocaleString()
                  : '-'}
              </Descriptions.Item>
            </Descriptions>
            <Space style={{ marginTop: 16 }}>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={handleEditOpen}
              >
                Edit Profile
              </Button>
              <Button
                icon={<LockOutlined />}
                onClick={() => setPasswordModalOpen(true)}
              >
                Change Password
              </Button>
            </Space>
          </div>
        </div>
      </ProCard>

      {/* Edit Profile Modal */}
      <Modal
        title="Edit Profile"
        open={editModalOpen}
        onOk={handleEditSubmit}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="nickname"
            label="Nickname"
            rules={[{ required: true, message: 'Please enter nickname' }]}
          >
            <Input placeholder="Your display name" />
          </Form.Item>
          <Form.Item
            name="email"
            label="Email"
            rules={[{ type: 'email', message: 'Invalid email format' }]}
          >
            <Input placeholder="you@example.com" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input placeholder="+86 13800138000" />
          </Form.Item>
          <Form.Item name="avatar" label="Avatar URL">
            <Input placeholder="https://example.com/avatar.png" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Change Password Modal */}
      <Modal
        title="Change Password"
        open={passwordModalOpen}
        onOk={handlePasswordSubmit}
        onCancel={() => {
          setPasswordModalOpen(false);
          passwordForm.resetFields();
        }}
        confirmLoading={submitting}
        destroyOnClose
      >
        <Form form={passwordForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="oldPassword"
            label="Current Password"
            rules={[
              { required: true, message: 'Please enter current password' },
            ]}
          >
            <Input.Password placeholder="Enter current password" />
          </Form.Item>
          <Form.Item
            name="newPassword"
            label="New Password"
            rules={[
              { required: true, message: 'Please enter new password' },
              { min: 6, message: 'Password must be at least 6 characters' },
            ]}
          >
            <Input.Password placeholder="Enter new password" />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="Confirm Password"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: 'Please confirm new password' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) {
                    return Promise.resolve();
                  }
                  return Promise.reject(
                    new Error('Passwords do not match'),
                  );
                },
              }),
            ]}
          >
            <Input.Password placeholder="Confirm new password" />
          </Form.Item>
        </Form>
      </Modal>
    </PageContainer>
  );
}
