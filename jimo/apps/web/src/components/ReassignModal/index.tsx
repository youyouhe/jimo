import React, { useEffect, useState } from 'react';
import { Modal, Form, Select, message } from 'antd';
import { getUsers, type User } from '@/services/user';
import { reassignRecords } from '@/services/ownership';

export interface ReassignModalProps {
  open: boolean;
  /** business_type = table name without the lc_ prefix (e.g. "reimbursements"). */
  businessType: string;
  ids: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Reusable "移交给" modal. Pick a target user and batch-reassign the given ids.
 * Shared across all generated business pages — not table-specific.
 */
export default function ReassignModal({ open, businessType, ids, onClose, onSuccess }: ReassignModalProps) {
  const [form] = Form.useForm<{ newOwnerId: string }>();
  const [options, setOptions] = useState<{ label: string; value: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    getUsers({ page: 1, pageSize: 100 })
      .then((res) => {
        setOptions(
          (res.list ?? []).map((u: User) => ({
            label: `${u.nickname || u.username}（${u.username}）`,
            value: u.id,
          })),
        );
      })
      .catch(() => setOptions([]));
  }, [open, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const result = await reassignRecords(businessType, ids, values.newOwnerId);
      const target = options.find((o) => o.value === values.newOwnerId);
      const targetName = target?.label ?? values.newOwnerId;
      if (result.skipped > 0) {
        message.warning(
          `已移交 ${result.reassigned} 条给「${targetName}」；${result.skipped} 条无权限（非本人所有且已有归属）已跳过`,
        );
      } else {
        message.success(`已移交 ${result.reassigned} 条给「${targetName}」`);
      }
      onClose();
      onSuccess?.();
    } catch (err: any) {
      // antd form validation rejection carries errorFields — keep modal open
      if (err?.errorFields) return;
      message.error(err?.message || '移交失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="移交给"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="移交"
      cancelText="取消"
      destroyOnClose
    >
      <p style={{ marginBottom: 12 }}>
        将选中的 <b>{ids.length}</b> 条记录移交给：
        <br />
        <span style={{ color: '#999', fontSize: 12 }}>
          仅可移交你拥有的记录，或无主（owner 为空）的记录。
        </span>
      </p>
      <Form form={form} layout="vertical">
        <Form.Item
          name="newOwnerId"
          label="接收人"
          rules={[{ required: true, message: '请选择接收人' }]}
        >
          <Select
            showSearch
            placeholder="搜索用户名 / 昵称"
            optionFilterProp="label"
            options={options}
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
