import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Col,
  message,
  Row,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined, SafetyOutlined, SyncOutlined } from '@ant-design/icons';
import {
  getReservedNames,
  syncReservedNames,
  type ReservedNamesResult,
} from '@/services/autocode';

const { Text, Title } = Typography;

export default function ReservedNamesPage() {
  const [data, setData] = useState<ReservedNamesResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    setSelected([]);
    try {
      const result = await getReservedNames();
      setData(result);
    } catch (err: any) {
      message.error(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (selected.length === 0) {
      message.warning('请先勾选要补录的名称');
      return;
    }
    setSyncing(true);
    try {
      const result = await syncReservedNames(selected);
      if (result.added.length > 0) {
        message.success(`已补录 ${result.added.length} 个：${result.added.join(', ')}`);
      } else {
        message.info('所选名称均已在保留列表中，无需补录');
      }
      await fetchData();
    } catch (err: any) {
      message.error(err.message || '补录失败');
    } finally {
      setSyncing(false);
    }
  };

  const missingColumns = [
    {
      title: (
        <Checkbox
          indeterminate={selected.length > 0 && selected.length < (data?.missing.length ?? 0)}
          checked={data ? selected.length === data.missing.length && data.missing.length > 0 : false}
          onChange={(e) => setSelected(e.target.checked ? (data?.missing ?? []) : [])}
        />
      ),
      key: 'check',
      width: 48,
      render: (_: any, name: string) => (
        <Checkbox
          checked={selected.includes(name)}
          onChange={(e) => {
            setSelected((prev) =>
              e.target.checked ? [...prev, name] : prev.filter((n) => n !== name),
            );
          }}
        />
      ),
    },
    {
      title: '页面目录名',
      dataIndex: '',
      key: 'name',
      render: (_: any, name: string) => <Text code>{name}</Text>,
    },
    {
      title: '状态',
      key: 'status',
      render: () => <Badge status="warning" text="未保留" />,
    },
  ];

  const reservedColumns = [
    {
      title: '保留名（kebab）',
      key: 'name',
      render: (_: any, name: string) => <Text code>{name}</Text>,
    },
    {
      title: '状态',
      key: 'status',
      render: (_: any, name: string) => (
        <Tag color={data?.pagesOnDisk.includes(name) ? 'green' : 'default'}>
          {data?.pagesOnDisk.includes(name) ? '页面存在' : '仅保留'}
        </Tag>
      ),
    },
  ];

  return (
    <div style={{ padding: '0 0 16px 0' }}>
      <Card
        title={
          <Space>
            <SafetyOutlined />
            保留名管理
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={fetchData}>
            刷新扫描
          </Button>
        }
      >
        <Typography.Paragraph type="secondary">
          扫描 <Text code>pages/</Text> 目录下的所有系统页面目录，与
          <Text code>reserved-names.ts</Text>
          中的保留列表对比。若页面目录存在但未被保留，autocode
          生成的业务页面可能覆盖系统页面导致崩溃，需及时补录。
        </Typography.Paragraph>

        {!data && !loading && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <Button type="primary" icon={<ReloadOutlined />} onClick={fetchData} size="large">
              开始扫描
            </Button>
          </div>
        )}

        {data && (
          <Row gutter={[16, 16]}>
            {/* Missing panel */}
            <Col xs={24} lg={12}>
              <Card
                size="small"
                title={
                  <Space>
                    <span>缺少保留的页面目录</span>
                    <Tag color={data.missing.length > 0 ? 'red' : 'green'}>
                      {data.missing.length > 0 ? `${data.missing.length} 个待补录` : '全部已保留'}
                    </Tag>
                  </Space>
                }
                extra={
                  <Button
                    type="primary"
                    size="small"
                    icon={<SyncOutlined />}
                    loading={syncing}
                    disabled={selected.length === 0}
                    onClick={handleSync}
                  >
                    补录所选 ({selected.length})
                  </Button>
                }
              >
                {data.missing.length === 0 ? (
                  <Alert
                    type="success"
                    message="所有系统页面目录均已在保留名列表中 ✓"
                    showIcon
                  />
                ) : (
                  <>
                    <Alert
                      type="warning"
                      message="以下页面目录在磁盘上存在，但未被 reserved-names.ts 保护。勾选后点击「补录所选」写入保留名。"
                      showIcon
                      style={{ marginBottom: 12 }}
                    />
                    <Table<string>
                      dataSource={data.missing}
                      columns={missingColumns}
                      rowKey={(n) => n}
                      size="small"
                      pagination={false}
                    />
                  </>
                )}
              </Card>
            </Col>

            {/* Full reserved list */}
            <Col xs={24} lg={12}>
              <Card
                size="small"
                title={
                  <Space>
                    <span>当前保留名列表</span>
                    <Tag color="blue">{data.reserved.length} 个</Tag>
                  </Space>
                }
              >
                <Table<string>
                  dataSource={data.reserved}
                  columns={reservedColumns}
                  rowKey={(n) => n}
                  size="small"
                  pagination={{ pageSize: 20, size: 'small' }}
                  scroll={{ y: 420 }}
                />
              </Card>
            </Col>
          </Row>
        )}
      </Card>
    </div>
  );
}
