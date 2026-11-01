import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortal } from 'react-dom';
import {
  Typography,
  App,
  Spin,
  Button,
} from 'antd';
import {
  ArrowRightOutlined,
  CloseCircleOutlined,
  DesktopOutlined,
  HeartOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { projectApi } from '@/services/projectApi';
import { showApi } from '@/services/showApi';
import { bannerApi, type BannerItem } from '@/services/bannerApi';
import { useAuthStore } from '@/stores/authStore';
import { ProjectCard, CreateProjectCard } from '@/components/project/ProjectCard';
import type { ProjectListItem } from '@/types/project';
import type { VideoListItem } from '@/types/video';
import { usePageMeta } from '@/hooks/usePageMeta';
import { Z } from '@/utils/zLayers';
import { EmptyState } from '@/components/common/EmptyState';
import './home.css';

const { Title, Text } = Typography;

// TV Show 分类（从 API 加载，初始含"全部"选项）
const ALL_CATEGORY = { key: 'all', label: '全部' };

const formatDuration = (seconds: number) => {
  if (seconds === 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

// 项目卡片组件已抽取到 @/components/project/ProjectCard（首页与「我的项目」页共用）

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
  // 描述 tooltip 跟随鼠标：
  // - 用 portal 挂到 body，否则会被外层滚动容器（overflow: auto）裁掉
  // - 位置直接写 DOM 的 transform，不走 state：鼠标一移动就 setState 会让整卡高频重渲染
  const [tipOn, setTipOn] = useState(false);
  const [failedThumbnail, setFailedThumbnail] = useState('');
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const posRef = useRef({ x: 0, y: 0 });

  const placeTip = (x: number, y: number) => {
    const el = tipRef.current;
    if (!el) return;
    // 用实测尺寸，不要用 max-w 常量：文字短时实际宽度远小于 280
    const W = el.offsetWidth || 280;
    const H = el.offsetHeight || 60;
    const M = 8; // 视口内安全边距
    const clamp = (v: number, max: number) => Math.min(Math.max(M, v), Math.max(M, max));

    // 水平：tooltip 中点对准鼠标（不左右翻转——翻到另一侧会“瞬间跳过去”）
    // 垂直：在光标下方 18px（不上下翻转，同理）
    // 两边都只做贴边夹取，越界时停在边缘而不是换边，移动过程中位置是连续变化的
    const left = clamp(x - W / 2, window.innerWidth - W - M);
    const top = clamp(y + 18, window.innerHeight - H - M);
    el.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  };

  useEffect(() => {
    if (tipOn) placeTip(posRef.current.x, posRef.current.y);
  }, [tipOn]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const handleEnter = (e: React.MouseEvent) => {
    posRef.current = { x: e.clientX, y: e.clientY };
    if (timerRef.current) window.clearTimeout(timerRef.current);
    // 轻微延迟：鼠标扫过一排卡片时不会闪出一串框
    timerRef.current = window.setTimeout(() => setTipOn(true), 120);
  };
  const handleMove = (e: React.MouseEvent) => {
    posRef.current = { x: e.clientX, y: e.clientY };
    if (tipOn) placeTip(e.clientX, e.clientY);
  };
  const handleLeave = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setTipOn(false);
  };

  // 只在可见时渲染完整内容，否则只渲染占位符（占位符与卡片同为 16:9，避免布局偏移）
  if (!isVisible) {
    return (
      <div className="video-card-placeholder" aria-hidden="true" />
    );
  }

  // 封面与文字分区：在窄屏上仍可读到标题，不遮挡作品画面。
  return (
    <button
      type="button"
      aria-label={`播放视频：${item.title}`}
      className="video-card"
      style={{
        contain: 'layout style',
      }}
      onClick={() => onNavigate(item.id)}
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="video-card-preview">
      {item.thumbnailUrl && item.thumbnailUrl !== failedThumbnail ? <img
        src={item.thumbnailUrl}
        alt=""
        className="video-card-media"
        loading="lazy"
        decoding="async" // 异步解码，避免阻塞主线程
        onError={() => setFailedThumbnail(item.thumbnailUrl)}
      /> : <div className="video-card-fallback"><VideoCameraOutlined /><span>封面暂不可用</span></div>}
      {/* 分类与标签：左上角 */}
      {(item.category || (item.tags?.length || 0) > 0) && (
        <div className="video-card-tags">
          {item.category && (
            <span>{item.category}</span>
          )}
          {(item.tags || []).slice(0, 2).map(tag => (
            <span key={tag} className="video-card-tag-secondary">{tag}</span>
          ))}
        </div>
      )}
      {/* 播放提示：hover 时收拢暗幕并点亮，键盘聚焦同样可见 */}
      <div className="video-card-overlay absolute inset-0 z-10 flex items-center justify-center bg-black/0 opacity-0">
        <span className="video-card-play flex h-12 w-12 items-center justify-center rounded-full bg-black/55 text-white">
          <PlayCircleOutlined style={{ fontSize: '38px' }} />
        </span>
      </div>
      {item.duration > 0 && <span className="video-card-duration">{formatDuration(item.duration)}</span>}
      </div>
      <div className="video-card-caption">
        <p className="video-card-title" title={item.title}>
          {item.title}
        </p>
        <div className="video-card-meta">
          {/* 作者信息：优先用作者真实头像，缺失时用作者首字占位 */}
          <div className="video-card-author" title={item.author}>
            {item.authorAvatar ? (
              <img src={item.authorAvatar} alt="" className="w-4 h-4 shrink-0 rounded-full border border-white/50 object-cover" loading="lazy" decoding="async" />
            ) : (
              <div className="w-4 h-4 shrink-0 rounded-full border border-white/50 bg-gray-500 text-white text-[8px] flex items-center justify-center">{item.author.slice(0, 1)}</div>
            )}
            <span className="truncate text-[11px] text-white/90">{item.author}</span>
          </div>
          <span className="video-card-likes"><HeartOutlined />{item.likes >= 10000 ? `${(item.likes / 10000).toFixed(1)}万` : item.likes}</span>
        </div>
      </div>

      {/* 描述 tooltip：挂在 body 上（不受卡片与外层滚动容器裁剪），跟随鼠标；
          pointer-events-none 保证它不抢下面卡片的 hover。只有填了描述的视频才提示。 */}
      {tipOn && item.description && createPortal(
        <div
          ref={tipRef}
          className="pointer-events-none fixed left-0 top-0 will-change-transform"
          style={{ zIndex: Z.canvasFloat }}
        >
          <div className="line-clamp-4 max-w-[280px] rounded-lg bg-[var(--dv-canvas-bg)] px-2.5 py-1.5 text-[12px] leading-5 text-white shadow-lg">
            {item.description}
          </div>
        </div>,
        document.body,
      )}
    </button>
  );
});

// Intersection Observer Hook - 检测元素是否在可视区域
function useIntersectionObserver(threshold = 0.1) {
  const [visibleItems, setVisibleItems] = useState<Set<number>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const toAdd: number[] = [];
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            toAdd.push(Number(entry.target.getAttribute('data-index')));
          }
        });
        if (toAdd.length === 0) return;
        // 只在确有新增可见项时更新，避免连锁重渲染
        setVisibleItems(prev => {
          if (!toAdd.some(i => !prev.has(i))) return prev;
          const next = new Set(prev);
          toAdd.forEach(i => next.add(i));
          return next;
        });
      },
      {
        threshold,
        rootMargin: '100px', // 提前100px开始渲染
      }
    );
    observerRef.current = observer;

    // 观察所有item
    itemRefs.current.forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [threshold]); // observer 只创建一次，不依赖 visibleItems

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

  // 重置可见状态（切换标签时使用，避免旧索引残留）；可同时预标记前 seedCount 项为可见，避免占位符闪现一帧
  const resetVisibleItems = useCallback((seedCount = 0) => {
    itemRefs.current.clear();
    setVisibleItems(new Set(Array.from({ length: seedCount }, (_, i) => i)));
  }, []);

  return { visibleItems, setItemRef, resetVisibleItems };
}

