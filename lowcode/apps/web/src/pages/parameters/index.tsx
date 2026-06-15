import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  getParameters,
  createParameter,
  updateParameter,
  deleteParameter,
  batchDeleteParameters,
  type Param,
  type CreateParamDto,
  type UpdateParamDto,
} from '@/services/parameter';

const { Text } = Typography;

export default function ParametersPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingParam, setEditingParam] = useState<Param | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const columns: ProColumns<Param>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
    },
    {
      title: '键名',
      dataIndex: 'key',
      width: 200,
      copyable: true,
    },
    {
      title: '值',
      dataIndex: 'value',
      ellipsis: true,
      width: 240,
      render: (_, record) => (
        <Text
          ellipsis={{ tooltip: record.value }}
          style={{ maxWidth: 200 }}
        >
          {record.value}
        </Text>
      ),
    },
    {
      title: '描述',
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
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingParam(record);
              setModalOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除该参数？"
            description="删除后无法恢复。"
            onConfirm={async () => {
              try {
                await deleteParameter(record.id);
                message.success('删除成功');
                actionRef.current?.reload();
              } catch (err: any) {
                message.error(err.message || '删除失败');
              }
            }}
            okText="确认"
            cancelText="取消"
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingParam) {
        const dto: UpdateParamDto = {
          name: values.name,
          key: values.key,
          value: values.value,
          desc: values.desc || '',
        };
        await updateParameter(editingParam.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreateParamDto = {
          name: values.name,
          key: values.key,
          value: values.value,
          desc: values.desc || '',
        };
        await createParameter(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingParam(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteParameters(selectedRowKeys);
      message.success(`成功删除 ${result.count} 个参数`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Param>
        headerTitle="参数管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize, name, key } = params;
          const result = await getParameters({ page, pageSize, name, key });
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
              setEditingParam(null);
              setModalOpen(true);
            }}
          >
            新建参数
          </Button>,
          selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="确认批量删除？"
              description={`已选择 ${selectedRowKeys.length} 个参数，删除后无法恢复。`}
              onConfirm={handleBatchDelete}
              okText="确认"
              cancelText="取消"
            >
              <Button danger>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ]}
      />

      <ModalForm
        title={editingParam ? '编辑参数' : '新建参数'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingParam(null);
          }
        }}
        initialValues={
          editingParam
            ? {
                name: editingParam.name,
                key: editingParam.key,
                value: editingParam.value,
                desc: editingParam.desc,
              }
            : {}
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="name"
          label="名称"
          placeholder="例如: 站点名称"
          rules={[{ required: true, message: '请输入参数名称' }]}
        />
        <ProFormText
          name="key"
          label="键名"
          placeholder="例如: site.name"
          rules={[
            { required: true, message: '请输入参数键名' },
            { pattern: /^[a-z0-9_.]+$/, message: '仅支持小写字母、数字、下划线和点号' },
          ]}
          disabled={!!editingParam}
          extra={editingParam ? '键名创建后不可修改' : '使用小写字母、数字、下划线或点号'}
        />
        <ProFormText
          name="value"
          label="值"
          placeholder="例如: My Platform"
          rules={[{ required: true, message: '请输入参数值' }]}
        />
        <ProFormTextArea
          name="desc"
          label="描述"
          placeholder="参数说明（可选）"
          fieldProps={{ rows: 3 }}
        />
      </ModalForm>
    </>
  );
}
