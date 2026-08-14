import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Typography,
  Tag,
  App,
  Spin,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  HeartOutlined,
} from '@ant-design/icons';
import { projectApi } from '@/services/projectApi';
import { showApi } from '@/services/showApi';
import { bannerApi, type BannerItem } from '@/services/bannerApi';
import { useAuthStore } from '@/stores/authStore';
import type { ProjectListItem } from '@/types/project';
import type { VideoListItem } from '@/types/video';

const { Title, Text } = Typography;

// TV Show 分类（从 API 加载，初始含"全部"选项）
const ALL_CATEGORY = { key: 'all', label: '全部' };

const formatDuration = (seconds: number) => {
  if (seconds === 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// 项目卡片组件 - 使用memo优化
const ProjectCard = memo(function ProjectCard({
  project,
  isAuthenticated,
  onNavigate,
  onDelete,
}: {
  project: ProjectListItem;
  isAuthenticated: boolean;
  onNavigate: (id: string) => void;
  onDelete: (project: ProjectListItem) => void;
}) {
  return (
    <div
      className="h-28 bg-gray-100 relative rounded-lg overflow-hidden cursor-pointer hover:shadow-md"
      onClick={() => onNavigate(project.id)}
      style={{
        willChange: 'transform', // 提示Chrome优化
        contain: 'layout style paint', // CSS containment优化
      }}
    >
      {project.coverUrl ? (
        <img src={project.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-cyan-500">
          <img src={`https://picsum.photos/200/150?random=${project.id}`} alt="" className="w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      <button
        className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded bg-black/50 text-white hover:bg-red-500 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(project);
        }}
        title="删除项目"
      >
        <DeleteOutlined style={{ fontSize: 12 }} />
      </button>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
        <p className="!text-white !text-xs truncate">{project.name}</p>
      </div>
    </div>
  );
});

// 视频卡片组件 - 使用memo优化 + Intersection Observer懒渲染
const VideoCard = memo(function VideoCard({
  item,
  onNavigate,
  isVisible,
}: {
  item: VideoListItem;
  onNavigate: (id: string) => void;
  isVisible: boolean; // 是否在可视区域
}) {
  // 只在可见时渲染完整内容，否则只渲染占位符
  if (!isVisible) {
    return (
      <div className="h-40 bg-gray-100 rounded-lg animate-pulse" style={{ minHeight: '220px' }}>
        {/* 占位符，不渲染图片和内容 */}
      </div>
    );
  }

  return (
    <Card
      hoverable
      className="!rounded-lg overflow-hidden cursor-pointer"
      styles={{ body: { padding: 0 } }}
      onClick={() => onNavigate(item.id)}
    >
      <div
        className="h-40 bg-gray-100 relative overflow-hidden"
        style={{
          contain: 'layout style paint', // CSS containment优化
        }}
      >
        <img
          src={item.thumbnailUrl || `https://picsum.photos/400/225?random=${item.id}`}
          alt={item.title}
          className="w-full h-full object-cover"
          loading="lazy"
          decoding="async" // 异步解码，避免阻塞主线程
        />
        {/* 标签：分类名称 + 视频自身标签 */}
        {(item.category || (item.tags?.length || 0) > 0) && (
          <div className="absolute top-2 left-2 flex gap-1 z-20 flex-wrap">
            {item.category && (
              <span className="px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded-full">{item.category}</span>
            )}
            {(item.tags || []).slice(0, 2).map(tag => (
              <span key={tag} className="px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded-full">{tag}</span>
            ))}
          </div>
        )}
        {/* 播放按钮 - 简化hover效果 */}
        <div className="absolute inset-0 bg-black/0 hover:bg-black/20 flex items-center justify-center opacity-0 hover:opacity-100 z-10 transition-none">
          <PlayCircleOutlined style={{ fontSize: '48px', color: 'white' }} />
        </div>
        {/* 时长和作者信息 - 合并到一个叠加层，减少absolute元素 */}
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between z-20">
          {/* 作者信息：优先用作者真实头像，缺失时用作者首字占位 */}
          <div className="flex items-center gap-1">
            {item.authorAvatar ? (
              <img src={item.authorAvatar} alt="" className="w-4 h-4 rounded-full border border-white/50 object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="w-4 h-4 rounded-full border border-white/50 bg-gray-500 text-white text-[8px] flex items-center justify-center">{item.author.slice(0, 1)}</div>
            )}
            <span className="text-white text-[11px] drop-shadow-sm truncate max-w-[100px]">{item.author}</span>
          </div>
          {/* 时长 */}
          {item.duration > 0 && (
            <div className="bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
              {formatDuration(item.duration)}
            </div>
          )}
        </div>
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between">
          <p className="!text-sm font-medium truncate flex-1">
            {item.title}
          </p>
          <span className="flex items-center gap-0.5 text-gray-500 text-xs flex-shrink-0 ml-2">
            <HeartOutlined className="text-[12px]" />
            {item.likes >= 10000 ? `${(item.likes / 10000).toFixed(1)}万` : item.likes}
          </span>
        </div>
      </div>
    </Card>
  );
});

// Intersection Observer Hook - 检测元素是否在可视区域
function useIntersectionObserver(threshold = 0.1) {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const newVisibleItems = new Set(visibleItems);
        entries.forEach((entry) => {
          const index = Number(entry.target.getAttribute('data-index'));
          if (entry.isIntersecting) {
            newVisibleItems.add(index);
          } else {
            // 保持已渲染的项，避免频繁卸载/重新加载
            // newVisibleItems.delete(index);
          }
        });
        setVisibleItems(newVisibleItems);
      },
      {
        threshold,
        rootMargin: '100px', // 提前100px开始渲染
      }
    );

    // 观察所有item
    itemRefs.current.forEach((ref) => {
      if (ref && observerRef.current) {
        observerRef.current.observe(ref);
      }
    });

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [threshold, visibleItems]);

  const setItemRef = useCallback((index: number, el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(index, el);
      if (observerRef.current) {
        observerRef.current.observe(el);
      }
    } else {
      itemRefs.current.delete(index);
    }
  }, []);

  return { visibleItems, setItemRef };
}

