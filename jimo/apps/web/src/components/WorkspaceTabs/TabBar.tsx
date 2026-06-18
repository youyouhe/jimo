import React from 'react';
import { Tabs, Dropdown, Space } from 'antd';
import type { MenuProps } from 'antd';
import { CloseOutlined, ReloadOutlined, DownOutlined } from '@ant-design/icons';
import { history } from '@umijs/max';
import { useTabsStore, HOME_PATH } from '@/stores/tabs';
import { renderTabIcon } from './iconMap';

/**
 * The workspace tab strip.
 *
 * - Click a tab → `history.push(path)` (the RouteSync in the parent then sets it active).
 * - Hover/active close X → close this tab (and navigate to neighbour if it was active).
 * - Right-click a tab → context menu: 刷新 / 关闭其他 / 关闭全部 / 关闭.
 * - Right-side actions dropdown for the current tab.
 */
export default function TabBar() {
  const tabs = useTabsStore((s) => s.tabs);
  const activeKey = useTabsStore((s) => s.activeKey);
  const closeTab = useTabsStore((s) => s.closeTab);
  const closeOthers = useTabsStore((s) => s.closeOthers);
  const closeAll = useTabsStore((s) => s.closeAll);
  const refreshTab = useTabsStore((s) => s.refreshTab);

  /** Close a single tab; navigate to the neighbour when closing the active one. */
  const handleClose = (path: string) => {
    const next = closeTab(path);
    if (next && next !== window.location.pathname) history.push(next);
  };

  /** Build the right-click context menu for a tab. */
  const contextMenu = (path: string, closable: boolean): MenuProps['items'] => [
    {
      key: 'refresh',
      icon: <ReloadOutlined />,
      label: '刷新',
      onClick: () => refreshTab(path),
    },
    { type: 'divider' },
    {
      key: 'closeOthers',
      label: '关闭其他',
      disabled: tabs.length <= 1,
      onClick: () => closeOthers(path),
    },
    {
      key: 'closeAll',
      label: '关闭全部',
      onClick: () => {
        const home = closeAll();
        if (home !== window.location.pathname) history.push(home);
      },
    },
    {
      key: 'close',
      icon: <CloseOutlined />,
      label: '关闭',
      disabled: !closable,
      onClick: () => handleClose(path),
    },
  ];

  const items = tabs.map((tab) => ({
    key: tab.path,
    label: (
      <Dropdown menu={{ items: contextMenu(tab.path, tab.closable) }} trigger={['contextMenu']}>
        <span
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, paddingRight: tab.closable ? 4 : 0 }}
        >
          {renderTabIcon(tab.icon)}
          <span>{tab.title}</span>
          {tab.closable && (
            <CloseOutlined
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                handleClose(tab.path);
              }}
              style={{
                fontSize: 10,
                marginLeft: 2,
                color: '#999',
                // Subtle on background tabs, brighter on the active tab.
                opacity: tab.path === activeKey ? 0.85 : 0.45,
              }}
            />
          )}
        </span>
      </Dropdown>
    ),
    closable: tab.closable,
  }));

  // Right-side quick actions for the current tab.
  const extraMenu: MenuProps['items'] = contextMenu(activeKey, activeKey !== HOME_PATH);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        background: '#fff',
        borderBottom: '1px solid #f0f0f0',
        padding: '0 8px',
      }}
    >
      <Tabs
        activeKey={activeKey}
        items={items}
        size="small"
        type="card"
        onChange={(key) => history.push(key)}
        style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
        tabBarStyle={{ marginBottom: 0 }}
      />
      <Dropdown menu={{ items: extraMenu }} placement="bottomRight">
        <span style={{ cursor: 'pointer', padding: '0 8px', color: '#666' }}>
          <DownOutlined />
        </span>
      </Dropdown>
    </div>
  );
}
