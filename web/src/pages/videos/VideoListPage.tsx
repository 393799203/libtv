import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Typography,
  Button,
  Input,
  Dropdown,
  Tag,
  App,
} from 'antd';
import {
  PlusOutlined,
  PlayCircleOutlined,
  MoreOutlined,
  SearchOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Swiper, SwiperSlide } from 'swiper/react';
import { EffectCoverflow, Pagination, Autoplay } from 'swiper/modules';
import 'swiper/css';
import 'swiper/css/effect-coverflow';
import 'swiper/css/pagination';
import { Modal } from 'antd';
import { projectApi } from '@/services/projectApi';
import { videoApi } from '@/services/videoApi';
import { useAuthStore } from '@/stores/authStore';
import type { ProjectListItem } from '@/types/project';
import type { VideoListItem } from '@/types/video';

const { Title, Text } = Typography;
const { Search } = Input;

// 轮播图数据
const carouselItems = [
  { id: '1', title: 'SD2 买多少送多少', subtitle: 'SD6 在电商做图上，真是包打天下', buttonText: '立即下单', imageColor: 'from-blue-600 to-purple-700' },
  { id: '2', title: 'LibTV 大乱斗 Vol.2', subtitle: '5.18 - 6.4 精彩呈现', buttonText: 'AI，想象和尖叫', imageColor: 'from-cyan-500 to-blue-600' },
  { id: '3', title: '团队协作 正式上线', subtitle: '邀请你的小伙伴，一起做视频！', buttonText: '了解更多', imageColor: 'from-gray-800 to-gray-900' },
  { id: '4', title: '全新 AI 引擎', subtitle: '更快、更强、更智能', buttonText: '体验新功能', imageColor: 'from-orange-500 to-red-600' },
  { id: '5', title: '海量素材库', subtitle: '百万级素材，轻松创作', buttonText: '查看素材', imageColor: 'from-green-500 to-teal-600' },
];

// TV Show 分类
const tvShowCategories = [
  { key: 'all', label: '全部' },
  { key: 'douyin', label: '抖音 | v4.1 竖版笔记' },
  { key: 'kuaishou', label: '快手 | v2 AI，经典构图风格' },
  { key: 'professional', label: '专业电影' },
  { key: 'fullscreen', label: '全屏影视' },
  { key: 'picturebook', label: '图画书故事' },
  { key: 'shortfilm', label: '短片电影' },
  { key: 'ads', label: '商业广告' },
  { key: 'education', label: '教育游戏' },
  { key: 'daily', label: '教育生活' },
  { key: 'tvshow', label: 'TV工具箱' },
];

