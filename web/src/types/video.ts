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
  authorId: string;
  authorAvatar?: string;
  tags?: string[];
  category?: string; // 分类名称
  likes: number;
  description?: string; // 视频描述；列表接口本来就有，之前映射时被丢掉了
}
