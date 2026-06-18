import axios from 'axios';
import { useUserStore } from '@/stores/user';

const request = axios.create({
  baseURL: '/api/v1',
  timeout: 10000,
});

// Track refresh state to avoid multiple concurrent refresh requests
let isRefreshing = false;
let refreshQueue: Array<(token: string) => void> = [];

request.interceptors.request.use((config) => {
  const { accessToken } = useUserStore.getState();
  if (accessToken) {
    config.headers['Authorization'] = `Bearer ${accessToken}`;
  }
  return config;
});

request.interceptors.response.use(
  (response) => {
    // Unwrap ApiResponse envelope: return response.data.data
    const apiRes = response.data;
    if (apiRes.code === 0) {
      return apiRes.data;
    }
    return Promise.reject(new Error(apiRes.msg || 'Request failed'));
  },
  async (error) => {
    const originalRequest = error.config;
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const { refreshToken } = useUserStore.getState();
      if (!refreshToken) {
        useUserStore.getState().clearUser();
        window.location.href = '/login';
        return Promise.reject(error);
      }
      if (isRefreshing) {
        return new Promise((resolve) => {
          refreshQueue.push((token: string) => {
            originalRequest.headers['Authorization'] = `Bearer ${token}`;
            resolve(request(originalRequest));
          });
        });
      }
      isRefreshing = true;
      try {
        const res = await axios.post('/api/v1/auth/refresh', { refresh_token: refreshToken });
        const { access_token, refresh_token } = res.data.data;
        useUserStore.getState().setTokens(access_token, refresh_token);
        refreshQueue.forEach((cb) => cb(access_token));
        refreshQueue = [];
        originalRequest.headers['Authorization'] = `Bearer ${access_token}`;
        return request(originalRequest);
      } catch {
        useUserStore.getState().clearUser();
        window.location.href = '/login';
        return Promise.reject(error);
      } finally {
        isRefreshing = false;
      }
    }
    // Extract a meaningful error message from the response body.
    // Backend returns { code, message } on 403/404/409 etc.
    const serverMsg =
      error.response?.data?.message ||
      error.response?.data?.msg ||
      error.message;

    const status = error.response?.status;
    let friendlyMsg: string;
    if (status === 403) {
      friendlyMsg = serverMsg?.includes('button permission')
        ? '权限不足：您没有该操作的权限'
        : (serverMsg || '权限不足');
    } else if (status === 404) {
      friendlyMsg = serverMsg || '资源不存在';
    } else if (status === 409) {
      friendlyMsg = serverMsg || '数据冲突，请检查输入';
    } else if (status === 400) {
      friendlyMsg = serverMsg || '请求参数错误';
    } else if (status === 500) {
      friendlyMsg = '服务器内部错误，请稍后重试';
    } else {
      friendlyMsg = serverMsg || `请求失败 (${status ?? '网络错误'})`;
    }

    const err = new Error(friendlyMsg);
    (err as any).status = status;
    return Promise.reject(err);
  },
);

export default request;
