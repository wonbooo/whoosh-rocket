import { request } from '@/apis/request';
import type { LoginPayload, LoginResponse, UserInfo } from '@/types/user';

export const authApi = {
  login: async (payload: LoginPayload) => {
    const { data } = await request.post<LoginResponse>('/auth/login', payload);
    return data;
  },
  getUserInfo: async () => {
    const { data } = await request.get<UserInfo>('/auth/me');
    return data;
  },
};
