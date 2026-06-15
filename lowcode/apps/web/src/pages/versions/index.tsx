import { useRef, useState } from 'react';
import { Button, message, Popconfirm, Space, Upload } from 'antd';
import { PlusOutlined, ExportOutlined, ImportOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText, ProFormTextArea } from '@ant-design/pro-components';
import {
  getVersions,
  createVersion,
  updateVersion,
  deleteVersion,
  batchDeleteVersions,
  exportVersion,
  importVersion,
  type Version,
  type CreateVersionDto,
  type UpdateVersionDto,
} from '@/services/version';

export default function VersionsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Version | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);

  const columns: ProColumns<Version>[] = [
    {
      title: 'name',
      dataIndex: 'versionName',
      width: 220,
      ellipsis: true,
    },
    {
      title: 'version',
      dataIndex: 'versionNumber',
      width: 140,
      copyable: true,
    },
    {
      title: 'description',
      dataIndex: 'description',
      width: 280,
      ellipsis: true,
      search: false,
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
      width: 220,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<ExportOutlined />}
            onClick={async () => {
              try {
                const blob = await exportVersion(record.id);
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `version-${record.versionNumber}.json`;
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
                await deleteVersion(record.id);
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
        const dto: UpdateVersionDto = {
          versionName: values.versionName,
          versionNumber: values.versionNumber,
          description: values.description || '',
          data: values.data ? JSON.parse(values.data) : undefined,
        };
        await updateVersion(editingRecord.id, dto);
        message.success('Updated');
      } else {
        const dto: CreateVersionDto = {
          versionName: values.versionName,
          versionNumber: values.versionNumber,
          description: values.description || '',
          data: values.data ? JSON.parse(values.data) : undefined,
        };
        await createVersion(dto);
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
      const result = await batchDeleteVersions(selectedRowKeys);
      message.success(`Deleted ${result.count} version(s)`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Batch delete failed');
    }
  };

  const handleImport = async (file: File) => {
    try {
      const result = await importVersion(file);
      message.success(`Version imported: ${result.versionName} (${result.versionNumber})`);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Import failed');
    }
    return false;
  };

  return (
    <>
      <ProTable<Version>
        headerTitle="Version Management"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize, versionName, versionNumber } = params;
          const result = await getVersions({ page, pageSize, versionName, versionNumber });
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
            New Version
          </Button>,
          <Upload
            key="import"
            accept=".json"
            showUploadList={false}
            beforeUpload={handleImport}
          >
            <Button icon={<ImportOutlined />}>Import</Button>
          </Upload>,
          selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="Confirm batch deletion?"
              description={`Selected ${selectedRowKeys.length} version(s)`}
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
        title={editingRecord ? 'Edit Version' : 'New Version'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) setEditingRecord(null);
        }}
        initialValues={
          editingRecord
            ? {
                versionName: editingRecord.versionName,
                versionNumber: editingRecord.versionNumber,
                description: editingRecord.description || '',
                data: editingRecord.data ? JSON.stringify(editingRecord.data, null, 2) : '',
              }
            : {}
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true, width: 560 }}
      >
        <ProFormText
          name="versionName"
          label="Version Name"
          placeholder="e.g. System Snapshot v1.0"
          rules={[{ required: true, message: 'Please enter version name' }]}
        />
        <ProFormText
          name="versionNumber"
          label="Version Number"
          placeholder="e.g. 1.0.0"
          rules={[{ required: true, message: 'Please enter version number' }]}
        />
        <ProFormTextArea
          name="description"
          label="Description"
          placeholder="Optional description"
          fieldProps={{ rows: 2 }}
        />
        <ProFormTextArea
          name="data"
          label="Data (JSON)"
          placeholder='{"config": {}, "roles": []}'
          fieldProps={{ rows: 4 }}
        />
      </ModalForm>
    </>
  );
}
