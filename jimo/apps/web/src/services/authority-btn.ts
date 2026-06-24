import request from './request';

export interface AuthorityBtn {
  id: string;
  authorityId: string;
  menuId: string;
  btnName: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAuthorityBtnDto {
  authorityId: string;
  menuId: string;
  btnName: string;
}

export interface SetAuthorityBtnsDto {
  authorityId: string;
  menuId: string;
  btnNames: string[];
}

export interface QueryAuthorityBtnParams {
  authorityId?: string;
  menuId?: string;
}

/**
 * Get authority buttons, optionally filtered by authorityId and/or menuId.
 */
export async function getAuthorityBtns(
  params?: QueryAuthorityBtnParams,
): Promise<AuthorityBtn[]> {
  return request.get('/authority-btns', { params });
}

/**
 * Get a single authority button by ID.
 */
export async function getAuthorityBtn(id: string): Promise<AuthorityBtn> {
  return request.get(`/authority-btns/${id}`);
}

/**
 * Create a single authority button.
 */
export async function createAuthorityBtn(
  dto: CreateAuthorityBtnDto,
): Promise<AuthorityBtn> {
  return request.post('/authority-btns', dto);
}

/**
 * Set (replace) all buttons for a role+menu pair.
 */
export async function setAuthorityBtns(
  dto: SetAuthorityBtnsDto,
): Promise<AuthorityBtn[]> {
  return request.post('/authority-btns/set', dto);
}

/**
 * Delete an authority button by ID.
 */
export async function deleteAuthorityBtn(id: string): Promise<void> {
  return request.delete(`/authority-btns/${id}`);
}

export interface CustomBtnEntry {
  name: string;
  label: string;
  actionType: 'navigate';
  targetTable: string;
  sourceField: string;
}

export interface BtnPermsEntry {
  systemBtns: string[];
  customBtns: CustomBtnEntry[];
}

/**
 * Get the current user's button permissions.
 * Returns { component -> { systemBtns, customBtns } }
 * systemBtns: built-in buttons (edit/delete/add/query/agent/batchDelete)
 * customBtns: custom navigate buttons defined via add_custom_btn
 */
export async function getMyBtnPerms(): Promise<Record<string, BtnPermsEntry>> {
  return request.get('/authority-btns/my');
}

export interface BtnPermsDetail {
  id: string;
  name: string;
  isCustom: boolean;
  btnConfig?: {
    label: string;
    actionType: 'navigate';
    targetTable: string;
    sourceField: string;
  };
  assignedRoleIds: string[];
}

export interface CreateCustomBtnPayload {
  tableName: string;
  btnName: string;
  label: string;
  targetTable: string;
  sourceField: string;
  roles: string[];
}

/** List all buttons for a table with role assignment info (admin use). */
export async function listBtnPermsByTable(tableName: string): Promise<BtnPermsDetail[]> {
  return request.get(`/authority-btns/by-table/${tableName}`);
}

/** Create a custom navigate button for a table. */
export async function createCustomBtn(payload: CreateCustomBtnPayload): Promise<{ id: string; name: string }> {
  return request.post('/authority-btns/custom', payload);
}

/** Remove a custom button (system buttons are protected). */
export async function removeCustomBtn(tableName: string, btnName: string): Promise<void> {
  return request.delete('/authority-btns/custom', { data: { tableName, btnName } });
}

// ---- Button-permission matrix (the REAL runtime system) ----
// getMyBtnPerms reads button sub-menus (sysMenus menu_type=3) via sys_role_menus.
// This matrix UI manages exactly that — not the legacy sys_authority_btns table.

export interface BtnMatrixButton {
  id: string;
  name: string;
  assignedRoleIds: string[];
}

export interface BtnMatrixGroup {
  menu: { id: string; name: string; path: string; component: string };
  buttons: BtnMatrixButton[];
}

/**
 * Get the button-permission matrix grouped by menu.
 */
export async function getBtnMatrix(): Promise<BtnMatrixGroup[]> {
  return request.get('/authority-btns/matrix');
}

/**
 * Grant/revoke a button for a role (writes sys_role_menus).
 */
export async function toggleBtn(
  roleId: string,
  buttonMenuId: string,
  assigned: boolean,
): Promise<void> {
  return request.post('/authority-btns/toggle', { roleId, buttonMenuId, assigned });
}
