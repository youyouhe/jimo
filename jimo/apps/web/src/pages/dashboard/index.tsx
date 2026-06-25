import { useEffect, useState, useMemo } from 'react';
import { ProCard } from '@ant-design/pro-components';
import { Statistic, Row, Col, Badge, Tooltip, List, Typography, Button, Space, Tag } from 'antd';
import { history } from '@umijs/max';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  TableOutlined,
  AuditOutlined,
  ApiOutlined,
  DashboardOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined,
  SafetyOutlined,
} from '@ant-design/icons';
import { useUserStore } from '@/stores/user';
import { getCleanupQueueStatus, getServerInfo, type CleanupQueueStatus, type ServerInfo } from '@/services/system';
import { getAutoCodeHistory, type AutoCodeHistory } from '@/services/autocode';
import { getMyTasks } from '@/services/approval';
import { getRecords } from '@/services/operation-record';

// Stable reference — never create new arrays inside Zustand selectors.
// Object.is([], []) === false, so falling back to a new [] on every render
// would trigger infinite forceStoreRerender when userInfo becomes null.
const EMPTY_ROLES: string[] = [];

export default function DashboardPage() {
  const userInfo = useUserStore((s) => s.userInfo);
  const isLoggedIn = useUserStore((s) => s.isLoggedIn);
  const userRoles: string[] = useUserStore((s) => s.userInfo?.roles ?? EMPTY_ROLES);
  const isAdmin = userRoles.includes('super_admin');

  const [queueStatus, setQueueStatus] = useState<CleanupQueueStatus | null>(null);
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [entityCount, setEntityCount] = useState(-1);
  const [agentCount, setAgentCount] = useState(-1);
  const [pendingApprovals, setPendingApprovals] = useState(-1);
  const [todayOps, setTodayOps] = useState(-1);
  const [tables, setTables] = useState<AutoCodeHistory[]>([]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? '上午好' : hour < 18 ? '下午好' : '晚上好';
  const name = userInfo?.nickname || userInfo?.username || '用户';

  useEffect(() => {
    // Don't fire API calls during/after logout — the page is still mounted
    // in KeepAliveOutlet but the user session is already gone.
    if (!isLoggedIn) return;

    // ── shared: approvals + tables ──
    getMyTasks().then((res) => setPendingApprovals(res.total ?? 0)).catch(() => {});
    getAutoCodeHistory({ page: 1, pageSize: isAdmin ? 500 : 100 }).then((res) => {
      const unique = new Map<string, AutoCodeHistory>();
      for (const item of res.list) {
        if (!unique.has(item.tableName)) unique.set(item.tableName, item);
      }
      const entities = Array.from(unique.values());
      setEntityCount(entities.length);
      setAgentCount(entities.filter((e) => e.hasAgent).length);
      setTables(entities);
    }).catch(() => {});

    // ── admin-only ──
    if (isAdmin) {
      const today = new Date().toISOString().substring(0, 10);
      getRecords({ startDate: today, endDate: today, pageSize: 1 }).then((res) => setTodayOps(res.total ?? 0)).catch(() => {});
      getCleanupQueueStatus().then(setQueueStatus).catch(() => {});
      getServerInfo().then(setServerInfo).catch(() => {});
    }
  }, [isAdmin, isLoggedIn]);

  const roleTag = useMemo(() => {
    if (isAdmin) return { color: 'red' as const, icon: <SafetyOutlined />, text: '超级管理员' };
    return { color: 'blue' as const, icon: <UserOutlined />, text: '用户' };
  }, [isAdmin]);

  // ═══════════════════════════════════════════════════════════════
  // Admin view
  // ═══════════════════════════════════════════════════════════════
  if (isAdmin) {
    return (
      <div style={{ margin: 24, maxWidth: 1200, marginLeft: 'auto', marginRight: 'auto' }}>
        <ProCard style={{ marginBottom: 24 }}>
          <Space size="middle">
            <span style={{ fontSize: 18 }}>{greeting}，{name}</span>
            <Tag color={roleTag.color} icon={roleTag.icon}>{roleTag.text}</Tag>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            管理业务实体、查看系统运行状态和处理后台任务。
          </Typography.Paragraph>
        </ProCard>

        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}><ProCard hoverable onClick={() => history.push('/autocode')}><Statistic title="业务实体" value={entityCount} prefix={<TableOutlined />} loading={entityCount < 0} /></ProCard></Col>
          <Col span={6}><ProCard><Statistic title="实体 Agent" value={agentCount} prefix={<RobotOutlined />} loading={agentCount < 0} valueStyle={agentCount > 0 ? { color: '#1677ff' } : undefined} /></ProCard></Col>
          <Col span={6}><ProCard hoverable onClick={() => history.push('/approvals')}><Statistic title="待审批" value={pendingApprovals} prefix={<AuditOutlined />} loading={pendingApprovals < 0} valueStyle={pendingApprovals > 0 ? { color: '#faad14' } : undefined} /></ProCard></Col>
          <Col span={6}><ProCard><Statistic title="今日操作" value={todayOps} prefix={<ApiOutlined />} loading={todayOps < 0} /></ProCard></Col>
        </Row>

        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={8}>
            <ProCard title="快捷操作">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Button type="primary" icon={<PlusOutlined />} block onClick={() => history.push('/autocode')}>生成业务表</Button>
                <Button icon={<AuditOutlined />} block onClick={() => history.push('/approvals')}>审批管理</Button>
                <Button icon={<ApiOutlined />} block onClick={() => history.push('/autocode?viewMode=history')}>代码生成历史</Button>
              </Space>
            </ProCard>
          </Col>
          <Col span={8}>
            <ProCard title="最近生成的表">
              {tables.length > 0 ? (
                <List size="small" dataSource={tables.slice(0, 5)} renderItem={(item) => (
                  <List.Item>
                    <a onClick={() => history.push(`/lc/${item.tableName.toLowerCase().replace(/_/g, '-')}`)}>{item.tableName}</a>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>{item.visibilityStrategy === 'public' ? '公开' : item.visibilityStrategy === 'private' ? '仅自己' : item.visibilityStrategy}</Typography.Text>
                    {item.hasApprovalFlow && <Badge status="processing" text="审批" style={{ marginLeft: 8 }} />}
                    {item.hasAgent && <Badge status="success" text="Agent" style={{ marginLeft: 8 }} />}
                  </List.Item>
                )} />
              ) : <Typography.Text type="secondary">暂无</Typography.Text>}
            </ProCard>
          </Col>
          <Col span={8}>
            <ProCard title="系统健康">
              {serverInfo ? (
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Statistic title="运行时间" value={serverInfo.uptime} prefix={<DashboardOutlined />} formatter={(v) => { const s = Number(v); const d = Math.floor(s / 86400); const h = Math.floor((s % 86400) / 3600); return d > 0 ? `${d}d ${h}h` : `${h}h ${Math.floor((s % 3600) / 60)}m`; }} />
                  <Statistic title="CPU" value={`${serverInfo.cpus.cores} 核`} />
                  <Statistic title="内存" value={`${Math.round(serverInfo.memory.used / 1073741824)} GB`} suffix={`/ ${Math.round(serverInfo.memory.total / 1073741824)} GB`} />
                </Space>
              ) : <Typography.Text type="secondary">加载中...</Typography.Text>}
            </ProCard>
          </Col>
        </Row>

        {queueStatus && (
          <ProCard title="清理队列" style={{ marginBottom: 24 }}>
            <Row gutter={16}>
              <Col span={6}><Statistic title="已完成" value={queueStatus.done} prefix={<CheckCircleOutlined />} /></Col>
              <Col span={6}><Statistic title="排队中" value={queueStatus.pending} prefix={<ClockCircleOutlined />} valueStyle={queueStatus.pending > 0 ? { color: '#faad14' } : undefined} /></Col>
              <Col span={6}><Statistic title="执行中" value={queueStatus.running} prefix={<SyncOutlined spin={queueStatus.running > 0} />} valueStyle={queueStatus.running > 0 ? { color: '#1677ff' } : undefined} /></Col>
              <Col span={6}><Statistic title="失败" value={queueStatus.failed} prefix={<ExclamationCircleOutlined />} valueStyle={queueStatus.failed > 0 ? { color: '#ff4d4f' } : undefined} /></Col>
            </Row>
            {queueStatus.pendingJobs.length > 0 && (
              <ProCard size="small" title={`排队任务 (${queueStatus.pendingJobs.length})`} style={{ marginTop: 16 }}>
                <List size="small" dataSource={queueStatus.pendingJobs} renderItem={(j) => (<List.Item><Typography.Text code>{j.jobType}</Typography.Text> {j.tableName}<Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>{new Date(j.createdAt).toLocaleString()}</Typography.Text></List.Item>)} />
              </ProCard>
            )}
            {queueStatus.failedJobs.length > 0 && (
              <ProCard size="small" title={`失败任务 (${queueStatus.failedJobs.length})`} style={{ marginTop: 16 }}>
                <List size="small" dataSource={queueStatus.failedJobs} renderItem={(j) => (<List.Item><Tooltip title={j.error}><Typography.Text type="danger" code>{j.jobType}</Typography.Text></Tooltip> {j.tableName}<Typography.Text type="secondary" style={{ marginLeft: 12, fontSize: 12 }}>{new Date(j.createdAt).toLocaleString()}</Typography.Text></List.Item>)} />
              </ProCard>
            )}
          </ProCard>
        )}
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════
  // Regular user view: simple stats + business tables
  // ═══════════════════════════════════════════════════════════════
  return (
    <div style={{ margin: 24, maxWidth: 1000, marginLeft: 'auto', marginRight: 'auto' }}>
      <ProCard style={{ marginBottom: 24 }}>
        <Space size="middle">
          <span style={{ fontSize: 18 }}>{greeting}，{name}</span>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          浏览和操作业务数据，提交审批和处理待办。
        </Typography.Paragraph>
      </ProCard>

      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <ProCard hoverable onClick={() => history.push('/approvals')}>
            <Statistic title="待审批" value={pendingApprovals} prefix={<AuditOutlined />} loading={pendingApprovals < 0} valueStyle={pendingApprovals > 0 ? { color: '#faad14' } : undefined} />
          </ProCard>
        </Col>
        <Col span={12}>
          <ProCard>
            <Statistic title="可访问的业务表" value={entityCount} prefix={<TableOutlined />} loading={entityCount < 0} />
          </ProCard>
        </Col>
      </Row>

      {tables.length > 0 ? (
        <Row gutter={[16, 16]}>
          {tables.map((item) => (
            <Col span={8} key={item.tableName}>
              <ProCard
                hoverable
                size="small"
                onClick={() => history.push(`/lc/${item.tableName.toLowerCase().replace(/_/g, '-')}`)}
              >
                <Space>
                  <TableOutlined />
                  <span>{item.tableName}</span>
                </Space>
                <div style={{ marginTop: 8 }}>
                  {item.visibilityStrategy === 'public'
                    ? <Tag color="green">公开</Tag>
                    : item.visibilityStrategy === 'department'
                    ? <Tag color="blue">部门</Tag>
                    : <Tag>仅自己</Tag>
                  }
                  {item.hasApprovalFlow && <Tag color="orange">审批</Tag>}
                  {item.hasAgent && <Tag color="purple">Agent</Tag>}
                </div>
              </ProCard>
            </Col>
          ))}
        </Row>
      ) : (
        <ProCard><Typography.Text type="secondary">暂无业务表</Typography.Text></ProCard>
      )}
    </div>
  );
}
