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
