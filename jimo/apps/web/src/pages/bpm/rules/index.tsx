import { useRef, useState } from 'react';
import {
  Button,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Tag,
  Typography,
} from 'antd';
import { EditOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  type ResolutionRule,
} from '@/services/bpm-rules';

// ── Strategy metadata ──────────────────────────────────────────────────────────

const STRATEGY_OPTIONS = [
  { value: 'SELF_DEPT_LEAD',   label: '发起人所在部门负责人' },
  { value: 'PARENT_DEPT_LEAD', label: '发起人上级部门负责人' },
  { value: 'FIXED_DEPT_LEAD',  label: '指定部门负责人' },
  { value: 'BY_TITLE',         label: '按职称查找' },
  { value: 'BY_USER_ID',       label: '直接指定用户ID' },
];

const STRATEGY_TAG_COLOR: Record<string, string> = {
  SELF_DEPT_LEAD:   'blue',
  PARENT_DEPT_LEAD: 'cyan',
  FIXED_DEPT_LEAD:  'geekblue',
  BY_TITLE:         'purple',
  BY_USER_ID:       'orange',
};

const STRATEGY_LABEL: Record<string, string> = Object.fromEntries(
  STRATEGY_OPTIONS.map((o) => [o.value, o.label]),
);

/** Strategies that require extra config fields */
const NEEDS_DEPT_ID = 'FIXED_DEPT_LEAD';
const NEEDS_TITLE   = 'BY_TITLE';

// ── Main page ──────────────────────────────────────────────────────────────────

export default function BpmRulesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen]   = useState(false);
  const [editingRule, setEditingRule] = useState<ResolutionRule | null>(null);
  const [submitting, setSubmitting]  = useState(false);
  const [form] = Form.useForm<ResolutionRule & { deptId?: string; title?: string }>();
  const strategy = Form.useWatch('strategy', form);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditingRule(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (record: ResolutionRule) => {
    setEditingRule(record);
    form.setFieldsValue({
      ...record,
      deptId: record.config?.deptId as string | undefined,
      title:  record.config?.title  as string | undefined,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingRule(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    let values: ResolutionRule & { deptId?: string; title?: string };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    // Build config from strategy-specific fields
    const config: Record<string, unknown> = {};
    if (values.strategy === NEEDS_DEPT_ID && values.deptId) {
      config['deptId'] = values.deptId;
    }
    if (values.strategy === NEEDS_TITLE && values.title) {
      config['title'] = values.title;
    }

    const dto: ResolutionRule = {
      ruleName: values.ruleName,
      label:    values.label,
      strategy: values.strategy,
      ...(Object.keys(config).length > 0 ? { config } : {}),
    };

    setSubmitting(true);
    try {
      if (editingRule) {
        await updateRule(editingRule.ruleName, dto);
        message.success('规则已更新');
      } else {
        await createRule(dto);
        message.success('规则已创建');
      }
      closeModal();
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err?.message || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: ResolutionRule) => {
    try {
      await deleteRule(record.ruleName);
      message.success('规则已删除');
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  // ── Columns ──────────────────────────────────────────────────────────────────

  const columns: ProColumns<ResolutionRule>[] = [
    {
      title: '规则名称',
      dataIndex: 'ruleName',
      width: 200,
      ellipsis: true,
      search: false,
      render: (_, record) => (
        <Typography.Text code copyable>
          {record.ruleName}
        </Typography.Text>
      ),
    },
    {
      title: '显示标签',
      dataIndex: 'label',
      width: 180,
      ellipsis: true,
      search: false,
    },
    {
      title: '解析策略',
      dataIndex: 'strategy',
      width: 200,
      search: false,
      render: (_, record) => (
        <Tag color={STRATEGY_TAG_COLOR[record.strategy] ?? 'default'}>
          {STRATEGY_LABEL[record.strategy] ?? record.strategy}
        </Tag>
      ),
    },
    {
      title: '配置',
      dataIndex: 'config',
      width: 220,
      search: false,
      render: (_, record) =>
        record.config && Object.keys(record.config).length > 0 ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {JSON.stringify(record.config)}
          </Typography.Text>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 160,
      search: false,
      render: (_, record) => (
        <Space size={0}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该规则？"
            description="删除后不可恢复。"
            onConfirm={() => handleDelete(record)}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      <ProTable<ResolutionRule>
        headerTitle="BPM审批规则管理"
        actionRef={actionRef}
        rowKey="ruleName"
        search={false}
        columns={columns}
        request={async () => {
          const list = await listRules();
          return { data: list, total: list.length, success: true };
        }}
        toolBarRender={() => [
          <Button
            key="create"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
          >
            新增规则
          </Button>,
        ]}
      />

      <Modal
        title={editingRule ? '编辑规则' : '新增规则'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        confirmLoading={submitting}
        okText={editingRule ? '保存' : '创建'}
        cancelText="取消"
        destroyOnClose
        width={520}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="ruleName"
            label="规则名称"
            rules={[
              { required: true, message: '请输入规则名称' },
              {
                pattern: /^[a-zA-Z0-9_]+$/,
                message: '只允许字母、数字和下划线',
              },
            ]}
          >
            <Input
              placeholder="e.g. dept_lead_rule"
              disabled={!!editingRule}
            />
          </Form.Item>

          <Form.Item
            name="label"
            label="显示标签"
            rules={[{ required: true, message: '请输入显示标签' }]}
          >
            <Input placeholder="e.g. 部门负责人审批" />
          </Form.Item>

          <Form.Item
            name="strategy"
            label="解析策略"
            rules={[{ required: true, message: '请选择解析策略' }]}
          >
            <Select
              placeholder="选择策略"
              options={STRATEGY_OPTIONS}
              onChange={() => {
                form.setFieldsValue({ deptId: undefined, title: undefined });
              }}
            />
          </Form.Item>

          {strategy === NEEDS_DEPT_ID && (
            <Form.Item
              name="deptId"
              label="部门ID (deptId)"
              rules={[{ required: true, message: '请输入部门ID' }]}
            >
              <Input placeholder="指定部门的 ID" />
            </Form.Item>
          )}

          {strategy === NEEDS_TITLE && (
            <Form.Item
              name="title"
              label="职称 (title)"
              rules={[{ required: true, message: '请输入职称' }]}
            >
              <Input placeholder="e.g. 经理" />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