export default function VideoListPage() {
  const { message, modal } = App.useApp();
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [videosLoading, setVideosLoading] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [tvShowVideos, setTvShowVideos] = useState<VideoListItem[]>([]);
  const [showCategories, setShowCategories] = useState<{ key: string; label: string }[]>([ALL_CATEGORY]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  const loadingBannersRef = useRef<Set<string>>(new Set()); // 用ref跟踪loading状态，不触发重渲染
  const [, forceUpdate] = useState(0); // 用于强制更新loading状态
  const [isDragging, setIsDragging] = useState(false); // 是否正在拖拽
  const [dragStartX, setDragStartX] = useState(0); // 拖拽起始X坐标
  const hasDraggedRef = useRef(false); // 是否发生了拖拽（用于区分点击和拖拽）
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 无限滚动分页状态
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE_SIZE = 12; // 每页加载12条（4列×3行）
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Intersection Observer - 检测视频列表中哪些项在可视区域
  const { visibleItems, setItemRef } = useIntersectionObserver(0.05);

  // Banner图片加载处理（使用ref，不触发重渲染）
  const handleBannerImageLoad = useCallback((bannerId: string) => {
    loadingBannersRef.current.delete(bannerId);
    forceUpdate(n => n + 1); // 图片加载完成后触发一次更新
  }, []);

  const handleBannerImageError = useCallback((bannerId: string) => {
    loadingBannersRef.current.delete(bannerId);
    forceUpdate(n => n + 1);
  }, []);

  // 鼠标拖拽处理
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStartX(e.clientX);
    hasDraggedRef.current = false; // 重置拖拽标记
  }, []);

  const handleDragMove = useCallback(() => {
    if (!isDragging) return;
    // 可以在这里添加实时拖拽效果
  }, [isDragging]);

  const handleDragEnd = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;

    const dragEndX = e.clientX;
    const dragDistance = dragEndX - dragStartX;

    // 拖拽距离超过50px才触发切换
    if (Math.abs(dragDistance) > 50) {
      hasDraggedRef.current = true; // 标记发生了拖拽
      if (dragDistance > 0) {
        // 向右拖拽，显示上一个
        setCurrentBannerIndex((prev) =>
          prev === 0 ? banners.length - 1 : prev - 1
        );
      } else {
        // 向左拖拽，显示下一个
        setCurrentBannerIndex((prev) =>
          prev === banners.length - 1 ? 0 : prev + 1
        );
      }
    }

    setIsDragging(false);
    setDragStartX(0);
  }, [isDragging, dragStartX, banners.length]);

  // 加载项目列表：仅依赖登录状态
  const loadProjects = useCallback(async () => {
    if (isAuthenticated) {
      try {
        const data = await projectApi.getProjects();
        setProjects(data.list || []);
      } catch {
        // 后端未启动时为空列表
      }
    } else {
      setProjects([]);
    }
  }, [isAuthenticated]);

  // 加载Banner列表
  const loadBanners = useCallback(async () => {
    try {
      const data = await bannerApi.list({ is_active: true });
      setBanners(data || []);
      // 初始化所有banner为loading状态（不触发重渲染）
      if (data && data.length > 0) {
        loadingBannersRef.current = new Set(data.map(banner => banner.id));
      }
    } catch {
      // 后端未启动时为空列表
    }
  }, []);

  // 加载 TV Show 分类标签
  const loadShowCategories = useCallback(async () => {
    try {
      const cats = await showApi.categories();
      const mapped = cats.map(c => ({ key: c.id, label: c.name }));
      setShowCategories([ALL_CATEGORY, ...mapped]);
    } catch {
      // 后端未启动时保持默认
    }
  }, []);

  // 加载视频列表：从 shows API 获取（支持分类筛选 + 关键词后端搜索）
  const loadVideos = useCallback(async (keyword?: string) => {
    setVideosLoading(true);
    setCurrentPage(1);
    setHasMore(true);
    try {
      const data = await showApi.list({
        category_id: activeCategory,
        keyword: keyword || undefined,
        page: 1,
        page_size: PAGE_SIZE,
      });
      const list: VideoListItem[] = (data.items || []).map(item => ({
        id: item.id,
        title: item.title,
        thumbnailUrl: item.thumbnail_url || undefined,
        videoUrl: item.video_url,
        duration: item.duration,
        author: item.author || 'LibTV',
        authorId: item.author_id || '',
        authorAvatar: item.author_avatar || '',
        tags: item.tags || undefined,
        category: item.category?.name,
        likes: item.likes || 0,
      }));
      setTvShowVideos(list);
      // 判断是否还有更多数据
      setHasMore(list.length >= PAGE_SIZE);
    } catch {
      setTvShowVideos([]);
      setHasMore(false);
    } finally {
      setVideosLoading(false);
    }
  }, [activeCategory]);

  // 加载更多视频（无限滚动）
  const loadMoreVideos = useCallback(async () => {
    if (loadingMore || !hasMore || videosLoading) return;
    setLoadingMore(true);
    const nextPage = currentPage + 1;
    try {
      const data = await showApi.list({
        category_id: activeCategory,
        keyword: searchKeyword.trim() || undefined,
        page: nextPage,
        page_size: PAGE_SIZE,
      });
      const newList: VideoListItem[] = (data.items || []).map(item => ({
        id: item.id,
        title: item.title,
        thumbnailUrl: item.thumbnail_url || undefined,
        videoUrl: item.video_url,
        duration: item.duration,
        author: item.author || 'LibTV',
        authorId: item.author_id || '',
        authorAvatar: item.author_avatar || '',
        tags: item.tags || undefined,
        category: item.category?.name,
        likes: item.likes || 0,
      }));
      setTvShowVideos(prev => [...prev, ...newList]);
      setCurrentPage(nextPage);
      // 如果返回的数据少于每页数量，说明没有更多了
      setHasMore(newList.length >= PAGE_SIZE);
    } catch {
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  }, [currentPage, hasMore, loadingMore, videosLoading, activeCategory, searchKeyword]);

  // 无限滚动检测器 - 监听哨兵元素进入视口
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          loadMoreVideos();
        }
      },
      { rootMargin: '200px' } // 提前200px触发加载
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreVideos]);

  // 搜索防抖
  const handleSearchChange = useCallback((value: string) => {
    setSearchKeyword(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      loadVideos(value.trim());
    }, 300);
  }, [loadVideos]);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  // 初始化：仅加载一次Banner和分类（不依赖activeCategory）
  useEffect(() => {
    const scheduleIdleTask = (callback: () => void) => {
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(callback, { timeout: 2000 });
      } else {
        setTimeout(callback, 100);
      }
    };

    scheduleIdleTask(() => {
      loadShowCategories();
      loadBanners();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // 仅在组件初始化时执行一次

  // 视频列表加载：依赖activeCategory变化
  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // 使用useMemo缓存项目列表渲染数据
  const projectListData = useMemo(() => projects, [projects]);

  // 使用useMemo缓存视频列表渲染数据
  const videoListData = useMemo(() => tvShowVideos, [tvShowVideos]);

  // Banner自动播放（使用ref保存banners.length避免重复创建interval）
  const bannersLengthRef = useRef(banners.length);
  useEffect(() => {
    bannersLengthRef.current = banners.length;
  }, [banners.length]);

  useEffect(() => {
    if (banners.length > 1) {
      bannerTimerRef.current = setInterval(() => {
        setCurrentBannerIndex((prev) => (prev + 1) % bannersLengthRef.current);
      }, 5000);
    }
    return () => {
      if (bannerTimerRef.current) {
        clearInterval(bannerTimerRef.current);
      }
    };
  }, []); // 依赖数组为空，只在挂载/卸载时执行

  // 鼠标悬停暂停/恢复轮播
  const handleBannerMouseEnter = useCallback(() => {
    if (bannerTimerRef.current) {
      clearInterval(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
  }, []);

  const handleBannerMouseLeave = useCallback(() => {
    if (banners.length > 1 && !bannerTimerRef.current) {
      bannerTimerRef.current = setInterval(() => {
        setCurrentBannerIndex((prev) => (prev + 1) % bannersLengthRef.current);
      }, 5000);
    }
  }, [banners.length]);

  // 删除项目
  const handleDeleteProject = useCallback(async (project: ProjectListItem) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除项目「${project.name}」吗？此操作不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await projectApi.deleteProject(project.id);
          setProjects((prev) => prev.filter((p) => p.id !== project.id));
          message.success('项目已删除');
        } catch {
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
        }
      },
    });
  }, [modal, message]);

  // 开始创作：未登录时弹出登录框，已登录时创建项目
  const handleCreateProject = useCallback(async () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    try {
      const project = await projectApi.createProject({
        name: '未命名',
        description: '',
      });
      navigate(`/project/${project.id}`);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    }
  }, [isAuthenticated, openLoginModal, navigate, message]);

  return (
    <div
      className="min-h-screen bg-white pb-20"
      style={{
        overflowX: 'hidden', // 防止横向滚动
      }}
    >
      {/* Banner 3D轮播图 */}
      <div
        className="relative w-full h-96 overflow-hidden mb-8 bg-gradient-to-b from-gray-900 to-gray-800 select-none"
        onMouseEnter={handleBannerMouseEnter}
        onMouseLeave={handleBannerMouseLeave}
        onMouseDown={handleDragStart}
        onMouseMove={handleDragMove}
        onMouseUp={handleDragEnd}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          contain: 'layout style paint', // CSS containment优化
        }}
      >
        {banners.length > 0 ? (
          <div
            className="relative w-full h-full flex items-center justify-center"
            style={{
              perspective: '1200px',
              willChange: 'contents', // 提示Chrome优化内容
            }}
          >
            {/* Banner 图片容器 */}
            {banners.map((banner, index) => {
              // 计算每个Banner的位置和3D效果
              let offset = index - currentBannerIndex;
              
              // 处理loop循环（仅当有多个banner时）
              if (banners.length > 1) {
                // 当当前是最后一个，下一个是第一个
                if (currentBannerIndex === banners.length - 1 && index === 0) {
                  offset = 1;
                }
                // 当当前是第一个，上一个是最后一个
                if (currentBannerIndex === 0 && index === banners.length - 1) {
                  offset = -1;
                }
              }
              
              // 只显示当前、前一个、后一个Banner
              if (offset < -1 || offset > 1) return null;
              
              // 3D变换参数
              const rotateY = -offset * 20; // 左右旋转角度（减小到30度）
              const translateX = offset * 450; // 左右平移距离（减小到320px）
              const translateZ = offset === 0 ? 0 : -150; // 深度偏移
              const scale = offset === 0 ? 1 : 0.9; // 缩放比例
              const opacity = offset === 0 ? 1 : 0.75; // 透明度
              
              return (
                <div
                  key={banner.id}
                  className="absolute"
                  style={{
                    width: '520px',
                    height: '292px',
                    transform: `translateX(${translateX}px) rotateY(${rotateY}deg) translateZ(${translateZ}px) scale(${scale})`,
                    opacity: opacity,
                    zIndex: offset === 0 ? 10 : 5,
                    willChange: 'transform, opacity', // 提示Chrome优化合成层
                    backfaceVisibility: 'hidden', // 避免渲染背面
                    transformStyle: 'preserve-3d', // 优化3D变换
                    transition: 'transform 700ms ease-out, opacity 700ms ease-out', // 只过渡必要的属性
                  }}
                >
                  <div 
                    className="w-full h-full rounded-xl overflow-hidden shadow-xl cursor-pointer relative bg-gradient-to-r from-blue-600 to-purple-700"
                    onClick={(e) => {
                      // 如果发生了拖拽，不触发点击
                      if (hasDraggedRef.current) {
                        hasDraggedRef.current = false;
                        return;
                      }
                      if (banner.link_url) {
                        window.open(banner.link_url, '_blank');
                      }
                    }}
                  >
                    {banner.image_url ? (
                      <>
                        {/* Loading骨架屏 */}
                        {loadingBannersRef.current.has(banner.id) && (
                          <div className="absolute inset-0 bg-gradient-to-r from-gray-800 to-gray-700 animate-pulse flex items-center justify-center">
                            <Spin size="large" />
                          </div>
                        )}
                        <img 
                          src={banner.image_url} 
                          alt={banner.title}
                          className={`w-full h-full object-cover transition-opacity duration-300 ${
                            loadingBannersRef.current.has(banner.id) ? 'opacity-0' : 'opacity-100'
                          }`}
                          onLoad={() => handleBannerImageLoad(banner.id)}
                          onError={() => handleBannerImageError(banner.id)}
                        />
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <div className="text-center px-6">
                          <Title level={4} className="!text-white !mb-2">{banner.title}</Title>
                          {banner.description && (
                            <Text className="text-white/80 text-sm block">{banner.description}</Text>
                          )}
                        </div>
                      </div>
                    )}
                    {banner.image_url && !loadingBannersRef.current.has(banner.id) && (
                      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent">
                        <div className="absolute bottom-3 left-3 right-3">
                          <Title level={5} className="!text-white !mb-1 !text-sm">{banner.title}</Title>
                          {banner.description && (
                            <span className="text-gray-300 text-[11px]">{banner.description}</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* 左右箭头按钮 */}
            {banners.length > 1 && (
              <>
                <button
                  className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors z-20"
                  onClick={() => {
                    setCurrentBannerIndex((prev) =>
                      prev === 0 ? banners.length - 1 : prev - 1
                    );
                  }}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <button
                  className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 hover:bg-black/70 rounded-full flex items-center justify-center text-white transition-colors z-20"
                  onClick={() => {
                    setCurrentBannerIndex((prev) =>
                      prev === banners.length - 1 ? 0 : prev + 1
                    );
                  }}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </>
            )}

            {/* 指示器 */}
            {banners.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-20">
                {banners.map((_, index) => (
                  <button
                    key={index}
                    className={`rounded-full transition-all ${
                      index === currentBannerIndex
                        ? 'w-2 h-2 bg-white'
                        : 'w-1.5 h-1.5 bg-white/50 hover:bg-white/70'
                    }`}
                    onClick={() => setCurrentBannerIndex(index)}
                    style={{ minWidth: '12px', minHeight: '12px' }}
                  />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Text className="text-white/60">暂无Banner</Text>
          </div>
        )}
      </div>

      {/* 最近项目 */}
      <section className="max-w-7xl mx-auto px-6 mb-10">
        <div className="flex items-center justify-between mb-4">
          <Text className="text-gray-600 font-medium">最近项目</Text>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {/* 新建项目卡片 */}
          <div>
            <Card
              hoverable
              className="!rounded-lg border-dashed cursor-pointer"
              styles={{ body: { padding: 0 } }}
              onClick={handleCreateProject}
            >
              <div className="h-28 bg-gray-50 flex flex-col items-center justify-center">
                <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center mb-2">
                  <PlusOutlined className="text-blue-500" />
                </div>
                <Text type="secondary" className="text-xs">开始创作</Text>
              </div>
            </Card>
          </div>

          {/* 项目列表 */}
          {projectListData.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              isAuthenticated={isAuthenticated}
              onNavigate={(id) => isAuthenticated ? navigate(`/project/${id}`) : openLoginModal()}
              onDelete={handleDeleteProject}
            />
          ))}
        </div>
      </section>

      {/* TV Show 分类 */}
      <section className="max-w-7xl mx-auto px-6">
        <Text className="text-gray-600 font-medium text-lg mb-3 block">TV Show</Text>
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2 flex-wrap flex-1">
            {showCategories.map((cat) => (
              <Tag
                key={cat.key}
                color={activeCategory === cat.key ? 'blue' : undefined}
                className={`cursor-pointer text-xs`}
                onClick={() => setActiveCategory(cat.key)}
              >
                {cat.label}
              </Tag>
            ))}
          </div>
          <div className="relative">
            <SearchOutlined className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[14px]" />
            <input
              value={searchKeyword}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="搜索视频标题、作者、标签..."
              className="w-[280px] pl-9 pr-8 py-2 text-[14px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none bg-white"
            />
            {searchKeyword && (
              <button
                onClick={() => { setSearchKeyword(''); loadVideos(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer p-0.5"
              >
                <CloseCircleOutlined className="text-[14px]" />
              </button>
            )}
          </div>
        </div>

        {/* TV Show 网格 - 使用Intersection Observer懒渲染 */}
        <Spin spinning={videosLoading}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {videoListData.map((item, index) => (
            <div
              key={item.id}
              ref={(el) => setItemRef(index, el)}
              data-index={index}
              style={{
                minHeight: '220px', // 保持高度一致，避免滚动跳动
              }}
            >
              <VideoCard
                item={item}
                onNavigate={(id) => navigate(`/videos/${id}`)}
                isVisible={visibleItems.has(index)} // 传递可见状态
              />
            </div>
          ))}
        </div>

          {/* 无限滚动哨兵元素 + 加载状态 */}
          {!videosLoading && tvShowVideos.length > 0 && (
            <div ref={sentinelRef} className="flex items-center justify-center py-8">
              {loadingMore ? (
                <div className="flex items-center gap-2 text-gray-500">
                  <Spin size="small" />
                  <span className="text-sm">加载更多...</span>
                </div>
              ) : hasMore ? (
                <div className="text-gray-300 text-sm h-8" />
              ) : (
                <div className="text-gray-400 text-sm">
                  <span className="text-gray-300">—</span> 已加载全部 <span className="text-gray-300">—</span>
                </div>
              )}
            </div>
          )}

          {/* 空状态 */}
          {!videosLoading && tvShowVideos.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <Text className="text-gray-400">暂无视频内容</Text>
            </div>
          )}
        </Spin>
      </section>
    </div>
  );
}
