import request from './request';

export interface LoginParams {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface UserInfo {
  id: string;
  username: string;
  nickname: string;
  email: string | null;
  phone: string | null;
  status: number;
}

export async function login(params: LoginParams): Promise<TokenResponse> {
  return request.post('/auth/login', params);
}

export async function logout(): Promise<void> {
  return request.post('/auth/logout');
}

export async function refreshToken(token: string): Promise<TokenResponse> {
  return request.post('/auth/refresh', { refresh_token: token });
}
