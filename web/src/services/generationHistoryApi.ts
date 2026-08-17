import api from './api';

export interface GenerationHistoryItem {
  id: string;
  user_id: string;
  project_id: string;
  node_id: string;
  node_type: 'image' | 'video';
  prompt: string;
  model: string;
  result_url: string;
  created_at: string;
}

export interface GenerationHistoryListParams {
  node_id: string;
  page?: number;
  page_size?: number;
}

export interface GenerationHistoryListResponse {
  items: GenerationHistoryItem[];
  total: number;
  page: number;
  page_size: number;
}

export const generationHistoryApi = {
  list: (params: GenerationHistoryListParams) =>
    api.get<GenerationHistoryListResponse>('/generation-history', { params }),
};
