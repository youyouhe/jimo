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
