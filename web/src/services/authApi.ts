import api from './api';
import type { LoginRequest, RegisterRequest, AuthResponse } from '@/types/api';
import type { ApiResponse } from '@/types/api';

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<ApiResponse<AuthResponse>>('/auth/login', data),

  register: (data: RegisterRequest) =>
    api.post<ApiResponse<AuthResponse>>('/auth/register', data),

  logout: () =>
    api.post<ApiResponse<void>>('/auth/logout'),
};
