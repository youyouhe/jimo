import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Tag, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormDateTimePicker } from '@ant-design/pro-components';
import {
  getApiTokens,
  generateApiToken,
  revokeApiToken,
  type ApiToken,
  type CreateApiTokenDto,
} from '@/services/api-token';

const { Text } = Typography;

export default function ApiTokensPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);

  const columns: ProColumns<ApiToken>[] = [
    {
      title: 'Name',
      dataIndex: 'name',
      width: 180,
      copyable: true,
    },
    {
      title: 'Token',
      dataIndex: 'token',
      width: 200,
      ellipsis: true,
      copyable: true,
      search: false,
      render: (_, record) => (
        <Text
          copyable={{ text: record.token }}
          style={{ fontFamily: 'monospace', fontSize: 12 }}
        >
          {record.token.substring(0, 16)}...
        </Text>
      ),
    },
    {
      title: 'Expires At',
      dataIndex: 'expiresAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      render: (_, record) => {
        if (!record.expiresAt) return <Tag color="default">Never</Tag>;
        const isExpired = new Date(record.expiresAt) < new Date();
        return <Tag color={isExpired ? 'red' : 'green'}>{record.expiresAt}</Tag>;
      },
    },
    {
      title: 'Last Used',
      dataIndex: 'lastUsedAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      render: (_, record) => (record.lastUsedAt ? record.lastUsedAt : <Tag color="default">Never</Tag>),
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      search: false,
      render: (_, record) => (
        <Popconfirm
          title="Confirm revoke this token?"
          description="This action cannot be undone."
          onConfirm={async () => {
            try {
              await revokeApiToken(record.id);
              message.success('Token revoked');
              actionRef.current?.reload();
            } catch (err: any) {
              message.error(err.message || 'Revoke failed');
            }
          }}
          okText="Confirm"
          cancelText="Cancel"
        >
          <Button type="link" size="small" danger>
            Revoke
          </Button>
        </Popconfirm>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      const dto: CreateApiTokenDto = {
        name: values.name,
        expiresAt: values.expiresAt,
      };
      const result = await generateApiToken(dto);
      setGeneratedToken(result.token);
      message.success('Token generated');
      setModalOpen(false);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Generation failed');
      return false;
    }
  };

  return (
    <>
      <ProTable<ApiToken>
        headerTitle="API Tokens"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, name } = params;
          const result = await getApiTokens({ page, pageSize, name });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Button
            key="generate"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setGeneratedToken(null);
              setModalOpen(true);
            }}
          >
            Generate Token
          </Button>,
        ]}
      />

      <ModalForm
        title="Generate API Token"
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setGeneratedToken(null);
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true, width: 480 }}
      >
        <ProFormText
          name="name"
          label="Token Name"
          placeholder="e.g. My Service Token"
          rules={[{ required: true, message: 'Please enter a token name' }]}
        />
        <ProFormDateTimePicker
          name="expiresAt"
          label="Expires At (optional)"
          placeholder="Leave empty for no expiry"
        />
        {generatedToken && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              background: '#f6ffed',
              border: '1px solid #b7eb8f',
              borderRadius: 4,
            }}
          >
            <div style={{ marginBottom: 8, fontWeight: 500 }}>Your new token (copy it now):</div>
            <Text
              copyable
              code
              style={{ wordBreak: 'break-all', fontSize: 12 }}
            >
              {generatedToken}
            </Text>
          </div>
        )}
      </ModalForm>
    </>
  );
}
