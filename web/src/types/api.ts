// API 通用响应格式
export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

// 分页请求
export interface PaginationRequest {
  page: number;
  pageSize: number;
}

// 分页响应
export interface PaginationResponse<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 登录请求
export interface LoginRequest {
  email: string;
  password: string;
}

// 注册请求
export interface RegisterRequest {
  email: string;
  password: string;
  nickname: string;
  /** 注册来源渠道（wasu=华数 / dianxin=电信）；由注册链接 ?source= 参数带入，缺省 wasu */
  channel?: string;
}

// 找回密码：申请发送重置邮件
export interface ForgotPasswordRequest {
  email: string;
}

// 找回密码：凭邮件里的令牌设置新密码
export interface ResetPasswordRequest {
  /** 邮件链接里的明文令牌（后端只存哈希） */
  token: string;
  password: string;
}

// 认证响应
export interface AuthResponse {
  token: string;
  user: {
    id: string;
    email: string;
    nickname: string;
    avatarUrl?: string;
    role?: string;
    /** 剩余积分（AI 调用扣费用） */
    credits?: number;
  };
}
