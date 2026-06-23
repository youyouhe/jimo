import { useEffect, useState, useCallback } from 'react';
import { Card, Table, Checkbox, Input, Tag, Space, Empty, Spin, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { getBtnMatrix, toggleBtn, type BtnMatrixGroup, type BtnMatrixButton } from '@/services/authority-btn';
import { getRoles, type Role } from '@/services/role';

/**
 * Button-permission management — grouped by menu (分类分级), matrix of
 * button × role with checkboxes. Backed by the REAL runtime system
 * (button sub-menus + sys_role_menus), which is what getMyBtnPerms reads.
 */
export default function AuthorityBtnsPage() {
  const [groups, setGroups] = useState<BtnMatrixGroup[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [g, r] = await Promise.all([
        getBtnMatrix(),
        getRoles({ page: 1, pageSize: 100 }),
      ]);
      setGroups(g ?? []);
      setRoles(r.list ?? []);
    } catch (err: any) {
      message.error(err?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // super_admin bypasses sys_role_menus (always all buttons) — hide its column
  // to avoid misleading checkboxes; manage only real roles here.
  const matrixRoles = roles.filter((r) => r.code !== 'super_admin');

  const handleToggle = async (roleId: string, button: BtnMatrixButton, checked: boolean) => {
    // optimistic update
    setGroups((prev) =>
      prev.map((group) => ({
        ...group,
        buttons: group.buttons.map((b) =>
          b.id === button.id
            ? {
                ...b,
                assignedRoleIds: checked
                  ? [...new Set([...b.assignedRoleIds, roleId])]
                  : b.assignedRoleIds.filter((id) => id !== roleId),
              }
            : b,
        ),
      })),
    );
    try {
      await toggleBtn(roleId, button.id, checked);
    } catch (err: any) {
      message.error(err?.message || '操作失败，已回滚');
      reload();
    }
  };

  const buildColumns = (): ColumnsType<BtnMatrixButton> => [
    {
      title: '按钮',
      dataIndex: 'name',
      width: 120,
      render: (name: string) => <Tag color="blue">{name}</Tag>,
    },
    ...matrixRoles.map((role) => ({
      title: role.name,
      key: role.id,
      width: 90,
      align: 'center' as const,
      render: (_: unknown, record: BtnMatrixButton) => (
        <Checkbox
          checked={record.assignedRoleIds.includes(role.id)}
          onChange={(e) => handleToggle(role.id, record, e.target.checked)}
        />
      ),
    })),
  ];

  const filtered = search.trim()
    ? groups.filter(
        (g) => g.menu.name.includes(search.trim()) || g.menu.path.includes(search.trim()),
      )
    : groups;

  return (
    <div style={{ padding: 24 }}>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Input.Search
          placeholder="搜索菜单名 / 路径"
          allowClear
          style={{ width: 320 }}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span style={{ color: '#999', fontSize: 12 }}>
          勾选 = 该角色在此菜单拥有该按钮权限（运行时 getMyBtnPerms 即读此数据）。super_admin 永远全权限，不在此管理。
        </span>
      </Space>

      <Spin spinning={loading}>
        {filtered.length === 0 && !loading ? (
          <Empty description="暂无按钮权限数据（生成业务表后会出现）" />
        ) : (
          filtered.map((group) => (
            <Card
              key={group.menu.id}
              size="small"
              style={{ marginBottom: 12 }}
              title={
                <Space>
                  <span>{group.menu.name || '(未命名菜单)'}</span>
                  <Tag>{group.menu.path}</Tag>
                  {group.menu.component ? (
                    <Tag color="geekblue">{group.menu.component}</Tag>
                  ) : null}
                </Space>
              }
            >
              <Table<BtnMatrixButton>
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={group.buttons}
                columns={buildColumns()}
              />
            </Card>
          ))
        )}
      </Spin>
    </div>
  );
}
