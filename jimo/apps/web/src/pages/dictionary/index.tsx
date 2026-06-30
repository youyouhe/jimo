import { useRef, useState, useEffect, useCallback } from 'react';
import {
  Button,
  message,
  Modal,
  Popconfirm,
  Space,
  Tag,
  Tree,
  Table,
  Upload,
  Card,
  Row,
  Col,
  Dropdown,
  Drawer,
  Timeline,
  Tooltip,
  Badge,
} from 'antd';
import type { TreeProps, UploadProps, TableColumnsType } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  ExportOutlined,
  FolderOutlined,
  MoreOutlined,
  HistoryOutlined,
  RollbackOutlined,
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
  getDetailTree,
  createDetail,
  updateDetail,
  deleteDetail,
  listDictVersions,
  getDictVersion,
  restoreDictVersion,
  type Dictionary,
  type DictTreeNode,
  type DictionaryDetail,
  type DetailTreeNode,
  type CreateDictDto,
  type UpdateDictDto,
  type CreateDetailDto,
  type UpdateDetailDto,
  type SnapshotListItem,
  type DictionarySnapshot,
} from '@/services/dictionary';

/** Convert DataNode[] from Ant Tree to our tree format */
interface TreeNodeData {
  key: string;
  title: React.ReactNode;
  icon: React.ReactNode;
  children?: TreeNodeData[];
  isLeaf?: boolean;
  data: DictTreeNode;
}

