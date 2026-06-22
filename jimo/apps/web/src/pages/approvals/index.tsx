import { useState, useEffect, useCallback } from 'react';
import { Card, Tabs, Table, Tag, Button, Modal, Form, Input, Radio, message, Empty, Typography } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import {
  getMyTasks,
  getMyDone,
  getFinalized,
  getMyDrafts,
  approveTask,
  type ApprovalTask,
  type DoneTask,
  type FinalizedItem,
  type DraftItem,
} from '@/services/approval';
import dayjs from 'dayjs';

/**
 * 流程中心 (Workflow Center) — covers the approval lifecycle states:
 *   待办 (pending for me) · 已办 (done by me) · 办结 (finalized) · 我的起草 (my
 *   drafts) · 委托替办 (delegation — coming soon).
 *
 * Data sources differ per tab: 待办/已办 come from BPM (proxied), 办结/我的起草
 * are resolved locally by NestJS.
 */
export default function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState('pending');
  const [pending, setPending] = useState<ApprovalTask[]>([]);
  const [done, setDone] = useState<DoneTask[]>([]);
  const [finalized, setFinalized] = useState<FinalizedItem[]>([]);
  const [drafts, setDrafts] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPi, setCurrentPi] = useState<string | null>(null);
  const [form] = Form.useForm();

  const load = useCallback(async (tab: string) => {
    setLoading(true);
    try {
      if (tab === 'pending') setPending((await getMyTasks())?.list ?? []);
      else if (tab === 'done') setDone((await getMyDone())?.list ?? []);
      else if (tab === 'finalized') setFinalized((await getFinalized())?.list ?? []);
      else if (tab === 'drafts') setDrafts((await getMyDrafts())?.list ?? []);
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load('pending');
  }, [load]);

  const onTabChange = (key: string) => {
    setActiveTab(key);
    load(key);
  };

  const handleApprove = async () => {
    try {
      const values = await form.validateFields();
      await approveTask(currentPi!, { approved: values.approved, comment: values.comment });
      message.success(values.approved ? '审批通过' : '已驳回');
      setModalOpen(false);
      form.resetFields();
      load('pending');
    } catch (err: any) {
      if (err?.errorFields) return; // validation error
      message.error(err?.message || '操作失败');
    }
  };

  const statusTag = (status: string | null | undefined) => {
    const map: Record<string, { color: string; text: string }> = {
      PENDING: { color: 'processing', text: '审批中' },
      APPROVED: { color: 'success', text: '已通过' },
      REJECTED: { color: 'error', text: '已驳回' },
      DRAFT: { color: 'default', text: '未提交' },
    };
    const s = (status && map[status]) || { color: 'default', text: status || '-' };
    return <Tag color={s.color}>{s.text}</Tag>;
  };

  const actionTag = (action: string | null | undefined) => {
    if (action === 'APPROVED') return <Tag color="success">通过</Tag>;
    if (action === 'REJECTED') return <Tag color="error">驳回</Tag>;
    return <Tag color="default">-</Tag>;
  };

  const SKIP_COLS = new Set([
    'id', 'created_at', 'updated_at', 'deleted_at', 'created_by', 'updated_by', 'owner_id', 'shared_with',
  ]);

  const doneRecordExpandedRow = (row: DoneTask) => {
    if (!row.record) return null;
    const fields = Object.entries(row.record).filter(([k]) => !SKIP_COLS.has(k));
    if (fields.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '4px 24px',
          padding: '4px 0',
        }}
      >
        {fields.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 100 }}>
              {humanize(k)}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 13 }}>{renderValue(v)}</Typography.Text>
          </div>
        ))}
      </div>
    );
  };

  const recordExpandedRow = (row: ApprovalTask) => {
    if (!row.record) return null;
    const fields = Object.entries(row.record).filter(([k]) => !SKIP_COLS.has(k));
    if (fields.length === 0) return <Typography.Text type="secondary">—</Typography.Text>;
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '4px 24px',
          padding: '4px 0',
        }}
      >
        {fields.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', gap: 8 }}>
            <Typography.Text type="secondary" style={{ fontSize: 12, minWidth: 100 }}>
              {humanize(k)}
            </Typography.Text>
            <Typography.Text style={{ fontSize: 13 }}>{renderValue(v)}</Typography.Text>
          </div>
        ))}
      </div>
    );
  };

  // Group done tasks by businessType for a cleaner per-type display.
  const doneGroups = (() => {
    const map: Record<string, DoneTask[]> = {};
    for (const t of done) {
      const k = t.businessType || '-';
      (map[k] ??= []).push(t);
    }
    return Object.entries(map);
  })();
  const humanize = (col: string) =>
    col
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

  const renderValue = (v: unknown): React.ReactNode => {
    if (v == null) return <Typography.Text type="secondary">-</Typography.Text>;
    const s = String(v);
    // Data-URI embedded images → thumbnail so the approver can actually see it
    if (s.startsWith('data:image/')) {
      return (
        <img src={s} alt="" style={{ maxWidth: 80, maxHeight: 60, borderRadius: 4, border: '1px solid #eee', objectFit: 'cover' }} />
      );
    }
    // HTTP/storage URLs → clickable link
    if (/^https?:\/\//.test(s) || s.startsWith('/storage/') || s.startsWith('/api/')) {
      return (
        <a href={s} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
          Open
        </a>
      );
    }
    // Long text → truncate with native tooltip
    if (s.length > 200) {
      return (
        <Typography.Text ellipsis style={{ maxWidth: 300 }} title={s}>
          {s}
        </Typography.Text>
      );
    }
    return <Typography.Text style={{ fontSize: 13 }}>{s}</Typography.Text>;
  };

  const pendingColumns = [
    { title: '业务类型', dataIndex: 'businessType', width: 130, render: (v: any) => v || '-' },
    { title: '任务', dataIndex: 'taskName', width: 80 },
    {
      title: '创建时间',
      dataIndex: 'createTime',
      width: 160,
      sorter: (a: ApprovalTask, b: ApprovalTask) => a.createTime - b.createTime,
      defaultSortOrder: 'descend' as const,
      render: (v: number) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, record: ApprovalTask) => (
        <Button
          type="link"
          size="small"
          onClick={() => {
            setCurrentPi(record.processInstanceId);
            setModalOpen(true);
          }}
        >
          审批
        </Button>
      ),
    },
  ];

  const doneColumns = [
    { title: '业务类型', dataIndex: 'businessType', width: 120, render: (v: any) => v || '-' },
    { title: '任务', dataIndex: 'taskName', width: 110 },
    { title: '结果', dataIndex: 'action', width: 80, render: actionTag },
    { title: '意见', dataIndex: 'comment', ellipsis: true },
    {
      title: '完成时间',
      dataIndex: 'endTime',
      width: 160,
      render: (v: number) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
  ];

  const finalizedColumns = [
    { title: '业务类型', dataIndex: 'businessType', width: 120, render: (v: any) => v || '-' },
    { title: '业务ID', dataIndex: 'businessId', width: 260, ellipsis: true, render: (v: any) => v || '-' },
    { title: '结果', dataIndex: 'status', width: 90, render: statusTag },
    { title: '发起人', dataIndex: 'initiatorId', width: 100 },
    { title: '最终审批人', dataIndex: 'approverId', width: 100 },
    { title: '意见', dataIndex: 'comment', ellipsis: true },
    {
      title: '办结时间',
      dataIndex: 'updatedAt',
      width: 160,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
  ];

  const draftColumns = [
    { title: '业务类型', dataIndex: 'businessName', width: 140 },
    { title: '业务ID', dataIndex: 'businessId', width: 280, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (s: string) => statusTag(s === 'REJECTED' ? 'REJECTED' : 'DRAFT'),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      render: (_: unknown, record: DraftItem) => (
        <Button type="link" size="small" onClick={() => history.push(`/lc/${record.businessType}`)}>
          去处理
        </Button>
      ),
    },
  ];

  return (
    <>
      <Card
        extra={
          <Button icon={<ReloadOutlined />} onClick={() => load(activeTab)} size="small">
            刷新
          </Button>
        }
      >
        <Tabs
          activeKey={activeTab}
          onChange={onTabChange}
          items={[
            {
              key: 'pending',
              label: `待办 (${pending.length})`,
              children: (
                <Table
                  columns={pendingColumns}
                  dataSource={pending}
                  rowKey="processInstanceId"
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  size="middle"
                  expandable={{ expandedRowRender: recordExpandedRow }}
                />
              ),
            },
            {
              key: 'done',
              label: `已办 (${done.length})`,
              children: done.length === 0 ? (
                <Empty description="暂无已办记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                doneGroups.map(([bt, tasks]) => (
                  <div key={bt} style={{ marginBottom: bt === doneGroups[doneGroups.length - 1]![0] ? 0 : 16 }}>
                    <Typography.Title level={5} style={{ margin: '0 0 8px' }}>
                      {bt} ({tasks.length})
                    </Typography.Title>
                    <Table
                      columns={doneColumns}
                      dataSource={tasks}
                      rowKey="taskId"
                      pagination={false}
                      size="small"
                      expandable={{ expandedRowRender: doneRecordExpandedRow }}
                    />
                  </div>
                ))
              ),
            },
            {
              key: 'finalized',
              label: `办结 (${finalized.length})`,
              children: (
                <Table
                  columns={finalizedColumns}
                  dataSource={finalized}
                  rowKey={(r: FinalizedItem) => r.businessType + r.businessId}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  size="middle"
                />
              ),
            },
            {
              key: 'drafts',
              label: `我的起草 (${drafts.length})`,
              children: (
                <Table
                  columns={draftColumns}
                  dataSource={drafts}
                  rowKey={(r: DraftItem) => r.businessType + r.businessId}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  size="middle"
                />
              ),
            },
            {
              key: 'delegation',
              label: '委托替办（即将推出）',
              disabled: true,
              children: (
                <Empty
                  description="该功能将在后续版本支持任务委托与收回。"
                  style={{ padding: '40px 0' }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="审批"
        open={modalOpen}
        onOk={handleApprove}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        okText="提交"
        cancelText="取消"
      >
        <Form form={form} layout="vertical" initialValues={{ approved: true }}>
          <Form.Item name="approved" label="审批结果" rules={[{ required: true }]}>
            <Radio.Group>
              <Radio.Button value={true}>
                <CheckCircleOutlined /> 通过
              </Radio.Button>
              <Radio.Button value={false}>
                <CloseCircleOutlined /> 驳回
              </Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="comment" label="审批意见">
            <Input.TextArea rows={3} placeholder="请输入审批意见（可选）" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
