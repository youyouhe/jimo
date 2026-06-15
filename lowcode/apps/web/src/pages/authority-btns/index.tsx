import { useRef, useState, useEffect } from 'react';
import { Button, message, Popconfirm, Space, Tag, Select, Row, Col } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ActionType, ProColumns, ProTable } from '@ant-design/pro-components';
import { ModalForm, ProFormSelect } from '@ant-design/pro-components';
import {
  getAuthorityBtns,
  setAuthorityBtns,
  deleteAuthorityBtn,
  type AuthorityBtn,
  type SetAuthorityBtnsDto,
} from '@/services/authority-btn';
import { getRoles, type Role } from '@/services/role';
import { getMenus, type MenuItem } from '@/services/menu';

export default function AuthorityBtnsPage() {
  const actionRef = useRef<ActionType>(undefined);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<AuthorityBtn | null>(null);
  const [roles, setRoles] = useState<Role[]>([]);
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [filterAuthorityId, setFilterAuthorityId] = useState<string | undefined>(undefined);
  const [filterMenuId, setFilterMenuId] = useState<string | undefined>(undefined);

  useEffect(() => {
    getRoles({ page: 1, pageSize: 500 }).then((res) => setRoles(res.list || []));
    getMenus({}).then((res) => setMenus(res || []));
  }, []);

  const roleOptions = roles.map((r) => ({ label: `${r.name} (${r.code})`, value: r.id }));
  const menuOptions = menus.map((m) => ({ label: m.name || m.path || m.id, value: m.id }));

  const columns: ProColumns<AuthorityBtn>[] = [
    {
      title: 'Role',
      dataIndex: 'authorityId',
      width: 200,
      render: (_, record) => {
        const role = roles.find((r) => r.id === record.authorityId);
        return <Tag color="blue">{role?.name || record.authorityId}</Tag>;
      },
    },
    {
      title: 'Menu',
      dataIndex: 'menuId',
      width: 200,
      render: (_, record) => {
        const menu = menus.find((m) => m.id === record.menuId);
        return menu?.name || menu?.path || record.menuId;
      },
    },
    {
      title: 'Button Name',
      dataIndex: 'btnName',
      width: 180,
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      valueType: 'dateTime',
      width: 180,
      search: false,
    },
    {
      title: 'Actions',
      key: 'action',
      width: 100,
      search: false,
      render: (_, record) => (
        <Popconfirm
          title="Confirm deletion?"
          onConfirm={async () => {
            try {
              await deleteAuthorityBtn(record.id);
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
      ),
    },
  ];

  const handleSetSubmit = async (values: Record<string, any>) => {
    try {
      const btnNames = typeof values.btnNames === 'string'
        ? values.btnNames.split(',').map((s: string) => s.trim()).filter(Boolean)
        : values.btnNames;
      const dto: SetAuthorityBtnsDto = {
        authorityId: values.authorityId,
        menuId: values.menuId,
        btnNames,
      };
      await setAuthorityBtns(dto);
      message.success('Buttons configured');
      setModalOpen(false);
      actionRef.current?.reload();
      return true;
    } catch (err: any) {
      message.error(err.message || 'Operation failed');
      return false;
    }
  };

  return (
    <>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col>
          <Select
            allowClear
            placeholder="Filter by Role"
            style={{ width: 240 }}
            options={roleOptions}
            value={filterAuthorityId}
            onChange={(val) => {
              setFilterAuthorityId(val);
              actionRef.current?.reload();
            }}
          />
        </Col>
        <Col>
          <Select
            allowClear
            placeholder="Filter by Menu"
            style={{ width: 240 }}
            options={menuOptions}
            value={filterMenuId}
            onChange={(val) => {
              setFilterMenuId(val);
              actionRef.current?.reload();
            }}
          />
        </Col>
      </Row>

      <ProTable<AuthorityBtn>
        headerTitle="Authority Buttons"
        actionRef={actionRef}
        rowKey="id"
        columns={columns}
        request={async () => {
          const result = await getAuthorityBtns({
            authorityId: filterAuthorityId,
            menuId: filterMenuId,
          });
          return {
            data: result,
            total: result.length,
            success: true,
          };
        }}
        pagination={{ pageSize: 20 }}
        toolBarRender={() => [
          <Button
            key="set"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingRecord(null);
              setModalOpen(true);
            }}
          >
            Configure Buttons
          </Button>,
        ]}
      />

      <ModalForm
        title="Configure Button Permissions"
        open={modalOpen}
        onOpenChange={(open) => {
          setModalOpen(open);
        }}
        onFinish={handleSetSubmit}
        modalProps={{ destroyOnClose: true, width: 560 }}
      >
        <ProFormSelect
          name="authorityId"
          label="Role"
          options={roleOptions}
          placeholder="Select a role"
          showSearch
          rules={[{ required: true, message: 'Please select a role' }]}
        />
        <ProFormSelect
          name="menuId"
          label="Menu"
          options={menuOptions}
          placeholder="Select a menu"
          showSearch
          rules={[{ required: true, message: 'Please select a menu' }]}
        />
        <ProFormSelect
          name="btnNames"
          label="Button Names"
          mode="tags"
          placeholder="Type button names and press Enter"
          rules={[{ required: true, message: 'Please enter at least one button name' }]}
          fieldProps={{ tokenSeparators: [','] }}
        />
      </ModalForm>
    </>
  );
}
