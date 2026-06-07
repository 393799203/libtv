// 视频
export interface Video {
  id: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  videoUrl: string;
  duration: number;
  author: string;
  authorAvatar?: string;
  tags?: string[];
  stats: {
    views: number;
    likes: number;
    comments: number;
  };
  createdAt: string;
  updatedAt: string;
}

// 视频列表项
export interface VideoListItem {
  id: string;
  title: string;
  thumbnailUrl?: string;
  videoUrl: string;
  duration: number;
  author: string;
  tags?: string[];
}
