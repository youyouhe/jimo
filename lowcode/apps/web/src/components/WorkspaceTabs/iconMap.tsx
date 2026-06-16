import React from 'react';
import {
  DashboardOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  MenuOutlined,
  ApiOutlined,
  SlidersOutlined,
  BookOutlined,
  StopOutlined,
  ControlOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  FileOutlined,
  CodeOutlined,
  HistoryOutlined,
  AppstoreOutlined,
  ExportOutlined,
  BranchesOutlined,
  BlockOutlined,
  KeyOutlined,
  BarcodeOutlined,
  MonitorOutlined,
  AuditOutlined,
  SecurityScanOutlined,
  WarningOutlined,
  IdcardOutlined,
  InfoCircleOutlined,
  TableOutlined,
} from '@ant-design/icons';

/**
 * Map of icon-name (as stored in `.umirc.ts` / DB menu `icon` field) → the
 * rendered antd icon element. Tab labels look this up; unknown names are simply
 * omitted (icons in tabs are decorative, not required).
 */
const ICON_MAP: Record<string, React.ComponentType> = {
  DashboardOutlined,
  SettingOutlined,
  TeamOutlined,
  SafetyCertificateOutlined,
  MenuOutlined,
  ApiOutlined,
  SlidersOutlined,
  BookOutlined,
  StopOutlined,
  ControlOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  FileOutlined,
  CodeOutlined,
  HistoryOutlined,
  AppstoreOutlined,
  ExportOutlined,
  BranchesOutlined,
  BlockOutlined,
  KeyOutlined,
  BarcodeOutlined,
  MonitorOutlined,
  AuditOutlined,
  SecurityScanOutlined,
  WarningOutlined,
  IdcardOutlined,
  InfoCircleOutlined,
  TableOutlined,
};

/** Render an icon by name, or null when the name is unknown/unset. */
export function renderTabIcon(name?: string): React.ReactNode {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  return Icon ? React.createElement(Icon) : null;
}