export default function VideoListPage() {
  // 首页是公开作品广场，是最主要的收录入口
  usePageMeta({
    title: 'AI 视频创作工作台',
    description:
      '一句话或一张图，生成分镜脚本与成片。在漫蛙浏览公开作品、看别人的创作参数与提示词：文生视频、图生视频、首尾帧、参考图生成与视频清晰化。',
  });
  const { message, modal } = App.useApp();
  const [activeCategory, setActiveCategory] = useState('all');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [projectTotal, setProjectTotal] = useState(0); // 项目总数（判断要不要显示「查看全部」）
  const [tvShowVideos, setTvShowVideos] = useState<VideoListItem[]>([]);
  const [showCategories, setShowCategories] = useState<{ key: string; label: string }[]>([ALL_CATEGORY]);
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [currentBannerIndex, setCurrentBannerIndex] = useState(0);
  // 轮播容器宽度：卡片尺寸/位移本来写死 520×292 + translateX(450)，在 390px 手机视口下
  // 相邻卡片会整块跑到屏幕外。这里按容器宽度换算，桌面端取原值不变。
  const [bannerBoxW, setBannerBoxW] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const loadingBannersRef = useRef<Set<string>>(new Set()); // 用ref跟踪loading状态，不触发重渲染
  // 跟随窗口宽度更新轮播容器宽度（轮播是整宽容器，直接用 innerWidth）
  useEffect(() => {
    const onResize = () => setBannerBoxW(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const [, forceUpdate] = useState(0); // 用于强制更新loading状态
  const [isDragging, setIsDragging] = useState(false); // 是否正在拖拽
  const [dragStartX, setDragStartX] = useState(0); // 拖拽起始X坐标
  const hasDraggedRef = useRef(false); // 是否发生了拖拽（用于区分点击和拖拽）
  const navigate = useNavigate();
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  const openBanner = (link?: string) => {
    if (!link) return;
    const target = link.trim();
    if (target.startsWith('/')) navigate(target);
    else window.open(target, '_blank', 'noopener,noreferrer');
  };
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
  const tvSectionRef = useRef<HTMLElement>(null);
  const loadSeqRef = useRef(0); // 请求序号：快速切换标签时使过期请求的响应作废，避免旧数据闪回列表

  // Intersection Observer - 检测视频列表中哪些项在可视区域
  const { visibleItems, setItemRef, resetVisibleItems } = useIntersectionObserver(0.05);

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

  // 加载项目列表：仅依赖登录状态；首页只取第一页（网格最多展示两行，超出走「我的项目」页）
  const loadProjects = useCallback(async () => {
    if (isAuthenticated) {
      try {
        const data = await projectApi.getProjects(1, 19);
        setProjects(data.list || []);
        setProjectTotal(data.total || 0);
      } catch {
        // 后端未启动时为空列表
      }
    } else {
      setProjects([]);
      setProjectTotal(0);
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
    const seq = ++loadSeqRef.current;
    setVideosLoading(true);
    setVideosError(false);
    setCurrentPage(1);
    setHasMore(true);
    try {
      const data = await showApi.list({
        category_id: activeCategory,
        keyword: keyword || undefined,
        page: 1,
        page_size: PAGE_SIZE,
      });
      if (seq !== loadSeqRef.current) return; // 已有更新的请求，丢弃过期响应
      const list: VideoListItem[] = (data.items || []).map(item => ({
        id: item.id,
        title: item.title,
        thumbnailUrl: item.thumbnail_url || undefined,
        videoUrl: item.video_url,
        duration: item.duration,
        author: item.author || '漫蛙AI',
        authorId: item.author_id || '',
        authorAvatar: item.author_avatar || '',
        tags: item.tags || undefined,
        category: item.category?.name,
        likes: item.likes || 0,
        description: item.description || undefined,
      }));
      setTvShowVideos(list);
      // 判断是否还有更多数据
      setHasMore(list.length >= PAGE_SIZE);
      setVideosLoading(false);
    } catch {
      if (seq !== loadSeqRef.current) return;
      setTvShowVideos([]);
      setVideosError(true);
      setHasMore(false);
      setVideosLoading(false);
    }
  }, [activeCategory]);

  // 加载更多视频（无限滚动）
  const loadMoreVideos = useCallback(async () => {
    if (loadingMore || !hasMore || videosLoading) return;
    const seq = loadSeqRef.current;
    setLoadingMore(true);
    const nextPage = currentPage + 1;
    try {
      const data = await showApi.list({
        category_id: activeCategory,
        keyword: searchKeyword.trim() || undefined,
        page: nextPage,
        page_size: PAGE_SIZE,
      });
      // 期间切换了标签/搜索：旧分类的追加结果作废，避免串数据
      if (seq !== loadSeqRef.current) return;
      const newList: VideoListItem[] = (data.items || []).map(item => ({
        id: item.id,
        title: item.title,
        thumbnailUrl: item.thumbnail_url || undefined,
        videoUrl: item.video_url,
        duration: item.duration,
        author: item.author || '漫蛙AI',
        authorId: item.author_id || '',
        authorAvatar: item.author_avatar || '',
        tags: item.tags || undefined,
        category: item.category?.name,
        likes: item.likes || 0,
        description: item.description || undefined,
      }));
      setTvShowVideos(prev => [...prev, ...newList]);
      setCurrentPage(nextPage);
      // 如果返回的数据少于每页数量，说明没有更多了
      setHasMore(newList.length >= PAGE_SIZE);
    } catch {
      if (seq === loadSeqRef.current) setHasMore(false);
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

  // 切换标签：同一帧立即拉起 loading 遮罩，数据返回后再整体替换，避免遮罩出现前旧列表裸闪
  const handleCategoryChange = useCallback((key: string) => {
    if (key === activeCategory) return;
    setVideosLoading(true); // 同步置位，与标签切换同一帧渲染出遮罩
    resetVisibleItems(PAGE_SIZE); // 预标记首屏为可见，数据替换后占位符不闪现
    setTvShowVideos(prev => prev.slice(0, PAGE_SIZE)); // 丢弃旧分类滚动加载的多余数据
    setActiveCategory(key);
    requestAnimationFrame(() => {
      tvSectionRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  }, [activeCategory, resetVisibleItems]);

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
    if (banners.length > 1 && !reducedMotion) {
      bannerTimerRef.current = setInterval(() => {
        setCurrentBannerIndex((prev) => (prev + 1) % bannersLengthRef.current);
      }, 5000);
    }
    return () => {
      if (bannerTimerRef.current) {
        clearInterval(bannerTimerRef.current);
        bannerTimerRef.current = null;
      }
    };
  }, [banners.length, reducedMotion]);

  // 鼠标悬停暂停/恢复轮播
  const handleBannerMouseEnter = useCallback(() => {
    if (bannerTimerRef.current) {
      clearInterval(bannerTimerRef.current);
      bannerTimerRef.current = null;
    }
  }, []);

  const handleBannerMouseLeave = useCallback(() => {
    if (banners.length > 1 && !bannerTimerRef.current && !reducedMotion &&
      !document.activeElement?.closest('.home-recommendations')) {
      bannerTimerRef.current = setInterval(() => {
        setCurrentBannerIndex((prev) => (prev + 1) % bannersLengthRef.current);
      }, 5000);
    }
  }, [banners.length, reducedMotion]);

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
    if (creatingProject) return;
    setCreatingProject(true);
    try {
      const project = await projectApi.createProject({
        name: '未命名',
        description: '',
      });
      message.success('创作空间已就绪');
      navigate(`/project/${project.id}`);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setCreatingProject(false);
    }
  }, [creatingProject, isAuthenticated, openLoginModal, navigate, message]);

  return (
    <div
      className="min-h-screen home-bg pb-20"
      style={{
        overflowX: 'hidden', // 防止横向滚动
      }}
    >
      {/* Banner 3D轮播图
          注意：这个容器是拖拽切换的，inline 设了 cursor: grab（拖拽时 grabbing），
          所以里面所有可点元素都必须自己声明 cursor-pointer —— 否则 hover 上去
          显示的是"抓手"，看不出能点（左右箭头、指示点都踩过这个）。 */}
      <div
        className="home-recommendations tech-hero relative mb-6 h-64 w-full select-none overflow-hidden md:mb-8 md:h-[22rem]"
        role="region"
        aria-label="精选推荐"
        onMouseEnter={handleBannerMouseEnter}
        onMouseLeave={handleBannerMouseLeave}
        onFocusCapture={handleBannerMouseEnter}
        onBlurCapture={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) handleBannerMouseLeave();
        }}
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
              // 移动端：卡片按容器宽度收缩（最多 84vw），位移同步收缩，保证前后两张卡片露在屏幕内；
              // 桌面端（≥768px）保持原来的 520×292 / 位移 450 不变。
              const bannerCardW = Math.round(Math.min(520, bannerBoxW * 0.84));
              const bannerCardH = Math.round((bannerCardW * 292) / 520);
              const bannerOffsetX = bannerBoxW < 768 ? Math.round(bannerCardW * 0.88) : 450;
              const rotateY = -offset * 20; // 左右旋转角度（减小到30度）
              const translateX = offset * bannerOffsetX; // 左右平移距离
              const translateZ = offset === 0 ? 0 : -150; // 深度偏移
              const scale = offset === 0 ? 1 : 0.9; // 缩放比例
              const opacity = offset === 0 ? 1 : 0.75; // 透明度
              
              return (
                <div
                  key={banner.id}
                  className="absolute"
                  style={{
                    width: `${bannerCardW}px`,
                    height: `${bannerCardH}px`,
                    transform: `translateX(${translateX}px) rotateY(${rotateY}deg) translateZ(${translateZ}px) scale(${scale})`,
                    opacity: opacity,
                    zIndex: offset === 0 ? 10 : 5,
                    willChange: 'transform, opacity', // 提示Chrome优化合成层
                    backfaceVisibility: 'hidden', // 避免渲染背面
                    transformStyle: 'preserve-3d', // 优化3D变换
                    transition: reducedMotion ? 'none' : 'transform 350ms ease-out, opacity 350ms ease-out',
                  }}
                >
                  <div 
                    className="home-banner-card w-full h-full rounded-xl overflow-hidden relative"
                    role={banner.link_url ? 'link' : undefined}
                    tabIndex={banner.link_url && offset === 0 ? 0 : -1}
                    aria-label={banner.title}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && banner.link_url) { event.preventDefault(); openBanner(banner.link_url); }
                    }}
                    onClick={() => {
                      // 如果发生了拖拽，不触发点击
                      if (hasDraggedRef.current) {
                        hasDraggedRef.current = false;
                        return;
                      }
                      openBanner(banner.link_url);
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
                    className={`h-full w-full object-cover transition-opacity duration-300 ${
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
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/5 to-transparent">
                        <div className="absolute bottom-4 left-4 right-4">
                          <Title level={5} className="!text-white !mb-1 !text-sm [text-shadow:0_2px_16px_rgba(0,0,0,0.8)]">{banner.title}</Title>
                          {banner.description && (
                            <span className="line-clamp-2 text-gray-300 text-[11px] leading-5">{banner.description}</span>
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
                  aria-label="上一个推荐"
                  className="tech-arrow absolute left-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-white backdrop-blur-md transition-colors hover:border-cyan-200/35 hover:bg-cyan-300/15 md:left-4 md:h-10 md:w-10"
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
                  aria-label="下一个推荐"
                  className="tech-arrow absolute right-2 top-1/2 z-20 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-white backdrop-blur-md transition-colors hover:border-cyan-200/35 hover:bg-cyan-300/15 md:right-4 md:h-10 md:w-10"
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

            {/* 指示器：叠在彩色 banner 上，必须保持浅色（用任意值写法绕开暗色主题对
                bg-white 的"面板化"映射，否则会被映射成近黑底而看不见） */}
            {banners.length > 1 && (
              <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/25 px-2 py-1.5 backdrop-blur-sm">
                {banners.map((_, index) => (
                  <button
                    key={index}
                    aria-label={`切换到第 ${index + 1} 个推荐`}
                    aria-current={index === currentBannerIndex ? 'true' : undefined}
                    className={`rounded-full transition-all cursor-pointer ${
                      index === currentBannerIndex
                        ? 'h-1.5 w-5 bg-cyan-200 shadow-[0_0_12px_rgba(165,243,252,0.6)]'
                        : 'h-1.5 w-1.5 bg-white/45 hover:bg-white/80'
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
            <Text className="text-white/60">暂无精选推荐</Text>
          </div>
        )}
      </div>

      {/* 最近项目（最多展示两行，超出走「我的项目」页）
          移动端（<768px）不提供这一板块：hidden 即不渲染占位，想看完整列表走「我的项目」页 */}
      <section className="home-recent-projects hidden md:block max-w-7xl mx-auto px-6 mb-10" aria-labelledby="recent-projects-title">
        <div className="mb-4 flex items-end justify-between">
          <div>
            <h2 id="recent-projects-title" className="library-section-title">最近项目</h2>
            <p className="library-section-description">继续你的创作，或从一张新画布开始。</p>
          </div>
          {isAuthenticated && (
            <button type="button"
              className="group inline-flex items-center gap-1 text-[13px] text-gray-800 hover:opacity-75 cursor-pointer transition-opacity"
              onClick={() => navigate('/projects')}
            >
              查看全部
              <span className="text-gray-400 transition-colors group-hover:text-gray-500">({projectTotal})</span>
              {/* 箭头用图标而不是「→」：字符在不同字体下形状/粗细/基线都不受控，看着毛糙；
                  图标能和文字对齐，hover 时轻微右移，做出"点得进去"的暗示 */}
              <ArrowRightOutlined className="text-[11px] transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          )}
        </div>
        {/* 只显示两行（超过 19 个的走「我的项目」页），由 .recent-projects-grid 的
            媒体查询按断点把多余格子 display:none —— 不用 max-h + overflow-hidden 裁：
            裁切层会把卡片 hover 上移的那 2px 连同顶边/圆角、以及第二行的 hover 阴影一起切掉。 */}
        <div className="recent-projects-grid grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2 md:gap-3">
          {/* 新建项目卡片 */}
          <CreateProjectCard onClick={handleCreateProject} loading={creatingProject} />

          {/* 项目列表 */}
          {projectListData.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onNavigate={(id) => isAuthenticated ? navigate(`/project/${id}`) : openLoginModal()}
              onDelete={handleDeleteProject}
            />
          ))}
        </div>
      </section>

      {/* TV Show 分类 */}
      {/* 移动端提醒（<768px 才显示）：移动端没有进入画布的入口，这里说明创作请用 PC */}
      <div className="md:hidden max-w-7xl mx-auto px-3 mb-3">
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800">
          <DesktopOutlined className="mt-0.5 shrink-0" />
          <span>
            移动端仅支持浏览作品，<b>创作（画布生成剧本 / 图片 / 视频）请用 PC 端浏览器打开</b>。
          </span>
        </div>
      </div>

      <section ref={tvSectionRef} className="home-gallery max-w-7xl mx-auto px-3 md:px-6 scroll-mt-4" aria-labelledby="gallery-title">
        <div className="mb-3 flex items-center gap-3">
          <h1 id="gallery-title" className="library-section-title">作品广场</h1>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 mb-4">
          <div className="flex items-center gap-2 flex-wrap flex-1">
            {showCategories.map((cat) => (
              <button
                type="button"
                key={cat.key}
                aria-pressed={activeCategory === cat.key}
                className={`home-category tech-filter cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-all ${
                  activeCategory === cat.key
                    ? 'border-cyan-300/45 bg-cyan-400/15 font-medium text-cyan-100'
                    : 'border-white/[0.07] bg-white/[0.025] text-[var(--dv-text-3)] hover:border-white/15 hover:bg-white/[0.05] hover:text-[var(--dv-text-1)]'
                }`}
                onClick={() => handleCategoryChange(cat.key)}
              >
                {cat.label}
              </button>
            ))}
          </div>
          <div className="tech-search relative">
            <SearchOutlined className={`absolute left-3 top-1/2 -translate-y-1/2 text-[14px] transition-colors ${videosLoading ? 'animate-pulse text-cyan-300' : 'text-gray-400'}`} />
            <input
              value={searchKeyword}
              onChange={e => handleSearchChange(e.target.value)}
              placeholder="搜索视频标题、作者、标签..."
              aria-label="搜索视频"
              className="tech-search-input w-full rounded-xl py-2 pl-9 pr-8 text-[14px] outline-none transition-all sm:w-[280px]"
            />
            {searchKeyword && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => { setSearchKeyword(''); loadVideos(); }}
                className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-gray-400 transition-colors hover:text-cyan-200 active:scale-90"
              >
                <CloseCircleOutlined className="text-[14px]" />
              </button>
            )}
          </div>
        </div>

        {/* TV Show 网格 - 切换时遮罩 loading，数据返回后整体替换；固定最小高度放在总容器上，切换时内容区不塌陷 */}
        <Spin spinning={videosLoading && tvShowVideos.length > 0} tip={searchKeyword ? '正在搜索作品…' : '正在载入作品…'}>
          <div style={{ minHeight: '440px' }}>
            {videosLoading && tvShowVideos.length === 0 && (
              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3" role="status" aria-label="正在加载作品">
                {Array.from({ length: 8 }, (_, index) => <div key={index} className="video-card-placeholder" />)}
              </div>
            )}
            {/* 缩略图间距收紧到 8px（原 16px）：无边框后 16px 会显得空 */}
            <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-3">
            {videoListData.map((item, index) => (
              <div
                key={item.id}
                ref={(el) => setItemRef(index, el)}
                data-index={index}
                className="min-w-0"
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

            {/* 空状态：在固定高度容器内居中，文案样式与“已加载全部”一致 */}
            {!videosLoading && tvShowVideos.length === 0 && (
              <EmptyState className="min-h-[300px]" icon={<VideoCameraOutlined />}
                title={videosError ? '作品暂时无法加载' : searchKeyword ? '没有找到匹配的作品' : '这个分类还没有作品'}
                hint={videosError ? '网络可能暂时中断，可以重新加载。' : searchKeyword ? '试试其他关键词，或清空搜索查看作品。' : '换个分类看看，或到画布创作你的作品。'}
                action={videosError
                  ? <Button onClick={() => void loadVideos(searchKeyword)}>重新加载</Button>
                  : searchKeyword ? <Button onClick={() => { setSearchKeyword(''); void loadVideos(); }}>清空搜索</Button> : undefined} />
            )}
          </div>
        </Spin>
      </section>
    </div>
  );
}
