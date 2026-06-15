import { useRef, useState, useEffect } from 'react';
import {
  Button,
  message,
  Popconfirm,
  Space,
  Tag,
  Tree,
  Upload,
  Card,
  Row,
  Col,
} from 'antd';
import type { TreeProps, UploadProps } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  ExportOutlined,
  FolderOutlined,
} from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import {
  ModalForm,
  ProFormText,
  ProFormTextArea,
  ProFormSelect,
  ProFormDigit,
  ProFormTreeSelect,
} from '@ant-design/pro-components';
import {
  getDictionaries,
  getDictTree,
  getDict,
  createDict,
  updateDict,
  deleteDict,
  importDict,
  exportDict,
  downloadDict,
  getDetails,
  createDetail,
  updateDetail,
  deleteDetail,
  type Dictionary,
  type DictTreeNode,
  type DictionaryDetail,
  type CreateDictDto,
  type UpdateDictDto,
  type CreateDetailDto,
  type UpdateDetailDto,
} from '@/services/dictionary';

/** Convert DataNode[] from Ant Tree to our tree format */
interface TreeNodeData {
  key: string;
  title: string;
  icon: React.ReactNode;
  children?: TreeNodeData[];
  isLeaf?: boolean;
  data: DictTreeNode;
}

function convertTreeData(nodes: DictTreeNode[]): TreeNodeData[] {
  return nodes.map((node) => ({
    key: node.id,
    title: node.name,
    icon: <FolderOutlined />,
    children: node.children && node.children.length > 0 ? convertTreeData(node.children) : undefined,
    isLeaf: !node.children || node.children.length === 0,
    data: node,
  }));
}

