import { useRef, useState, useEffect } from 'react';
import { Button, message, Popconfirm, Space, Tag } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormSelect,
  ProFormDigit,
} from '@ant-design/pro-components';
import { useUserStore } from '@/stores/user';
import {
  getEncodingRulesList,
  createEncodingRule,
  updateEncodingRule,
  deleteEncodingRule,
  type EncodingRule,
  type CreateEncodingRuleDto,
} from '@/services/encoding-rule';
import { getMyBtnPerms } from '@/services/authority-btn';

const RESET_CYCLE_MAP: Record<string, { text: string; color: string }> = {
  never: { text: '永不重置', color: 'default' },
  yearly: { text: '按年重置', color: 'blue' },
  monthly: { text: '按月重置', color: 'purple' },
};

const DATE_FORMAT_LABELS: Record<string, string> = {
  '': '无',
  yyyyMMdd: 'yyyyMMdd',
  yyMM: 'yyMM',
  yyyy: 'yyyy',
};

function buildPreview(values: {
  prefix?: string;
  dateFormat?: string;
  separator?: string;
  sequenceDigits?: number;
  paddingChar?: string;
}): string {
  const { prefix, dateFormat, separator = '', sequenceDigits = 4, paddingChar = '0' } = values;
  const parts: string[] = [];

  if (prefix) parts.push(prefix);

  if (dateFormat && dateFormat !== '') {
    const now = new Date();
    const y = String(now.getFullYear());
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    let formatted = '';
    if (dateFormat === 'yyyyMMdd') formatted = `${y}${m}${d}`;
    else if (dateFormat === 'yyMM') formatted = `${y.slice(2)}${m}`;
    else if (dateFormat === 'yyyy') formatted = y;
    if (formatted) parts.push(formatted);
  }

  const digits = typeof sequenceDigits === 'number' ? sequenceDigits : 4;
  const pad = typeof paddingChar === 'string' && paddingChar.length === 1 ? paddingChar : '0';
  const seq = String(1).padStart(digits, pad);
  parts.push(seq);

  return parts.join(separator);
}

