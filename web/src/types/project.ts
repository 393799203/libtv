// 项目
export interface Project {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

// 项目列表项
export interface ProjectListItem {
  id: string;
  name: string;
  description?: string;
  coverUrl?: string;
  updatedAt: string;
}

// 创建项目请求
export interface CreateProjectRequest {
  name: string;
  description?: string;
}
