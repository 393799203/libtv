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
    api.post<AuthResponse>('/auth/login', data),

  register: (data: RegisterRequest) =>
    api.post<AuthResponse | { registered: true; login_required: true }>('/auth/register', data),

  sendRegistrationCode: (email: string) =>
    api.post<{ retry_after: number; expires_in: number }>('/auth/register-code', { email }),

  logout: () =>
    api.post<ApiResponse<void>>('/auth/logout'),

  /** 申请重置密码：邮箱未注册时后端返回 404 + code 2010，由拦截器统一弹出提示 */
  forgotPassword: (data: ForgotPasswordRequest) =>
    api.post<ApiResponse<void>>('/auth/forgot-password', data),

  /** 凭邮件里的令牌设置新密码；成功后该账号所有旧登录态失效，需重新登录 */
  resetPassword: (data: ResetPasswordRequest) =>
    api.post<ApiResponse<void>>('/auth/reset-password', data),
};