export default function EncodingRulesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<EncodingRule | null>(null);
  const [btnPerms, setBtnPerms] = useState<string[]>([]);
  const [preview, setPreview] = useState('');
  const [formValues, setFormValues] = useState<Record<string, any>>({});

  const userRoles = useUserStore((s) => s.userInfo?.roles) ?? [];
  const isPrivileged = userRoles.includes('super_admin') || userRoles.includes('admin');

  useEffect(() => {
    getMyBtnPerms()
      .then((perms) => {
        const entry = perms['./encoding-rules/index'];
        setBtnPerms(entry?.systemBtns ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    setPreview(
      buildPreview({
        prefix: formValues.prefix,
        dateFormat: formValues.dateFormat,
        separator: formValues.separator,
        sequenceDigits: formValues.sequenceDigits,
        paddingChar: formValues.paddingChar,
      }),
    );
  }, [formValues]);

  const canCreate = isPrivileged || btnPerms.includes('create');
  const canEdit = isPrivileged || btnPerms.includes('edit');
  const canDelete = isPrivileged || btnPerms.includes('delete');

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      const dto: CreateEncodingRuleDto = {
        name: values.name,
        prefix: values.prefix || undefined,
        dateFormat: (values.dateFormat === '' ? undefined : values.dateFormat) || undefined,
        separator: values.separator ?? '',
        sequenceDigits: values.sequenceDigits ?? 4,
        paddingChar: values.paddingChar ?? '0',
        resetCycle: values.resetCycle,
      };

      if (editingRule) {
        await updateEncodingRule(editingRule.id, dto);
        message.success('编码规则已更新');
      } else {
        await createEncodingRule(dto);
        message.success('编码规则已创建');
      }

      setModalOpen(false);
      setEditingRule(null);
      setFormValues({});
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleDelete = async (rule: EncodingRule) => {
    try {
      await deleteEncodingRule(rule.id);
      message.success('编码规则已删除');
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '删除失败');
    }
  };

  const columns: ProColumns<EncodingRule>[] = [
    {
      title: '规则名称',
      dataIndex: 'name',
      width: 160,
      ellipsis: true,
    },
    {
      title: '前缀',
      dataIndex: 'prefix',
      width: 100,
      search: false,
      render: (_, record) => record.prefix || <span style={{ color: '#ccc' }}>-</span>,
    },
    {
      title: '日期格式',
      dataIndex: 'dateFormat',
      width: 120,
      search: false,
      render: (_, record) => {
        const fmt = record.dateFormat ?? '';
        return (DATE_FORMAT_LABELS[fmt] ?? fmt) || '-';
      },
    },
    {
      title: '分隔符',
      dataIndex: 'separator',
      width: 80,
      search: false,
      render: (_, record) =>
        record.separator ? (
          <code>{record.separator}</code>
        ) : (
          <span style={{ color: '#ccc' }}>无</span>
        ),
    },
    {
      title: '序号位数',
      dataIndex: 'sequenceDigits',
      width: 90,
      search: false,
    },
    {
      title: '填充字符',
      dataIndex: 'paddingChar',
      width: 80,
      search: false,
      render: (_, record) => <code>{record.paddingChar}</code>,
    },
    {
      title: '重置周期',
      dataIndex: 'resetCycle',
      width: 110,
      search: false,
      render: (_, record) => {
        const info = RESET_CYCLE_MAP[record.resetCycle];
        if (!info) return record.resetCycle;
        return <Tag color={info.color}>{info.text}</Tag>;
      },
    },
    {
      title: '示例编码',
      key: 'preview',
      width: 180,
      search: false,
      render: (_, record) => (
        <code style={{ fontSize: 12 }}>
          {buildPreview({
            prefix: record.prefix ?? undefined,
            dateFormat: record.dateFormat ?? undefined,
            separator: record.separator,
            sequenceDigits: record.sequenceDigits,
            paddingChar: record.paddingChar,
          })}
        </code>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          {canEdit && (
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => {
                setEditingRule(record);
                const initValues = {
                  name: record.name,
                  prefix: record.prefix ?? '',
                  dateFormat: record.dateFormat ?? '',
                  separator: record.separator,
                  sequenceDigits: record.sequenceDigits,
                  paddingChar: record.paddingChar,
                  resetCycle: record.resetCycle,
                };
                setFormValues(initValues);
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          {canDelete && (
            <Popconfirm
              title="确认删除该编码规则?"
              description="删除后不可恢复，已生成的编码不受影响。"
              onConfirm={() => handleDelete(record)}
              okText="确认"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <>
      <ProTable<EncodingRule>
        headerTitle="编码规则管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, name } = params;
          const result = await getEncodingRulesList({ page, pageSize, name });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() =>
          canCreate
            ? [
                <Button
                  key="create"
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => {
                    setEditingRule(null);
                    setFormValues({
                      sequenceDigits: 4,
                      paddingChar: '0',
                      separator: '-',
                      resetCycle: 'never',
                    });
                    setModalOpen(true);
                  }}
                >
                  新建规则
                </Button>,
              ]
            : []
        }
      />

      <ModalForm
        title={editingRule ? '编辑编码规则' : '新建编码规则'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingRule(null);
            setFormValues({});
          }
        }}
        initialValues={
          editingRule
            ? {
                name: editingRule.name,
                prefix: editingRule.prefix ?? '',
                dateFormat: editingRule.dateFormat ?? '',
                separator: editingRule.separator,
                sequenceDigits: editingRule.sequenceDigits,
                paddingChar: editingRule.paddingChar,
                resetCycle: editingRule.resetCycle,
              }
            : {
                sequenceDigits: 4,
                paddingChar: '0',
                separator: '-',
                resetCycle: 'never',
              }
        }
        onFinish={handleSubmit}
        onValuesChange={(_changed, all) => setFormValues(all)}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="name"
          label="规则名称"
          placeholder="如 学号规则、合同编号规则"
          rules={[
            { required: true, message: '请输入规则名称' },
            { max: 100, message: '最多100个字符' },
          ]}
        />
        <ProFormText
          name="prefix"
          label="前缀"
          placeholder="如 STU、CON（可选）"
          fieldProps={{ maxLength: 20 }}
        />
        <ProFormSelect
          name="dateFormat"
          label="日期格式"
          options={[
            { label: '无', value: '' },
            { label: 'yyyyMMdd', value: 'yyyyMMdd' },
            { label: 'yyMM', value: 'yyMM' },
            { label: 'yyyy', value: 'yyyy' },
          ]}
        />
        <ProFormText
          name="separator"
          label="分隔符"
          placeholder="如 -（可选，最多4个字符）"
          fieldProps={{ maxLength: 4 }}
        />
        <ProFormDigit
          name="sequenceDigits"
          label="序号位数"
          min={1}
          max={10}
          fieldProps={{ precision: 0 }}
        />
        <ProFormText
          name="paddingChar"
          label="填充字符"
          placeholder="默认 0"
          fieldProps={{ maxLength: 1 }}
          rules={[{ max: 1, message: '只能输入1个字符' }]}
        />
        <ProFormSelect
          name="resetCycle"
          label="重置周期"
          rules={[{ required: true, message: '请选择重置周期' }]}
          options={[
            { label: '永不重置', value: 'never' },
            { label: '按年重置', value: 'yearly' },
            { label: '按月重置', value: 'monthly' },
          ]}
        />
        <ProFormText
          name="_preview"
          label="编码预览"
          disabled
          fieldProps={{ value: preview, readOnly: true }}
          tooltip="根据当前设置生成的示例编码（序号从1开始）"
        />
      </ModalForm>
    </>
  );
}
