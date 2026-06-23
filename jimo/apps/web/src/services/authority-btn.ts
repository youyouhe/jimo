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

/**
 * Get the current user's button permissions.
 * Returns { component -> btnName[] }, e.g. { './test/index': ['add', 'edit', 'delete'] }
 * This is the single source of truth for frontend button visibility.
 */
export async function getMyBtnPerms(): Promise<Record<string, string[]>> {
  return request.get('/authority-btns/my');
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
