import { useRef, useState } from 'react';
import { Button, message, Modal, Popconfirm, Space, Tag, Upload, Tooltip } from 'antd';
import type { UploadProps } from 'antd';
import { UploadOutlined, DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormText } from '@ant-design/pro-components';
import {
  getFiles,
  uploadFile,
  updateFile,
  deleteFile,
  type FileInfo,
  type UpdateFileDto,
} from '@/services/file';

const { Dragger } = Upload;

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const size = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2);
  return `${size} ${units[i]}`;
}

function getTagColor(ext: string): string {
  const colors: Record<string, string> = {
    pdf: 'red',
    doc: 'blue',
    docx: 'blue',
    xls: 'green',
    xlsx: 'green',
    ppt: 'orange',
    pptx: 'orange',
    png: 'cyan',
    jpg: 'cyan',
    jpeg: 'cyan',
    gif: 'purple',
    svg: 'purple',
    mp4: 'magenta',
    mp3: 'lime',
    zip: 'gold',
    rar: 'gold',
    tar: 'gold',
    gz: 'gold',
  };
  return colors[ext.toLowerCase()] ?? 'default';
}

export default function FilesPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingFile, setEditingFile] = useState<FileInfo | null>(null);

  const uploadProps: UploadProps = {
    name: 'file',
    multiple: false,
    accept: '*/*',
    showUploadList: false,
    customRequest: async (options: any) => {
      const { file, onSuccess, onError } = options;
      setUploading(true);
      try {
        const result = await uploadFile(file as File);
        onSuccess?.(result, file);
        message.success(`文件 "${file.name}" 上传成功`);
        setUploadModalOpen(false);
        actionRef.current?.reload();
      } catch (err: any) {
        onError?.(err);
        message.error(err.message || '上传失败');
      } finally {
        setUploading(false);
      }
    },
  };

  const handleDownload = (record: FileInfo) => {
    const downloadUrl = `/api/v1/files/download/${record.id}`;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = record.name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEditSubmit = async (values: Record<string, any>) => {
    try {
      if (!editingFile) return false;
      const dto: UpdateFileDto = { name: values.name };
      await updateFile(editingFile.id, dto);
      message.success('文件名更新成功');
      setEditModalOpen(false);
      setEditingFile(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '更新失败');
      return false;
    }
  };

  const columns: ProColumns<FileInfo>[] = [
    {
      title: '文件名',
      dataIndex: 'name',
      ellipsis: true,
      width: 220,
    },
    {
      title: '类型',
      dataIndex: 'tag',
      width: 100,
      render: (_, record) => (
        <Tag color={getTagColor(record.tag)}>{record.tag.toUpperCase()}</Tag>
      ),
    },
    {
      title: '扩展名',
      dataIndex: 'ext',
      width: 80,
      search: false,
      render: (_, record) => <code>.{record.ext}</code>,
    },
    {
      title: '大小',
      dataIndex: 'size',
      width: 100,
      search: false,
      render: (_, record) => formatFileSize(record.size),
    },
    {
      title: 'URL',
      dataIndex: 'url',
      width: 200,
      search: false,
      copyable: true,
      ellipsis: true,
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
      width: 200,
      search: false,
      render: (_, record) => (
        <Space>
          <Tooltip title="下载文件">
            <Button
              type="link"
              size="small"
              icon={<DownloadOutlined />}
              onClick={() => handleDownload(record)}
            >
              下载
            </Button>
          </Tooltip>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingFile(record);
              setEditModalOpen(true);
            }}
          >
            重命名
          </Button>
          <Popconfirm
            title="确认删除该文件？"
            description="删除后将从存储和数据库中移除。"
            onConfirm={async () => {
              try {
                await deleteFile(record.id);
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

  return (
    <>
      <ProTable<FileInfo>
        headerTitle="文件管理"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async (params) => {
          const { current: page, pageSize, keyword, tag } = params;
          const result = await getFiles({ page, pageSize, keyword, tag });
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          <Button
            key="upload"
            type="primary"
            icon={<UploadOutlined />}
            onClick={() => setUploadModalOpen(true)}
          >
            上传文件
          </Button>,
        ]}
      />

      <Modal
        title="上传文件"
        open={uploadModalOpen}
        onCancel={() => setUploadModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Dragger {...uploadProps}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
          <p className="ant-upload-hint">支持所有文件类型，单次上传一个文件</p>
        </Dragger>
      </Modal>

      <ModalForm
        title="重命名文件"
        open={editModalOpen}
        onOpenChange={(open) => {
          setEditModalOpen(open);
          if (!open) {
            setEditingFile(null);
          }
        }}
        initialValues={
          editingFile
            ? { name: editingFile.name }
            : {}
        }
        onFinish={handleEditSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="name"
          label="文件名"
          placeholder="输入新的文件名"
          rules={[
            { required: true, message: '请输入文件名' },
            { max: 255, message: '文件名不能超过255个字符' },
          ]}
        />
      </ModalForm>
    </>
  );
}
