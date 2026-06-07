import api from './api';
import type { Project, ProjectListItem, CreateProjectRequest } from '@/types/project';

// 后端返回的原始项目数据（snake_case）
interface RawProject {
  id: string;
  user_id: number;
  name: string;
  description: string;
  cover_url: string;
  created_at: string;
  updated_at: string;
}

function mapRawToProject(raw: RawProject): Project {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description || undefined,
    coverUrl: raw.cover_url || undefined,
    userId: String(raw.user_id),
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapRawToListItem(raw: RawProject): ProjectListItem {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description || undefined,
    coverUrl: raw.cover_url || undefined,
    updatedAt: raw.updated_at,
  };
}

export const projectApi = {
  // 获取项目列表
  getProjects: async (page = 1, pageSize = 20) => {
    const data = await api.get('/projects', { params: { page, page_size: pageSize } }) as unknown;
    const raw = data as { items: RawProject[]; total: number; page: number; page_size: number };
    return {
      list: raw.items.map(mapRawToListItem),
      total: raw.total,
      page: raw.page,
      pageSize: raw.page_size,
    };
  },

  // 获取项目详情
  getProject: async (id: string) => {
    const data = await api.get(`/projects/${id}`) as unknown;
    return mapRawToProject(data as RawProject);
  },

  // 创建项目
  createProject: async (data: CreateProjectRequest) => {
    const res = await api.post('/projects', data) as unknown;
    return mapRawToProject(res as RawProject);
  },

  // 删除项目
  deleteProject: (id: string) =>
    api.delete(`/projects/${id}`),

  // 更新项目
  updateProject: (id: string, data: { name?: string; description?: string }) =>
    api.put(`/projects/${id}`, data),
};
