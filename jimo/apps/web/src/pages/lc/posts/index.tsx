import React, { useRef, useState, useEffect, useCallback } from 'react';
import dayjs from 'dayjs';
import { Button, message, Popconfirm, Space, Form, Table, Input, Upload, Tooltip, Image } from 'antd';
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormDigit,
  ProFormSwitch,
  ProFormDateTimePicker,
} from '@ant-design/pro-components';
import {
  getPostsList,
  createPost,
  updatePost,
  deletePost,
  batchDeletePosts,
  type Post,
  type CreatePostDto,
  type UpdatePostDto,
} from '@/services/post';
import { getMyBtnPerms } from '@/services/authority-btn';
import { uploadFile } from '@/services/file';


export default function PostsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<Post | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([]);
  const [form] = Form.useForm();
  const [searchTitle, setSearchTitle] = useState('');
  const [searchPublishedAt, setSearchPublishedAt] = useState('');
  const [searchStatus, setSearchStatus] = useState('');
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeDebounce = useCallback((setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => { setter(val); }, 400);
  }, []);

  // ── Button-level permission check ──
  // Fetch directly from sys_authority_btns on every page visit.
  // This is the single source of truth — same data the backend Guard checks.
  const [btnPerms, setBtnPerms] = useState<Set<string>>(new Set());
  useEffect(() => {
    getMyBtnPerms().then((perms) => {
      setBtnPerms(new Set(perms['./posts/index'] ?? []));
    }).catch(() => setBtnPerms(new Set()));
  }, []);

  const columns: ProColumns<Post>[] = [
    {
      title: '文章标题',
      dataIndex: 'title',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.title ?? '').localeCompare(String(b.title ?? '')),
    },
    {
      title: '文章摘要',
      dataIndex: 'summary',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.summary ?? '').localeCompare(String(b.summary ?? '')),
    },
    {
      title: '封面图片',
      dataIndex: 'cover_image',
      valueType: 'image',
      width: 120,
      search: false,
      render: (_, record) => record.cover_image
        ? <Image src={record.cover_image} width={60} height={60} style={{ objectFit: 'cover', borderRadius: 4 }} preview={{ mask: '预览' }} fallback={'data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='60' height='60'><rect width='60' height='60' fill='#f0f0f0'/><text x='30' y='35' font-size='11' fill='#bbb' text-anchor='middle'>IMG</text></svg>")} />
        : '-',
    },
    {
      title: '发布时间',
      dataIndex: 'published_at',
      valueType: 'dateTime',
      width: 180,
      sorter: (a, b) => new Date(a.published_at as string).getTime() - new Date(b.published_at as string).getTime(),
    },
    {
      title: '状态（草稿/已发布）',
      dataIndex: 'status',
      valueType: 'text',
      width: 180,
      sorter: (a, b) => String(a.status ?? '').localeCompare(String(b.status ?? '')),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      defaultSortOrder: 'descend',
    },
    {
      title: '创建人',
      dataIndex: 'createdBy',
      valueType: 'text',
      width: 120,
      search: false,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          {btnPerms.has('edit') && (
            <Button
              type="link"
              size="small"
              onClick={() => {
                form.resetFields();
                form.setFieldsValue({
                  title: record.title,
                  content: record.content,
                  summary: record.summary,
                  cover_image: record.cover_image ? [{ uid: '-1', name: 'file', url: record.cover_image, status: 'done' }] : [],
                  published_at: record.published_at ? dayjs(record.published_at) : null,
                  status: record.status,
                });
                setEditingRecord(record);
                
                setModalOpen(true);
              }}
            >
              编辑
            </Button>
          )}
          {btnPerms.has('delete') && (
            <Popconfirm
              title="确认删除？"
              description="删除后无法恢复。"
              onConfirm={async () => {
                try {
                  await deletePost(record.id);
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
          )}
        </Space>
      ),
    },
  ];

  const handleSubmit = async (values: Record<string, any>) => {
    try {
      if (editingRecord) {
        const dto: UpdatePostDto = {
          title: values.title || '',
          content: values.content || '',
          summary: values.summary || '',
          cover_image: (() => {
            const v = values.cover_image;
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),
          published_at: values.published_at && typeof values.published_at === 'object' ? values.published_at.toISOString() : values.published_at || undefined,
          status: values.status || '',
        };
        await updatePost(editingRecord.id, dto);
        message.success('更新成功');
      } else {
        const dto: CreatePostDto = {
          title: values.title || '',
          content: values.content || '',
          summary: values.summary || '',
          cover_image: (() => {
            const v = values.cover_image;
            if (typeof v === 'string') return v;
            if (Array.isArray(v) && v.length > 0) {
              const item = v[0];
              return item?.response?.url || item?.url || '';
            }
            return '';
          })(),
          published_at: values.published_at && typeof values.published_at === 'object' ? values.published_at.toISOString() : values.published_at || undefined,
          status: values.status || '',
        };
        await createPost(dto);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditingRecord(null);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || '操作失败');
      return false;
    }
  };

  const handleBatchDelete = async () => {
    try {
      const result = await batchDeletePosts(selectedRowKeys);
      message.success(`成功删除 ${result.count} 条记录`);
      setSelectedRowKeys([]);
      actionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || '批量删除失败');
    }
  };

  return (
    <>
      <ProTable<Post>
        headerTitle={<Tooltip title="存储博客发布的文章内容"><span>博客文章</span></Tooltip>}
        actionRef={actionRef}
        rowKey="id"
        columns={columns}

        search={false}
        params={{ searchTitle, searchPublishedAt, searchStatus }}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys as string[]),
        }}
        request={async (params) => {
          const { current: page, pageSize } = params;
          const result = await getPostsList({ page, pageSize, title: searchTitle || undefined, published_at: searchPublishedAt || undefined, status: searchStatus || undefined });
          
          return {
            data: result.list,
            total: result.total,
            success: true,
          };
        }}
        toolBarRender={() => [
          
          <Space key="filters" wrap size={8}>
          <Input
            key="search-title"
            placeholder="搜索文章标题"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchTitle)}
            onClear={() => setSearchTitle('')}
          />,
          <Input
            key="search-published_at"
            placeholder="搜索发布时间"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchPublishedAt)}
            onClear={() => setSearchPublishedAt('')}
          />,
          <Input
            key="search-status"
            placeholder="搜索状态（草稿/已发布）"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 180 }}
            onChange={makeDebounce(setSearchStatus)}
            onClear={() => setSearchStatus('')}
          />,
          </Space>,
          btnPerms.has('add') && (
            <Button
              key="create"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                form.resetFields();
                setEditingRecord(null);
                
                setModalOpen(true);
              }}
            >
              新建
            </Button>
          ),
          btnPerms.has('batchDelete') && selectedRowKeys.length > 0 && (
            <Popconfirm
              key="batch-delete"
              title="确认批量删除？"
              description={`已选择 ${selectedRowKeys.length} 条记录，删除后无法恢复。`}
              onConfirm={handleBatchDelete}
              okText="确认"
              cancelText="取消"
            >
              <Button danger>
                批量删除 ({selectedRowKeys.length})
              </Button>
            </Popconfirm>
          ),
        ].filter(Boolean)}
      />

      <ModalForm
        title={editingRecord ? '编辑' : '新建'}
        open={modalOpen}
        form={form}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setTimeout(() => setEditingRecord(null), 300);
          }
        }}
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
          <ProFormText
            name="title"
            label="文章标题"
            placeholder="文章标题"
            rules={[{ required: true, message: '请输入文章标题' }]}
            disabled={!!editingRecord}
          />

          <ProFormTextArea
            name="content"
            label="文章正文"
            placeholder="文章正文"
            rules={[{ required: true, message: '请输入文章正文' }]}
            fieldProps={{ rows: 3 }}
          />

          <ProFormTextArea
            name="summary"
            label="文章摘要"
            placeholder="文章摘要"
            
            fieldProps={{ rows: 3 }}
          />

          <Form.Item
            name="cover_image"
            label="封面图片"
            
            getValueFromEvent={(e) => {
              if (Array.isArray(e)) return e;
              return e?.fileList;
            }}
          >
            <Upload
              listType="picture-card"
              accept="image/*"
              maxCount={1}
              customRequest={async ({ file, onSuccess, onError }) => {
                try {
                  const result = await uploadFile(file as File);
                  onSuccess(result);
                } catch (err) {
                  onError(err);
                }
              }}
            >
              <div><PlusOutlined /> Upload</div>
            </Upload>
          </Form.Item>

          <ProFormDateTimePicker
            name="published_at"
            label="发布时间"
            placeholder="发布时间"
            
            
          />

          <ProFormText
            name="status"
            label="状态（草稿/已发布）"
            placeholder="状态（草稿/已发布）"
            rules={[{ required: true, message: '请输入状态（草稿/已发布）' }]}
            
          />
      </ModalForm>
    </>
  );
}
