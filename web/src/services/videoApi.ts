import api from './api';
import type { Video, VideoListItem } from '@/types/video';

// 后端返回的原始视频数据（snake_case）
interface RawVideo {
  id: string;
  user_id: number;
  title: string;
  description: string;
  thumbnail_url: string;
  video_url: string;
  duration: number;
  author: string;
  author_avatar: string;
  tags: string[] | null;
  views: number;
  likes: number;
  comments: number;
  created_at: string;
  updated_at: string;
}

// 后端 -> 前端字段映射
function mapRawToVideo(raw: RawVideo): Video {
  return {
    id: raw.id,
    title: raw.title,
    description: raw.description,
    thumbnailUrl: raw.thumbnail_url || undefined,
    videoUrl: raw.video_url,
    duration: raw.duration,
    author: raw.author || 'LibTV',
    authorAvatar: raw.author_avatar || undefined,
    tags: raw.tags || undefined,
    stats: { views: raw.views, likes: raw.likes, comments: raw.comments },
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapRawToListItem(raw: RawVideo): VideoListItem {
  return {
    id: raw.id,
    title: raw.title,
    thumbnailUrl: raw.thumbnail_url || undefined,
    videoUrl: raw.video_url,
    duration: raw.duration,
    author: raw.author || 'LibTV',
    tags: raw.tags || undefined,
  };
}

// 本地视频兜底数据
const localVideos: Video[] = [
  {
    id: 'a3f8c1d2e5b7094a',
    title: '武松',
    description: '经典影视片段，讲述武松的英雄事迹',
    thumbnailUrl: 'https://picsum.photos/400/225?random=10',
    videoUrl: '/media/videos/武松.mp4',
    duration: 120,
    author: 'LibTV',
    authorAvatar: 'https://picsum.photos/48/48?random=100',
    tags: ['经典', '影视'],
    stats: { views: 1250, likes: 89, comments: 34 },
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
  {
    id: 'b7d2e9f4a1c8053e',
    title: '没考好，没关系',
    description: '教育励志视频，鼓励孩子勇于面对失败',
    thumbnailUrl: 'https://picsum.photos/400/225?random=11',
    videoUrl: '/media/videos/没考好，没关系.mp4',
    duration: 90,
    author: 'LibTV',
    authorAvatar: 'https://picsum.photos/48/48?random=101',
    tags: ['教育', '励志'],
    stats: { views: 890, likes: 67, comments: 21 },
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
];

// TV Show 视频（暂为 mock，后续对接数据库）
const mockTvShowVideos: VideoListItem[] = [
  { id: 'c5a1b3d8f2e7046d', title: '死于罗曼蒂克CE', thumbnailUrl: 'https://picsum.photos/400/225?random=1', videoUrl: '/media/videos/武松.mp4', duration: 120, author: 'yoimachigusa', tags: ['手', '梦', '等单的事', '更多资源在QQ群里分享做事视频'] },
  { id: 'd9e4b7c2a6f10385', title: '这一次，我会幸福', thumbnailUrl: 'https://picsum.photos/400/225?random=2', videoUrl: '/media/videos/没考好，没关系.mp4', duration: 180, author: 'Forest界', tags: ['故事', '励志', '等待的事'] },
  { id: 'a8f2c5d1b3e70946', title: 'Zeno', thumbnailUrl: 'https://picsum.photos/400/225?random=3', videoUrl: '/media/videos/武松.mp4', duration: 210, author: 'Zeno', tags: ['UnToughable', 'AI音乐MV照片'] },
  { id: 'b6d3e7f4a1c80529', title: 'Cat', thumbnailUrl: 'https://picsum.photos/400/225?random=4', videoUrl: '/media/videos/没考好，没关系.mp4', duration: 150, author: '微信用户Phof9', tags: ['Cat', '回忆', '城市'] },
  { id: 'e1a9b4c7d2f50683', title: '等待的故事', thumbnailUrl: 'https://picsum.photos/400/225?random=5', videoUrl: '/media/videos/武松.mp4', duration: 135, author: '创作家', tags: ['等待', '治愈'] },
  { id: 'f4b8c2d6e3a10795', title: '城市探索', thumbnailUrl: 'https://picsum.photos/400/225?random=6', videoUrl: '/media/videos/没考好，没关系.mp4', duration: 145, author: '探索者', tags: ['城市', '探险'] },
];

export const videoApi = {
  // 获取视频列表
  getVideos: async (page = 1, pageSize = 20, tag?: string, keyword?: string) => {
    try {
      const params: Record<string, unknown> = { page, page_size: pageSize };
      if (tag && tag !== 'all') {
        params.tag = tag;
      }
      if (keyword) {
        params.keyword = keyword;
      }
      const data = await api.get('/videos', { params }) as unknown;
      const raw = data as { items: RawVideo[]; total: number; page: number; page_size: number };
      return {
        list: raw.items.map(mapRawToListItem),
        total: raw.total,
        page: raw.page,
        pageSize: raw.page_size,
      };
    } catch {
      // 后端未启动时返回本地视频
      const localList: VideoListItem[] = [
        ...localVideos.map(({ stats, authorAvatar, description, createdAt, updatedAt, ...rest }) => rest),
        ...mockTvShowVideos,
      ];
      return { list: localList, total: localList.length, page, pageSize };
    }
  },

  // 获取视频详情
  getVideo: async (id: string): Promise<Video | null> => {
    try {
      const data = await api.get(`/videos/${id}`) as unknown;
      return mapRawToVideo(data as RawVideo);
    } catch {
      // 后端未启动时从本地视频中查找
      return localVideos.find((v) => v.id === id) || mockTvShowVideos.find((v) => v.id === id)
        ? {
            ...(localVideos.find((v) => v.id === id) || {
              id,
              title: mockTvShowVideos.find((v) => v.id === id)?.title || '',
              description: '',
              thumbnailUrl: mockTvShowVideos.find((v) => v.id === id)?.thumbnailUrl,
              videoUrl: mockTvShowVideos.find((v) => v.id === id)?.videoUrl || '',
              duration: mockTvShowVideos.find((v) => v.id === id)?.duration || 0,
              author: mockTvShowVideos.find((v) => v.id === id)?.author || '',
              tags: mockTvShowVideos.find((v) => v.id === id)?.tags,
              stats: { views: 0, likes: 0, comments: 0 },
              createdAt: '2026-06-01T00:00:00Z',
              updatedAt: '2026-06-01T00:00:00Z',
            }),
          }
        : null;
    }
  },

  // 获取本地视频列表（始终可用）
  getLocalVideos: (): VideoListItem[] =>
    localVideos.map(({ stats, authorAvatar, description, createdAt, updatedAt, ...rest }) => rest),

  // 获取 TV Show 视频
  getTvShowVideos: (): VideoListItem[] => mockTvShowVideos,
};
