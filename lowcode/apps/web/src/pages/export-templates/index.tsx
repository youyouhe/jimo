import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Tag, Modal, Descriptions, Upload } from 'antd';
import { PlusOutlined, ExportOutlined, ImportOutlined, EyeOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormSelect, ProFormTextArea } from '@ant-design/pro-components';
import {
  getExportTemplates,
  createExportTemplate,
  updateExportTemplate,
  deleteExportTemplate,
  batchDeleteExportTemplates,
  previewSql,
  exportData,
  importData,
  type ExportTemplate,
  type CreateExportTemplateDto,
  type UpdateExportTemplateDto,
} from '@/services/export-template';

const TEMPLATE_TYPE_OPTIONS = [
  { label: 'JSON', value: 'json' },
  { label: 'CSV', value: 'csv' },
];

export default function ExportTemplatesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<ExportTemplate | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [sqlPreview, setSqlPreview] = useState<{ sql: string; tableName: string } | null>(null);
  const [sqlPreviewOpen, setSqlPreviewOpen] = useState(false);

  const columns: ProColumns<ExportTemplate>[] = [
    {
      title: 'name',
      dataIndex: 'name',
      width: 200,
      ellipsis: true,
    },
    {
      title: 'target table',
      dataIndex: 'tableName',
      width: 180,
      copyable: true,
    },
    {
      title: 'type',
      dataIndex: 'templateType',
      width: 100,
      render: (_, record) => (
        <Tag color={record.templateType === 'json' ? 'blue' : 'green'}>
          {record.templateType.toUpperCase()}
        </Tag>
      ),
    },
    {
      title: 'created',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'actions',
      key: 'action',
      width: 300,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EyeOutlined />}
            onClick={async () => {
              try {
                const result = await previewSql(record.id);
                setSqlPreview(result);
                setSqlPreviewOpen(true);
              } catch {
                message.error('Failed to preview SQL');
              }
            }}
          >
            Preview SQL
          </Button>
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined />}
            onClick={async () => {
              try {
                const blob = await exportData(record.id);
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${record.name}-export.json`;
                a.click();
                window.URL.revokeObjectURL(url);
                message.success('Export successful');
              } catch {
                message.error('Export failed');
              }
            }}
          >
            Export
          </Button>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingRecord(record);
              setModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Confirm deletion?"
            onConfirm={async () => {
              try {
                await deleteExportTemplate(record.id);
                message.success('Deleted');
                actionRef.current?.reload();
              } catch (err: any) {
                message.error(err.message || 'Delete failed');
              }
            }}
            okText="Confirm"
            cancelText="Cancel"
          >
            <Button type="link" size="small" danger>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingRecord) {
        const dto: UpdateExportTemplateDto = {
          name: values.name,
          tableName: values.tableName,
          templateType: values.templateType,
          config: values.config ? JSON.parse(values.config) : undefined,
        };
        await updateExportTemplate(editingRecord.id, dto);
        message.success('Updated');
      } else {
        const dto: CreateExportTemplateDto = {
          name: values.name,
          tableName: values.tableName,
          templateType: values.templateType,
          config: values.config ? JSON.parse(values.config) : undefined,
        };
        await createExportTemplate(dto);
        message.success('Created');
      }
      setModalOpen(false);
      setEditingRecord(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeleteExportTemplates(selectedRowKeys);
      message.success(`Deleted ${result.count} templates`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Batch delete failed');
    }
  };

  const handleImport = async (file: File) => {
    try {
      const result = await importData(file);
      message.success(`Imported ${result.imported} record(s) into ${result.tableName}`);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Import failed');
    }
    return false;
  };

  return (
    <>
      <ProTable<ExportTemplate>
        headerTitle="Export Templates"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize, name, tableName } = params;
          const result = await getExportTemplates({ page, pageSize, name, tableName });
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
              setEditingRecord(null);
              setModalOpen(true);
            }}
          >
            New Template
          </Button>,
          <Upload
            key="import"
            accept=".json,.csv"
            showUploadList={false}
            beforeUpload={handleImport}
          >
            <Button icon={<ImportOutlined />}>Import</Button>
          </Upload>,
          selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="Confirm batch deletion?"
              description={`Selected ${selectedRowKeys.length} template(s)`}
              onConfirm={handleBatchDelete}
              okText="Confirm"
              cancelText="Cancel"
            >
              <Button danger>
                Batch Delete ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ]}
      />

      <ModalForm
        title={editingRecord ? 'Edit Template' : 'New Template'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingRecord(null);
        }}
        initialValues={
          editingRecord
            ? {
                name: editingRecord.name,
                tableName: editingRecord.tableName,
                templateType: editingRecord.templateType,
                config: editingRecord.config ? JSON.stringify(editingRecord.config, null, 2) : '',
              }
            : { templateType: 'json' }
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true, width: 560 }}
      >
        <ProFormText
          name="name"
          label="Template Name"
          placeholder="e.g. User Export"
          rules={[{ required: true, message: 'Please enter template name' }]}
        />
        <ProFormText
          name="tableName"
          label="Target Table"
          placeholder="e.g. sys_users"
          rules={[{ required: true, message: 'Please enter target table name' }]}
        />
        <ProFormSelect
          name="templateType"
          label="Format"
          options={TEMPLATE_TYPE_OPTIONS}
          rules={[{ required: true, message: 'Please select format' }]}
        />
        <ProFormTextArea
          name="config"
          label="Config (JSON)"
          placeholder='{"columns": ["username", "nickname"]}'
          fieldProps={{ rows: 4 }}
        />
      </ModalForm>

      <Modal
        title="SQL Preview"
        open={sqlPreviewOpen}
        onCancel={() => setSqlPreviewOpen(false)}
        footer={null}
        width={700}
      >
        {sqlPreview && (
          <>
            <Descriptions column={1} size="small" style={{ marginBottom: 12 }}>
              <Descriptions.Item label="Target Table">{sqlPreview.tableName}</Descriptions.Item>
            </Descriptions>
            <pre
              style={{
                background: '#f5f5f5',
                padding: 12,
                borderRadius: 6,
                fontSize: 13,
                overflowX: 'auto',
              }}
            >
              {sqlPreview.sql}
            </pre>
          </>
        )}
      </Modal>
    </>
  );
}