function convertTreeData(
  nodes: DictTreeNode[],
  onEdit: (dict: DictTreeNode) => void,
  onDelete: (dict: DictTreeNode) => void,
  onHistory: (dict: DictTreeNode) => void,
): TreeNodeData[] {
  return nodes.map((node) => ({
    key: node.id,
    title: (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, width: '100%' }}>
        <FolderOutlined style={{ color: '#8c8c8c', flexShrink: 0 }} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        {(node as any).version > 1 && (
          <Tooltip title={`v${(node as any).version}`}>
            <Badge
              count={`v${(node as any).version}`}
              style={{ backgroundColor: '#d9d9d9', color: '#595959', fontSize: 10, lineHeight: '16px', height: 16, padding: '0 4px' }}
            />
          </Tooltip>
        )}
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                label: 'Edit',
                icon: <EditOutlined />,
                onClick: ({ domEvent }) => { domEvent.stopPropagation(); onEdit(node); },
              },
              {
                key: 'history',
                label: 'History',
                icon: <HistoryOutlined />,
                onClick: ({ domEvent }) => { domEvent.stopPropagation(); onHistory(node); },
              },
              { type: 'divider' },
              {
                key: 'delete',
                label: 'Delete',
                icon: <DeleteOutlined />,
                danger: true,
                onClick: ({ domEvent }) => { domEvent.stopPropagation(); onDelete(node); },
              },
            ],
          }}
          trigger={['click']}
        >
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            style={{ flexShrink: 0 }}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </span>
    ),
    icon: null,
    children:
      node.children && node.children.length > 0
        ? convertTreeData(node.children, onEdit, onDelete, onHistory)
        : undefined,
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
  const [detailTreeData, setDetailTreeData] = useState<DetailTreeNode[]>([]);
  const [isHierarchical, setIsHierarchical] = useState(false);
  const [treeLoading, setTreeLoading] = useState(false);

  // History Drawer
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDict, setHistoryDict] = useState<DictTreeNode | null>(null);
  const [historyItems, setHistoryItems] = useState<SnapshotListItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [previewSnap, setPreviewSnap] = useState<DictionarySnapshot | null>(null);

  // Load tree data — defined after handlers to use them as callbacks
  const handleEditDict = useCallback((dict: DictTreeNode) => {
    setEditingDict(dict);
    setDictModalOpen(true);
  }, []);

  const handleHistory = useCallback(async (dict: DictTreeNode) => {
    setHistoryDict(dict);
    setHistoryOpen(true);
    setHistoryLoading(true);
    setPreviewSnap(null);
    try {
      const items = await listDictVersions(dict.id);
      setHistoryItems(items);
    } catch (err: any) {
      message.error(err.message || 'Failed to load history');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const handleDeleteDictNode = useCallback((dict: DictTreeNode) => {
    Modal.confirm({
      title: `Delete "${dict.name}"?`,
      content: 'This will also delete all its details and sub-dictionaries.',
      okText: 'Delete',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          await deleteDict(dict.id);
          message.success('Dictionary deleted');
          setSelectedDict((prev) => (prev?.id === dict.id ? null : prev));
          loadTreeRef.current?.();
        } catch (err: any) {
          message.error(err.message || 'Delete failed');
        }
      },
    });
  }, []);

  const loadTreeRef = useRef<(() => void) | undefined>(undefined);
  const loadTree = useCallback(async () => {
    try {
      const data = await getDictTree();
      setTreeData(convertTreeData(data, handleEditDict, handleDeleteDictNode, handleHistory));
    } catch (err: any) {
      message.error(err.message || 'Failed to load dictionary tree');
    }
  }, [handleEditDict, handleDeleteDictNode, handleHistory]);

  useEffect(() => {
    loadTreeRef.current = loadTree;
  }, [loadTree]);

  useEffect(() => {
    loadTree();
  }, []);

  const hasChildren = useCallback((nodes: DetailTreeNode[]): boolean =>
    nodes.some((n) => n.children && n.children.length > 0), []);

  const loadDetailTree = useCallback(async (dictId: string) => {
    setTreeLoading(true);
    try {
      const data = await getDetailTree(dictId);
      setDetailTreeData(data);
      setIsHierarchical(hasChildren(data));
    } catch {
      setDetailTreeData([]);
      setIsHierarchical(false);
    } finally {
      setTreeLoading(false);
    }
  }, [hasChildren]);

  // Tree node select handler
  const handleTreeSelect: TreeProps['onSelect'] = async (selectedKeys, info) => {
    if (selectedKeys.length > 0) {
      const node = info.node as unknown as TreeNodeData;
      if (node.data) {
        setSelectedDict(node.data);
        loadDetailTree(node.data.id);
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
      if (selectedDict) loadDetailTree(selectedDict.id);
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
      if (selectedDict) loadDetailTree(selectedDict.id);
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
    try {
      await downloadDict(selectedDict.id, selectedDict.type);
    } catch (err: any) {
      message.error(err.message || 'Export failed');
    }
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

      {/* Right panel: Detail table (tree view when hierarchical, flat ProTable otherwise) */}
      <Col span={18}>
        {isHierarchical ? (
          <Card
            title={selectedDict ? `Details: ${selectedDict.name} (${selectedDict.type})` : 'Dictionary Details'}
            extra={
              <Button
                type="primary"
                icon={<PlusOutlined />}
                disabled={!selectedDict}
                onClick={() => { setEditingDetail(null); setDetailModalOpen(true); }}
              >
                New Detail
              </Button>
            }
          >
            <Table<DetailTreeNode>
              rowKey="id"
              loading={treeLoading}
              dataSource={detailTreeData}
              pagination={false}
              size="small"
              columns={detailColumns as TableColumnsType<DetailTreeNode>}
              expandable={{}}
              rowClassName={(record) => record.parentId ? 'dict-row-child' : 'dict-row-root'}
            />
            <style>{`
              .dict-row-root td { background: #f0f5ff !important; font-weight: 500; }
              .dict-row-child td { background: #fff !important; }
              .dict-row-root:hover td { background: #d6e4ff !important; }
              .dict-row-child:hover td { background: #f5f5f5 !important; }
            `}</style>
          </Card>
        ) : (
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
        )}
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
        <ProFormTreeSelect
          name="parent_id"
          label="Parent"
          placeholder="None (top-level)"
          allowClear
          fieldProps={{
            treeData: detailTreeData.map(function toNode(n: DetailTreeNode): any {
              return {
                title: `${n.label} (${n.value})`,
                value: n.id,
                disabled: editingDetail?.id === n.id,
                children: n.children?.map(toNode),
              };
            }),
            treeDefaultExpandAll: true,
            showSearch: true,
            treeNodeFilterProp: 'title',
          }}
        />
        <ProFormDigit name="sort" label="Sort Order" min={0} max={32767} />
      </ModalForm>

      {/* ── History Drawer ────────────────────────────────────── */}
      <Drawer
        title={historyDict ? `History: ${historyDict.name}` : 'Version History'}
        placement="right"
        width={480}
        open={historyOpen}
        onClose={() => { setHistoryOpen(false); setPreviewSnap(null); }}
      >
        {previewSnap ? (
          <div>
            <Button
              size="small"
              icon={<RollbackOutlined />}
              style={{ marginBottom: 12 }}
              onClick={() => setPreviewSnap(null)}
            >
              Back to list
            </Button>
            <div style={{ marginBottom: 8, fontWeight: 500 }}>
              Snapshot v{previewSnap.version} — {previewSnap.changeType}
            </div>
            <pre style={{ fontSize: 12, background: '#f5f5f5', padding: 12, borderRadius: 4, overflow: 'auto', maxHeight: 360 }}>
              {JSON.stringify(previewSnap.snapshot, null, 2)}
            </pre>
            <Button
              type="primary"
              danger
              block
              style={{ marginTop: 12 }}
              onClick={async () => {
                if (!historyDict) return;
                Modal.confirm({
                  title: `Restore to v${previewSnap.version}?`,
                  content: 'Current details will be replaced. A new snapshot will be created.',
                  okText: 'Restore',
                  okButtonProps: { danger: true },
                  cancelText: 'Cancel',
                  onOk: async () => {
                    try {
                      await restoreDictVersion(historyDict.id, previewSnap.version);
                      message.success(`Restored to v${previewSnap.version}`);
                      setHistoryOpen(false);
                      setPreviewSnap(null);
                      loadTree();
                      if (selectedDict?.id === historyDict.id) {
                        loadDetailTree(historyDict.id);
                        detailActionRef.current?.reload();
                      }
                    } catch (err: any) {
                      message.error(err.message || 'Restore failed');
                    }
                  },
                });
              }}
            >
              Restore this version
            </Button>
          </div>
        ) : (
          <Timeline
            pending={historyLoading ? 'Loading...' : undefined}
            items={historyItems.map((item) => ({
              color: item.changeType === 'delete' ? 'red' : item.changeType === 'restore' ? 'green' : 'blue',
              children: (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Space size={4}>
                      <Tag color="blue">v{item.version}</Tag>
                      <Tag>{item.changeType}</Tag>
                    </Space>
                    <Button
                      size="small"
                      type="link"
                      onClick={async () => {
                        try {
                          const snap = await getDictVersion(historyDict!.id, item.version);
                          setPreviewSnap(snap);
                        } catch (err: any) {
                          message.error(err.message || 'Failed to load snapshot');
                        }
                      }}
                    >
                      View
                    </Button>
                  </div>
                  <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: 2 }}>
                    {item.operator && <span>{item.operator} · </span>}
                    {new Date(item.createdAt).toLocaleString()}
                  </div>
                  {item.note && <div style={{ fontSize: 12, marginTop: 2 }}>{item.note}</div>}
                </div>
              ),
            }))}
          />
        )}
      </Drawer>
    </Row>
  );
}