const formatDuration = (seconds: number) => {
  if (seconds === 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

export default function VideoListPage() {
  const { message } = App.useApp();
  const [activeCategory, setActiveCategory] = useState('all');
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [tvShowVideos, setTvShowVideos] = useState<VideoListItem[]>([]);
  const navigate = useNavigate();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);

  // 加载数据
  const loadData = useCallback(async () => {
    // 项目列表：仅登录后调用
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

    // 视频列表：无需登录即可获取
    try {
      const data = await videoApi.getVideos();
      setTvShowVideos(data.list || []);
    } catch {
      setTvShowVideos(videoApi.getTvShowVideos());
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 登录状态变化时刷新数据
  useEffect(() => {
    loadData();
  }, [isAuthenticated, loadData]);

  const getVideoMenuItems = (_id: string): MenuProps['items'] => [
    { key: 'download', label: '下载' },
    { key: 'share', label: '分享' },
    { key: 'delete', label: '删除', danger: true },
  ];

  // 删除项目
  const handleDeleteProject = async (project: ProjectListItem) => {
    Modal.confirm({
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
          message.error('删除失败，请重试');
        }
      },
    });
  };

  // 开始创作：未登录时弹出登录框，已登录时创建项目
  const handleCreateProject = async () => {
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
      message.error('创建项目失败，请检查网络连接');
    }
  };

  return (
    <div className="min-h-screen bg-white pb-20">
      {/* 3D 轮播图 */}
      <div className="relative w-full h-80 overflow-hidden mb-10 bg-gradient-to-b from-gray-900 to-gray-800">
        <Swiper
          loop={true}
          effect={'coverflow'}
          grabCursor={true}
          centeredSlides={true}
          slidesPerView={'auto'}
          coverflowEffect={{
            rotate: 30,
            stretch: 0,
            depth: 200,
            modifier: 1,
            slideShadows: true,
          }}
          pagination={{ clickable: true }}
          autoplay={{
            delay: 3000,
            disableOnInteraction: false,
          }}
          modules={[EffectCoverflow, Pagination, Autoplay]}
          className="w-full h-full"
          style={{ padding: '60px 0' }}
        >
          {carouselItems.map((item) => (
            <SwiperSlide key={item.id} style={{ width: '700px', height: '320px' }}>
              <div className={`w-full h-full rounded-2xl bg-gradient-to-r ${item.imageColor} flex items-center justify-center shadow-2xl`}>
                <div className="absolute inset-0 bg-black/30 rounded-2xl" />
                <div className="relative z-10 text-center px-8 max-w-lg">
                  <Title level={2} className="!text-white !mb-3">{item.title}</Title>
                  <Text className="text-white/80 text-lg block mb-6">{item.subtitle}</Text>
                  <Button type="primary" size="large" ghost className="!border-white !text-white hover:!bg-white hover:!text-gray-900">
                    {item.buttonText}
                  </Button>
                </div>
              </div>
            </SwiperSlide>
          ))}
        </Swiper>
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
          {projects.map((project) => (
            <div
              key={project.id}
              className="h-28 bg-gray-100 relative rounded-lg overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => isAuthenticated ? navigate(`/project/${project.id}`) : openLoginModal()}
            >
              {project.coverUrl ? (
                <img src={project.coverUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-cyan-500">
                  <img src={`https://picsum.photos/200/150?random=${project.id}`} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <button
                className="absolute top-1 right-1 z-10 w-6 h-6 flex items-center justify-center rounded bg-black/50 text-white hover:bg-red-500 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteProject(project);
                }}
                title="删除项目"
              >
                <DeleteOutlined style={{ fontSize: 12 }} />
              </button>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                <p className="!text-white !text-xs truncate">{project.name}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* TV Show 分类 */}
      <section className="max-w-7xl mx-auto px-6">
        <div className="flex items-center justify-between mb-4">
          <Text className="text-gray-600 font-medium">TV Show</Text>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              {tvShowCategories.map((cat) => (
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
            <Search
              placeholder="请输入搜索内容"
              prefix={<SearchOutlined />}
              style={{ width: 200 }}
              size="small"
            />
          </div>
        </div>

        {/* TV Show 网格 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tvShowVideos.map((item) => (
            <div key={item.id}>
              <Card
                hoverable
                className="!rounded-lg overflow-hidden cursor-pointer"
                styles={{ body: { padding: 0 } }}
                onClick={() => navigate(`/videos/${item.id}`)}
              >
                <div className="h-40 bg-gray-100 relative overflow-hidden">
                  <img src={item.thumbnailUrl || `https://picsum.photos/400/225?random=${item.id}`} alt={item.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100 z-10">
                    <PlayCircleOutlined style={{ fontSize: '48px', color: 'white' }} />
                  </div>
                  {item.duration > 0 && (
                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded z-20">
                      {formatDuration(item.duration)}
                    </div>
                  )}
                  {/* 头像 + 作者名，叠加在图片上 */}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1 z-20">
                    <img src={`https://picsum.photos/16/16?random=${item.author}`} alt="" className="w-4 h-4 rounded-full border border-white/50" />
                    <span className="text-white text-[11px] drop-shadow-sm truncate max-w-[100px]">{item.author}</span>
                  </div>
                </div>
                <div className="p-3">
                  <div className="flex items-start justify-between">
                    <p className="!text-sm font-medium truncate">
                      {item.title}
                    </p>
                    <Dropdown menu={{ items: getVideoMenuItems(item.id) }} placement="bottomRight" trigger={['click']}>
                      <Button
                        type="text"
                        size="small"
                        icon={<MoreOutlined />}
                        className="!-mt-1 flex-shrink-0"
                        onClick={(e) => e.stopPropagation()}
                      />
                    </Dropdown>
                  </div>
                  <div className="mt-1">
                    {item.tags?.map((tag, i) => (
                      <span key={i} className="text-gray-400 !text-[10px] mr-1">#{tag}</span>
                    ))}
                  </div>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