export default function DictionaryPage() {
  const detailActionRef = useRef<ActionType>(undefined);
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [selectedDict, setSelectedDict] = useState<Dictionary | null>(null);
  const [dictModalOpen, setDictModalOpen] = useState(false);
  const [editingDict, setEditingDict] = useState<Dictionary | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [editingDetail, setEditingDetail] = useState<DictionaryDetail | null>(null);

  // Load tree data
  const loadTree = async () => {
    try {
      const data = await getDictTree();
      setTreeData(convertTreeData(data));
    } catch (err: any) {
      message.error(err.message || 'Failed to load dictionary tree');
    }
  };

  useEffect(() => {
    loadTree();
  }, []);

  // Tree node select handler
  const handleTreeSelect: TreeProps['onSelect'] = async (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const node = info.node as unknown as TreeNodeData;
      if (node.data) {
        setSelectedDict(node.data);
        detailActionRef.current?.reload();
      }
    }
  };

  // ── Dictionary CRUD handlers ───────────────────────────────

  const handleDictSubmit = async (values: Record<string, any>) => {
    try {
      if (editingDict) {
        const dto: UpdateDictDto = {
          name: values.name,
          type: values.type,
          status: values.status,
          desc: values.desc,
          parent_id: values.parent_id || null,
          sort: values.sort,
        };
        await updateDict(editingDict.id, dto);
        message.success('Dictionary updated');
      } else {
        const dto: CreateDictDto = {
          name: values.name,
          type: values.type,
          status: values.status ?? 1,
          desc: values.desc,
          parent_id: values.parent_id || null,
          sort: values.sort ?? 0,
        };
        await createDict(dto);
        message.success('Dictionary created');
      }
      setDictModalOpen(false);
      setEditingDict(null);
      loadTree();
      detailActionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  const handleDeleteDict = async (dict: Dictionary) => {
    try {
      await deleteDict(dict.id);
      message.success('Dictionary deleted');
      if (selectedDict?.id === dict.id) {
        setSelectedDict(null);
      }
      loadTree();
    } catch (err: any) {
      message.error(err.message || 'Delete failed');
    }
  };

  // ── Detail CRUD handlers ───────────────────────────────────

  const handleDetailSubmit = async (values: Record<string, any>) => {
    try {
      if (editingDetail) {
        const dto: UpdateDetailDto = {
          label: values.label,
          value: values.value,
          status: values.status,
          sort: values.sort,
          parent_id: values.parent_id || null,
        };
        await updateDetail(editingDetail.id, dto);
        message.success('Detail updated');
      } else {
        if (!selectedDict) {
          message.warning('Please select a dictionary first');
          return false;
        }
        const dto: CreateDetailDto = {
          dict_id: selectedDict.id,
          label: values.label,
          value: values.value,
          status: values.status ?? 1,
          sort: values.sort ?? 0,
          parent_id: values.parent_id || null,
        };
        await createDetail(dto);
        message.success('Detail created');
      }
      setDetailModalOpen(false);
      setEditingDetail(null);
      detailActionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  const handleDeleteDetail = async (detail: DictionaryDetail) => {
    try {
      await deleteDetail(detail.id);
      message.success('Detail deleted');
      detailActionRef.current?.reload();
    } catch (err: any) {
      message.error(err.message || 'Delete failed');
    }
  };

  // ── Import / Export handlers ────────────────────────────────

  const uploadProps: UploadProps = {
    name: 'file',
    accept: '.json',
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        await importDict(json);
        message.success('Dictionary imported successfully');
        loadTree();
      } catch (err: any) {
        message.error(err.message || 'Import failed');
      }
      return false;
    },
  };

  const handleExport = async () => {
    if (!selectedDict) {
      message.warning('Please select a dictionary to export');
      return;
    }
    downloadDict(selectedDict.id, selectedDict.type);
  };

  // ── ProTable columns for details ───────────────────────────

  const detailColumns: ProColumns<DictionaryDetail>[] = [
    {
      title: 'Label',
      dataIndex: 'label',
      width: 160,
      ellipsis: true,
    },
    {
      title: 'Value',
      dataIndex: 'value',
      width: 140,
      copyable: true,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      width: 80,
      search: false,
      render: (_, record) =>
        record.status === 1 ? (
          <Tag color="green">Active</Tag>
        ) : (
          <Tag color="red">Disabled</Tag>
        ),
    },
    {
      title: 'Sort',
      dataIndex: 'sort',
      width: 80,
      search: false,
    },
    {
      title: 'Parent ID',
      dataIndex: 'parentId',
      width: 160,
      search: false,
      ellipsis: true,
      render: (_, record) => record.parentId || '-',
    },
    {
      title: 'Created At',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'Actions',
      key: 'action',
      width: 140,
      search: false,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingDetail(record);
              setDetailModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this detail?"
            description="Children will also be deleted."
            onConfirm={() => handleDeleteDetail(record)}
            okText="Yes"
            cancelText="No"
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // ── Render ──────────────────────────────────────────────────

  return (
    <Row gutter={16} style={{ height: 'calc(100vh - 140px)' }}>
      {/* Left panel: Dictionary Tree */}
      <Col span={6}>
        <Card
          title="Dictionaries"
          size="small"
          extra={
            <Space size={4}>
              <Upload {...uploadProps}>
                <Button size="small" icon={<ImportOutlined />} type="text" title="Import JSON" />
              </Upload>
              <Button
                size="small"
                icon={<ExportOutlined />}
                type="text"
                title="Export selected"
                onClick={handleExport}
              />
              <Button
                size="small"
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => {
                  setEditingDict(null);
                  setDictModalOpen(true);
                }}
              />
            </Space>
          }
          bodyStyle={{ padding: 8, overflow: 'auto', maxHeight: 'calc(100vh - 240px)' }}
        >
          {treeData.length > 0 ? (
            <Tree
              treeData={treeData}
              onSelect={handleTreeSelect}
              showIcon
              blockNode
              defaultExpandAll
            />
          ) : (
            <div style={{ textAlign: 'center', padding: 20, color: '#999' }}>
              No dictionaries yet. Click + to create one.
            </div>
          )}
        </Card>
      </Col>

      {/* Right panel: Detail ProTable */}
      <Col span={18}>
        <ProTable<DictionaryDetail>
          headerTitle={
            selectedDict
              ? `Details: ${selectedDict.name} (${selectedDict.type})`
              : 'Dictionary Details'
          }
          actionRef={detailActionRef}
          rowKey="id"
          columns={detailColumns}
          params={{ selectedDictId: selectedDict?.id }}
          request={async (params) => {
            if (!selectedDict) {
              return { data: [], total: 0, success: true };
            }
            const { current: page, pageSize, label } = params;
            const result = await getDetails({
              page,
              pageSize,
              dict_id: selectedDict.id,
              label,
            });
            return {
              data: result.list,
              total: result.total,
              success: true,
            };
          }}
          toolBarRender={() => [
            <Button
              key="create-detail"
              type="primary"
              icon={<PlusOutlined />}
              disabled={!selectedDict}
              onClick={() => {
                setEditingDetail(null);
                setDetailModalOpen(true);
              }}
            >
              New Detail
            </Button>,
          ]}
        />
      </Col>

      {/* ── Dictionary ModalForm ──────────────────────────────── */}
      <ModalForm
        title={editingDict ? 'Edit Dictionary' : 'New Dictionary'}
        open={dictModalOpen}
        onOpenChange={(open) => {
          setDictModalOpen(open);
          if (!open) setEditingDict(null);
        }}
        initialValues={
          editingDict
            ? {
                name: editingDict.name,
                type: editingDict.type,
                status: editingDict.status,
                desc: editingDict.desc,
                parent_id: editingDict.parentId,
                sort: editingDict.sort,
              }
            : { status: 1, sort: 0 }
        }
        onFinish={handleDictSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="name"
          label="Name"
          placeholder="e.g. Gender"
          rules={[
            { required: true, message: 'Please enter dictionary name' },
            { max: 128, message: 'Max 128 characters' },
          ]}
        />
        <ProFormText
          name="type"
          label="Type"
          placeholder="e.g. gender"
          disabled={!!editingDict}
          rules={[
            { required: true, message: 'Please enter dictionary type' },
            { max: 128, message: 'Max 128 characters' },
            { pattern: /^[a-z_]+$/, message: 'Only lowercase letters and underscores' },
          ]}
          fieldProps={{
            onInput: (e: any) => {
              e.target.value = e.target.value.replace(/[^a-z_]/g, '');
            },
          }}
        />
        <ProFormSelect
          name="status"
          label="Status"
          options={[
            { label: 'Active', value: 1 },
            { label: 'Disabled', value: 2 },
          ]}
        />
        <ProFormTextArea
          name="desc"
          label="Description"
          placeholder="Optional description"
          fieldProps={{ rows: 3, maxLength: 256 }}
        />
        <ProFormDigit name="sort" label="Sort Order" min={0} max={32767} />
      </ModalForm>

      {/* ── Detail ModalForm ──────────────────────────────────── */}
      <ModalForm
        title={editingDetail ? 'Edit Detail' : 'New Detail'}
        open={detailModalOpen}
        onOpenChange={(open) => {
          setDetailModalOpen(open);
          if (!open) setEditingDetail(null);
        }}
        initialValues={
          editingDetail
            ? {
                label: editingDetail.label,
                value: editingDetail.value,
                status: editingDetail.status,
                sort: editingDetail.sort,
                parent_id: editingDetail.parentId,
              }
            : { status: 1, sort: 0 }
        }
        onFinish={handleDetailSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="label"
          label="Label"
          placeholder="e.g. Male"
          rules={[
            { required: true, message: 'Please enter label' },
            { max: 128, message: 'Max 128 characters' },
          ]}
        />
        <ProFormText
          name="value"
          label="Value"
          placeholder="e.g. male"
          rules={[
            { required: true, message: 'Please enter value' },
            { max: 128, message: 'Max 128 characters' },
          ]}
        />
        <ProFormSelect
          name="status"
          label="Status"
          options={[
            { label: 'Active', value: 1 },
            { label: 'Disabled', value: 2 },
          ]}
        />
        <ProFormDigit name="sort" label="Sort Order" min={0} max={32767} />
      </ModalForm>
    </Row>
  );
}
