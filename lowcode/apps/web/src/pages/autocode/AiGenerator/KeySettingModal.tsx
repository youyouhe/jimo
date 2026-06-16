import { useEffect, useState } from 'react';
import { Modal, Input, Form, Button, message } from 'antd';
import { ApiOutlined } from '@ant-design/icons';
import { testAiConfig } from '../../../services/autocode';
import type { AiConfig } from './types';
import { loadAiConfig, saveAiConfig } from './key-config';

export function KeySettingModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<AiConfig>();
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (open) {
      const c = loadAiConfig();
      form.setFieldsValue(
        c || { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', apiKey: '' },
      );
    }
  }, [open, form]);

  const handleTest = async () => {
    try {
      const v = await form.validateFields();
      setTesting(true);
      const r = await testAiConfig(v);
      if (r.ok) message.success(r.message);
      else message.error(r.message);
    } catch (e: any) {
      if (e?.errorFields) return; // 表单校验失败,antd 已提示
      message.error(e?.message || '测试请求失败');
    } finally {
      setTesting(false);
    }
  };

  const handleOk = async () => {
    const v = await form.validateFields();
    saveAiConfig(v);
    message.success('AI 配置已保存(仅当前浏览器会话)');
    onClose();
  };

  return (
    <Modal
      title="配置 AI(OpenAI 兼容)"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      okText="保存"
      cancelText="取消"
      footer={[
        <Button key="test" icon={<ApiOutlined />} loading={testing} onClick={handleTest}>
          测试连接
        </Button>,
        <Button key="cancel" onClick={onClose}>
          取消
        </Button>,
        <Button key="ok" type="primary" onClick={handleOk}>
          保存
        </Button>,
      ]}
    >
      <Form form={form} layout="vertical">
        <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item name="apiKey" label="API Key" rules={[{ required: true }]}>
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Form.Item name="model" label="Model" rules={[{ required: true }]}>
          <Input placeholder="gpt-4o-mini" />
        </Form.Item>
      </Form>
      <div style={{ color: '#8c8c8c', fontSize: 12, lineHeight: 1.6 }}>
        Key 仅存于浏览器 sessionStorage,刷新/换会话需重填,后端不落盘。
        支持任何 OpenAI 兼容服务:OpenAI 官方、Claude via proxy、智谱 GLM、DeepSeek、通义、本地 Ollama 等。
        「测试连接」会用当前填写的配置发一个极简请求验证可达性。
      </div>
    </Modal>
  );
}
