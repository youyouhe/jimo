import { useRef, useState, useEffect } from 'react';
import {
  Badge,
  Button,
  message,
  Popconfirm,
  Space,
  Typography,
  Card,
  Row,
  Col,
  Statistic,
  Descriptions,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
  CloudServerOutlined,
  DatabaseOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProForm, ProFormDigit, ProFormSwitch, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  getSystemConfigs,
  createSystemConfig,
  updateSystemConfig,
  deleteSystemConfig,
  batchDeleteSystemConfigs,
  getServerInfo,
  getMinioConfig,
  saveMinioConfig,
  getDatabaseConfig,
  type SystemConfig,
  type CreateSystemConfigDto,
  type UpdateSystemConfigDto,
  type ServerInfo,
  type MinioConfig,
  type DatabaseInfo,
} from '@/services/system';

const { Text } = Typography;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  return parts.join(' ') || '< 1m';
}

export default function SystemPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SystemConfig | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(false);
  const [minioConfig, setMinioConfig] = useState<MinioConfig | null>(null);
  const [dbInfo, setDbInfo] = useState<DatabaseInfo | null>(null);
  const [minioSaving, setMinioSaving] = useState(false);

  const fetchServerInfo = async () => {
    setInfoLoading(true);
    try {
      const info = await getServerInfo();
      setServerInfo(info);
    } catch (err: any) {
      message.error(err.message || 'Failed to fetch server info');
    } finally {
      setInfoLoading(false);
    }
  };

  const fetchMinioConfig = async () => {
    try {
      const data = await getMinioConfig();
      setMinioConfig(data);
    } catch { /* ignore */ }
  };

  const fetchDbInfo = async () => {
    try {
      const data = await getDatabaseConfig();
      setDbInfo(data);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    fetchServerInfo();
    fetchMinioConfig();
    fetchDbInfo();
  }, []);

  const columns: ProColumns<SystemConfig>[] = [
    {
      title: 'Key',
      dataIndex: 'key',
      width: 220,
      copyable: true,
    },
    {
      title: 'Value',
      dataIndex: 'value',
      ellipsis: true,
      width: 280,
      render: (_, record) => (
        <Text ellipsis={{ tooltip: record.value }} style={{ maxWidth: 240 }}>
          {record.value}
        </Text>
      ),
    },
    {
      title: 'Description',
      dataIndex: 'desc',
      ellipsis: true,
      search: false,
      render: (_, record) =>
        record.desc ? (
          <Text ellipsis={{ tooltip: record.desc }} style={{ maxWidth: 200 }}>
            {record.desc}
          </Text>
        ) : (
          <Text type="secondary">--</Text>
        ),
    },
    {
      title: 'Updated',
      dataIndex: 'updatedAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'Action',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingConfig(record);
              setModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Confirm delete?"
            description="This action cannot be undone."
            onConfirm={async () => {
              try {
                await deleteSystemConfig(record.id);
                message.success('Deleted');
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
      if (editingConfig) {
        const dto: UpdateSystemConfigDto = {
          key: values.key,
          value: values.value,
          desc: values.desc || '',
        };
        await updateSystemConfig(editingConfig.id, dto);
        message.success('Updated');
      } else {
        const dto: CreateSystemConfigDto = {
          key: values.key,
          value: values.value,
          desc: values.desc || '',
        };
        await createSystemConfig(dto);
        message.success('Created');
      }
      setModalOpen(false);
      setEditingConfig(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteSystemConfigs(selectedRowKeys);
      message.success(`Deleted ${result.count} config(s)`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Batch delete failed');
    }
  };

  const handleSaveMinio = async (values: any) => {
    setMinioSaving(true);
    try {
      const saved = await saveMinioConfig({
        endpoint: values.endpoint,
        port: Number(values.port),
        accessKey: values.accessKey,
        secretKey: values.secretKey,
        bucket: values.bucket,
        useSSL: !!values.useSSL,
      });
      setMinioConfig(saved);
      message.success('MinIO 配置已保存');
    } catch (err: any) {
      message.error(err.message || '保存失败');
    } finally {
      setMinioSaving(false);
    }
  };

  const memUsagePercent = serverInfo
    ? ((serverInfo.memory.used / serverInfo.memory.total) * 100).toFixed(1)
    : '0';

  return (
    <div style={{ padding: '0 0 16px 0' }}>
      {serverInfo && (
        <Card
          title={
            <Space>
              <CloudServerOutlined />
              Server Information
            </Space>
          }
          extra={
            <Button
              icon={<ReloadOutlined />}
              size="small"
              loading={infoLoading}
              onClick={fetchServerInfo}
            >
              Refresh
            </Button>
          }
          style={{ marginBottom: 16 }}
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Platform"
                value={`${serverInfo.platform} / ${serverInfo.arch}`}
                prefix={<CloudServerOutlined />}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Hostname"
                value={serverInfo.hostname}
                prefix={<DatabaseOutlined />}
              />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic title="CPU Cores" value={serverInfo.cpus.cores} />
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Statistic
                title="Uptime"
                value={formatUptime(serverInfo.uptime)}
                prefix={<ClockCircleOutlined />}
              />
            </Col>
          </Row>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={8}>
              <Statistic
                title="Total RAM"
                value={formatBytes(serverInfo.memory.total)}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="Used RAM"
                value={formatBytes(serverInfo.memory.used)}
                suffix={`/ ${memUsagePercent}%`}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="Free RAM"
                value={formatBytes(serverInfo.memory.free)}
              />
            </Col>
          </Row>
          <Row style={{ marginTop: 16 }}>
            <Col span={24}>
              <Descriptions size="small" column={3}>
                <Descriptions.Item label="Node.js">
                  {serverInfo.nodeVersion}
                </Descriptions.Item>
                <Descriptions.Item label="OS Release">
                  {serverInfo.release}
                </Descriptions.Item>
                <Descriptions.Item label="CPU Model">
                  {serverInfo.cpus.model}
                </Descriptions.Item>
                <Descriptions.Item label="Load Average (1/5/15m)">
                  {serverInfo.loadavg.map((v) => v.toFixed(2)).join(' / ')}
                </Descriptions.Item>
              </Descriptions>
            </Col>
          </Row>
        </Card>
      )}

      {infoLoading && !serverInfo && (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <Spin size="large" />
        </div>
      )}

      <Card title="对象存储配置" style={{ marginBottom: 24 }}>
        {minioConfig ? (
          <ProForm
            initialValues={minioConfig}
            onFinish={handleSaveMinio}
            submitter={{
              submitButtonProps: { loading: minioSaving },
              searchConfig: { submitText: '保存配置' },
              render: (_, dom) => dom[1],
            }}
            layout="horizontal"
            labelCol={{ span: 6 }}
            wrapperCol={{ span: 14 }}
          >
            <ProFormText name="endpoint" label="Endpoint" placeholder="localhost" rules={[{ required: true }]} />
            <ProFormDigit name="port" label="端口" placeholder="9000" min={1} max={65535} fieldProps={{ precision: 0 }} rules={[{ required: true }]} />
            <ProFormText name="accessKey" label="Access Key" rules={[{ required: true }]} />
            <ProFormText name="secretKey" label="Secret Key" fieldProps={{ type: 'password' }} placeholder="不修改请留空或保持 ******" />
            <ProFormText name="bucket" label="Bucket" rules={[{ required: true }]} />
            <ProFormSwitch name="useSSL" label="使用 SSL" />
          </ProForm>
        ) : (
          <Spin />
        )}
      </Card>

      <Card title="数据库连接信息" style={{ marginBottom: 24 }}>
        {dbInfo ? (
          <Descriptions column={2}>
            <Descriptions.Item label="主机">{dbInfo.host}</Descriptions.Item>
            <Descriptions.Item label="端口">{dbInfo.port}</Descriptions.Item>
            <Descriptions.Item label="数据库">{dbInfo.database}</Descriptions.Item>
            <Descriptions.Item label="用户名">{dbInfo.username}</Descriptions.Item>
            <Descriptions.Item label="状态">
              <Badge
                status={dbInfo.status === 'connected' ? 'success' : 'error'}
                text={dbInfo.status === 'connected' ? '已连接' : '不可用'}
              />
            </Descriptions.Item>
          </Descriptions>
        ) : (
          <Spin />
        )}
      </Card>

      <ProTable<SystemConfig>
        headerTitle="System Config"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize, key } = params;
          const result = await getSystemConfigs({ page, pageSize, key });
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
              setEditingConfig(null);
              setModalOpen(true);
            }}
          >
            New Config
          </Button>,
          selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="Confirm batch delete?"
              description={`${selectedRowKeys.length} config(s) selected. This cannot be undone.`}
              onConfirm={handleBatchDelete}
              okText="Confirm"
              cancelText="Cancel"
            >
              <Button danger>
                Batch Delete ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ]}
      />

      <ModalForm
        title={editingConfig ? 'Edit Config' : 'New Config'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingConfig(null);
          }
        }}
        initialValues={
          editingConfig
            ? {
                key: editingConfig.key,
                value: editingConfig.value,
                desc: editingConfig.desc,
              }
            : {}
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="key"
          label="Key"
          placeholder="e.g. site.title"
          rules={[
            { required: true, message: 'Please enter a config key' },
            {
              pattern: /^[a-z0-9_.]+$/,
              message: 'Only lowercase letters, digits, underscores and dots',
            },
          ]}
          disabled={!!editingConfig}
          extra={editingConfig ? 'Key cannot be changed after creation' : 'Use lowercase, digits, underscores or dots'}
        />
        <ProFormText
          name="value"
          label="Value"
          placeholder="e.g. My App"
          rules={[{ required: true, message: 'Please enter a value' }]}
        />
        <ProFormTextArea
          name="desc"
          label="Description"
          placeholder="Optional description"
          fieldProps={{ rows: 3 }}
        />
      </ModalForm>
    </div>
  );
}
