import { useState, useEffect, useCallback } from 'react';
import { Card, Tabs, Table, Tag, Button, Modal, Form, Input, Radio, message } from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  getMyTasks,
  getMyInitiated,
  approveTask,
  type ApprovalTask,
  type MyInitiatedItem,
} from '@/services/approval';
import dayjs from 'dayjs';

/**
 * 待办审批 — the approval center where approvers see their pending tasks
 * and submitters track their initiated approvals.
 */
export default function ApprovalsPage() {
  const [activeTab, setActiveTab] = useState('pending');
  const [pending, setPending] = useState<ApprovalTask[]>([]);
  const [initiated, setInitiated] = useState<MyInitiatedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [currentPi, setCurrentPi] = useState<string | null>(null);
  const [form] = Form.useForm();

  const loadPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyTasks();
      setPending(res?.list ?? []);
    } catch {
      message.error('加载待办失败');
    }
    setLoading(false);
  }, []);

  const loadInitiated = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyInitiated();
      setInitiated(res?.list ?? []);
    } catch {
      message.error('加载已发起失败');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  const onTabChange = (key: string) => {
    setActiveTab(key);
    if (key === 'pending') loadPending();
    else loadInitiated();
  };

  const handleApprove = async () => {
    try {
      const values = await form.validateFields();
      await approveTask(currentPi!, { approved: values.approved, comment: values.comment });
      message.success(values.approved ? '审批通过' : '已驳回');
      setModalOpen(false);
      form.resetFields();
      loadPending();
    } catch (err: any) {
      if (err?.errorFields) return; // validation error
      message.error(err?.message || '操作失败');
    }
  };

  const statusTag = (status: string) => {
    const map: Record<string, { color: string; text: string }> = {
      PENDING: { color: 'processing', text: '审批中' },
      APPROVED: { color: 'success', text: '已通过' },
      REJECTED: { color: 'error', text: '已驳回' },
    };
    const s = map[status] ?? { color: 'default', text: status };
    return <Tag color={s.color}>{s.text}</Tag>;
  };

  const pendingColumns = [
    {
      title: '流程实例',
      dataIndex: 'processInstanceId',
      width: 280,
      ellipsis: true,
    },
    {
      title: '任务',
      dataIndex: 'taskName',
      width: 100,
    },
    {
      title: '创建时间',
      dataIndex: 'createTime',
      width: 170,
      sorter: (a: ApprovalTask, b: ApprovalTask) => a.createTime - b.createTime,
      defaultSortOrder: 'descend' as const,
      render: (v: number) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
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

  const initiatedColumns = [
    { title: '业务类型', dataIndex: 'businessType', width: 140 },
    { title: '业务ID', dataIndex: 'businessId', width: 280, ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 100, render: statusTag },
    { title: '审批人', dataIndex: 'approverId', width: 100 },
    { title: '审批意见', dataIndex: 'comment', ellipsis: true },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (v: string) => (v ? dayjs(v).format('YYYY-MM-DD HH:mm') : '-'),
    },
  ];

  return (
    <>
      <Card
        extra={
          <Button
            icon={<ReloadOutlined />}
            onClick={() => (activeTab === 'pending' ? loadPending() : loadInitiated())}
            size="small"
          >
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
                />
              ),
            },
            {
              key: 'initiated',
              label: '我发起的',
              children: (
                <Table
                  columns={initiatedColumns}
                  dataSource={initiated}
                  rowKey={(r: MyInitiatedItem) => r.businessType + r.businessId}
                  loading={loading}
                  pagination={{ pageSize: 10 }}
                  size="middle"
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
