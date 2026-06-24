import React, { useEffect, useState } from 'react';
import { Modal, Form, Select, message } from 'antd';
import { getUsers, type User } from '@/services/user';
import { shareRecords } from '@/services/ownership';

export interface ShareModalProps {
  open: boolean;
  /** business_type = table name without the lc_ prefix (e.g. "notices"). */
  businessType: string;
  /** Record ids to share (batch, owner-only). */
  ids: string[];
  onClose: () => void;
  onSuccess?: () => void;
}

/**
 * Reusable "共享给" modal. Pick target users for the selected records (batch).
 * Replaces each row's shared_with (owner-only; non-owner records skipped).
 * Only meaningful under the 'shared' visibility strategy.
 * Shared across all generated business pages.
 */
export default function ShareModal({ open, businessType, ids = [], onClose, onSuccess }: ShareModalProps) {
  const [form] = Form.useForm<{ userIds: string[] }>();
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
      const result = await shareRecords(businessType, ids, values.userIds ?? []);
      if (result.skipped > 0) {
        message.warning(
          `已共享 ${result.shared} 条；${result.skipped} 条无权限（非本人所有）已跳过`,
        );
      } else {
        message.success(`已共享 ${result.shared} 条`);
      }
      onClose();
      onSuccess?.();
    } catch (err: any) {
      // antd form validation rejection carries errorFields — keep modal open
      if (err?.errorFields) return;
      message.error(err?.message || '共享失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title="共享给"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={submitting}
      okText="共享"
      cancelText="取消"
      destroyOnClose
    >
      <p style={{ marginBottom: 12 }}>
        将选中的 <b>{ids.length}</b> 条记录共享给（替换各自的共享列表）:
        <br />
        <span style={{ color: '#999', fontSize: 12 }}>
          仅 shared 策略生效;仅记录 owner 可操作,非 owner 的记录会跳过。
        </span>
      </p>
      <Form form={form} layout="vertical">
        <Form.Item name="userIds" label="可见用户">
          <Select
            mode="multiple"
            showSearch
            allowClear
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
