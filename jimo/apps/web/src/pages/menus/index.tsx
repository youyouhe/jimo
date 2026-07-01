import { useEffect, useRef, useState } from 'react';
import { Button, message, Popconfirm, Select, Space, Table, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { PlusOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import {
  ModalForm,
  ProFormText,
  ProFormSelect,
  ProFormSwitch,
  ProFormDigit,
} from '@ant-design/pro-components';
import {
  getMenuTree,
  createMenu,
  updateMenu,
  deleteMenu,
  getMenus,
  type MenuItem,
  type CreateMenuDto,
  type UpdateMenuDto,
} from '@/services/menu';
import SystemAgentPanel from '@/components/SystemAgentPanel';

const MENU_TYPE_OPTIONS = [
  { label: 'Directory', value: 1 },
  { label: 'Menu', value: 2 },
  { label: 'Button', value: 3 },
];

const MENU_TYPE_COLOR_MAP: Record<number, string> = {
  1: 'blue',
  2: 'green',
  3: 'orange',
};

const MENU_TYPE_LABEL_MAP: Record<number, string> = {
  1: 'Directory',
  2: 'Menu',
  3: 'Button',
};

interface FlatMenuOption {
  label: string;
  value: string;
}

function flattenMenuTree(tree: MenuItem[], depth = 0): FlatMenuOption[] {
  const result: FlatMenuOption[] = [];
  const prefix = '  '.repeat(depth);
  for (const node of tree) {
    result.push({
      label: `${prefix}${depth > 0 ? '└ ' : ''}${node.name}`,
      value: node.id,
    });
    if (node.children && node.children.length > 0) {
      result.push(...flattenMenuTree(node.children, depth + 1));
    }
  }
  return result;
}

export default function MenusPage() {
  const [dataSource, setDataSource] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null);
  const [parentOptions, setParentOptions] = useState<FlatMenuOption[]>([]);
  const [agentOpen, setAgentOpen] = useState(false);
  const hasLoaded = useRef(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const tree = await getMenuTree();
      setDataSource(tree);
      setParentOptions(flattenMenuTree(tree));
    } catch (err: any) {
      message.error(err.message || 'Failed to load menus');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      loadData();
    }
  }, []);

  const columns: ColumnsType<MenuItem> = [
    {
      title: 'Name',
      dataIndex: 'name',
      key: 'name',
      width: 240,
      render: (v: string, record: MenuItem) => (
        <span>
          {record.menuType === 1 ? (
            <span style={{ fontWeight: 600, color: '#1677ff' }}>
              📁 {v}
            </span>
          ) : record.menuType === 3 ? (
            <span style={{ color: '#999', fontSize: 13 }}>
              🔘 {v}
            </span>
          ) : (
            <span>📄 {v}</span>
          )}
        </span>
      ),
    },
    {
      title: 'Path',
      dataIndex: 'path',
      key: 'path',
      width: 200,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'Icon',
      dataIndex: 'icon',
      key: 'icon',
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'Component',
      dataIndex: 'component',
      key: 'component',
      width: 220,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'Sort',
      dataIndex: 'sort',
      key: 'sort',
      width: 80,
      align: 'center',
    },
    {
      title: 'Type',
      dataIndex: 'menuType',
      key: 'menuType',
      width: 100,
      render: (v: number) => (
        <Tag color={MENU_TYPE_COLOR_MAP[v] || 'default'}>
          {MENU_TYPE_LABEL_MAP[v] || v}
        </Tag>
      ),
    },
    {
      title: 'Visible',
      dataIndex: 'isVisible',
      key: 'isVisible',
      width: 80,
      render: (v: number) =>
        v === 1 ? <Tag color="green">Yes</Tag> : <Tag color="default">No</Tag>,
    },
    {
      title: 'Permission',
      dataIndex: 'permission',
      key: 'permission',
      width: 160,
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
    {
      title: 'Actions',
      key: 'action',
      width: 220,
      render: (_, record) => (
        <Space>
          {record.menuType !== 3 && (
            <Button
              type="link"
              size="small"
              style={{ color: '#52c41a' }}
              onClick={() => {
                setEditingMenu(null);
                setDefaultParentId(record.id);
                setModalOpen(true);
              }}
            >
              Add Child
            </Button>
          )}
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditingMenu(record);
              setModalOpen(true);
            }}
          >
            Edit
          </Button>
          <Popconfirm
            title="Delete this menu?"
            description="Cannot delete menus with children. Remove child menus first."
            onConfirm={async () => {
              try {
                await deleteMenu(record.id);
                message.success('Menu deleted');
                loadData();
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
      if (editingMenu) {
        const dto: UpdateMenuDto = {
          name: values.name,
          path: values.path || null,
          component: values.component || null,
          icon: values.icon || null,
          parent_id: values.parent_id || null,
          sort: values.sort ?? 0,
          is_visible: values.is_visible ? 1 : 2,
          permission: values.permission || null,
          menu_type: values.menu_type ?? 1,
        };
        await updateMenu(editingMenu.id, dto);
        message.success('Menu updated');
      } else {
        const dto: CreateMenuDto = {
          name: values.name,
          path: values.path,
          component: values.component,
          icon: values.icon,
          parent_id: values.parent_id,
          sort: values.sort ?? 0,
          is_visible: values.is_visible ? 1 : 2,
          permission: values.permission,
          menu_type: values.menu_type ?? 1,
        };
        await createMenu(dto);
        message.success('Menu created');
      }
      setModalOpen(false);
      setEditingMenu(null);
      loadData();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  return (
    <>
      <ProFormText
        key="dummy-hidden"
        name="_dummy"
        hidden
      />

      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Menu Management</h3>
        <Space>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingMenu(null);
              setDefaultParentId(null);
              setModalOpen(true);
            }}
          >
            New Menu
          </Button>
          <Button icon={<ReloadOutlined />} onClick={loadData}>
            Refresh
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setAgentOpen(true)}>
            AI 助手
          </Button>
        </Space>
      </div>

      <Table<MenuItem>
        rowKey="id"
        columns={columns}
        dataSource={dataSource}
        loading={loading}
        childrenColumnName="children"
        defaultExpandAllRows
        size="middle"
        pagination={false}
        indentSize={32}
        expandable={{
          defaultExpandAllRows: true,
        }}
      />

      <ModalForm
        key={editingMenu ? `edit-${editingMenu.id}` : `new-${defaultParentId || 'root'}`}
        title={editingMenu ? 'Edit Menu' : 'New Menu'}
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
          if (!open) {
            setEditingMenu(null);
          }
        }}
        initialValues={
          editingMenu
            ? {
                name: editingMenu.name,
                path: editingMenu.path,
                component: editingMenu.component,
                icon: editingMenu.icon,
                parent_id: editingMenu.parentId,
                sort: editingMenu.sort,
                is_visible: editingMenu.isVisible === 1,
                permission: editingMenu.permission,
                menu_type: editingMenu.menuType,
              }
            : { is_visible: true, menu_type: 1, sort: 0, parent_id: defaultParentId }
        }
        onFinish={handleSubmit}
        modalProps={{ destroyOnClose: true }}
      >
        <ProFormText
          name="name"
          label="Menu Name"
          placeholder="e.g. Dashboard"
          rules={[{ required: true, message: 'Menu name is required' }]}
        />
        <ProFormText
          name="path"
          label="Route Path"
          placeholder="e.g. /dashboard"
        />
        <ProFormText
          name="component"
          label="Component Path"
          placeholder="e.g. ./dashboard/index"
        />
        <ProFormText
          name="icon"
          label="Icon"
          placeholder="e.g. DashboardOutlined"
        />
        <ProFormSelect
          name="parent_id"
          label="Parent Menu"
          options={parentOptions}
          placeholder="None (root level)"
          fieldProps={{
            allowClear: true,
            showSearch: true,
            filterOption: (input: string, option: any) =>
              (option?.label as string)?.toLowerCase().includes(input.toLowerCase()),
          }}
        />
        <ProFormDigit
          name="sort"
          label="Sort Order"
          placeholder="0"
          min={0}
          max={32767}
          fieldProps={{ precision: 0 }}
        />
        <ProFormSelect
          name="menu_type"
          label="Menu Type"
          options={MENU_TYPE_OPTIONS}
          rules={[{ required: true, message: 'Type is required' }]}
        />
        <ProFormText
          name="permission"
          label="Permission Key"
          placeholder="e.g. system:menu:list"
        />
        <ProFormSwitch name="is_visible" label="Visible" />
      </ModalForm>
      <SystemAgentPanel
        open={agentOpen}
        agentType="menus"
        onClose={() => setAgentOpen(false)}
      />
    </>
  );
}
