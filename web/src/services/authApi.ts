import api from './api';
import type {
  LoginRequest,
  RegisterRequest,
  AuthResponse,
  ForgotPasswordRequest,
  ResetPasswordRequest,
} from '@/types/api';
import type { ApiResponse } from '@/types/api';

export const authApi = {
  login: (data: LoginRequest) =>
    api.post<ApiResponse<AuthResponse>>('/auth/login', data),

  register: (data: RegisterRequest) =>
    api.post<ApiResponse<AuthResponse>>('/auth/register', data),

  logout: () =>
    api.post<ApiResponse<void>>('/auth/logout'),

  /** 申请重置密码：无论邮箱是否注册，后端都回同一句「如果该邮箱已注册…」 */
  forgotPassword: (data: ForgotPasswordRequest) =>
    api.post<ApiResponse<void>>('/auth/forgot-password', data),

  /** 凭邮件里的令牌设置新密码；成功后该账号所有旧登录态失效，需重新登录 */
  resetPassword: (data: ResetPasswordRequest) =>
    api.post<ApiResponse<void>>('/auth/reset-password', data),
};
