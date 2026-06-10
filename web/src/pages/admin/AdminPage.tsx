import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { message, Select } from 'antd';
import {
  TagOutlined,
  SettingOutlined,
  FolderAddOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  UploadOutlined,
  HeartFilled,
  UserOutlined,
  VideoCameraOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import { styleApi, type StyleItem, type CategoryItem } from '@/services/styleApi';
import { showApi, type ShowItem, type ShowCategoryItem } from '@/services/showApi';
import { userApi, type UserItem } from '@/services/userApi';
import { uploadVideo } from '@/services/uploadApi';

type AdminTab = 'shows' | 'styles' | 'users' | 'settings';

export default function AdminPage() {
  const navigate = useNavigate();
  const { tab = 'shows' } = useParams<{ tab: string }>();
  const activeTab: AdminTab = (tab as AdminTab) || 'shows';

  // ========== 风格管理状态 ==========
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [showNewCatDialog, setShowNewCatDialog] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  // 添加/编辑弹窗（复用：editingStyle=null 为新建，有值为编辑）
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', author: '', tags: '' });
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addPreviewUrl, setAddPreviewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [editingStyle, setEditingStyle] = useState<StyleItem | null>(null); // 编辑时传入当前风格数据
  const addFileRef = useRef<HTMLInputElement>(null);

  // ========== 用户管理状态 ==========
  const [users, setUsers] = useState<UserItem[]>([]);
  const [userLoading, setUserLoading] = useState(false);

  // ========== 首页管理状态 ==========
  const [showCategories, setShowCategories] = useState<ShowCategoryItem[]>([]);
  const [shows, setShows] = useState<ShowItem[]>([]);
  const [showsLoading, setShowsLoading] = useState(false);
  const [activeShowCategory, setActiveShowCategory] = useState<string>('');
  const [showNewShowCatDialog, setShowNewShowCatDialog] = useState(false);
  const [newShowCatName, setNewShowCatName] = useState('');
  const [creatingShowCat, setCreatingShowCat] = useState(false);
  const [showAddShowDialog, setShowAddShowDialog] = useState(false);
  const [addShowForm, setAddShowForm] = useState({ title: '', description: '', video_url: '', author_id: '', duration: 0, tags: '' });
  const [addShowFile, setAddShowFile] = useState<File | null>(null);
  const [addShowPreviewUrl, setAddShowPreviewUrl] = useState('');
  const [addShowVideoFile, setAddShowVideoFile] = useState<File | null>(null);
  const [addShowVideoName, setAddShowVideoName] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoUploadProgress, setVideoUploadProgress] = useState(0);
  const [videoUploadedUrl, setVideoUploadedUrl] = useState('');
  const [videoPreviewUrl, setVideoPreviewUrl] = useState(''); // 填写地址后用于预览视频
  const [playingShowId, setPlayingShowId] = useState<string | null>(null); // 列表卡片正在播放的 show ID
  const [addingShow, setAddingShow] = useState(false);
  const [editingShow, setEditingShow] = useState<ShowItem | null>(null);
  const [authorOptions, setAuthorOptions] = useState<UserItem[]>([]);
  const [authorSearching, setAuthorSearching] = useState(false);
  const authorFetchIdRef = useRef(0);
  const authorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 远程搜索作者（防抖 + 请求时序控制）
  const fetchAuthors = (keyword: string) => {
    const fetchId = ++authorFetchIdRef.current;

    // 防抖：仅对用户输入生效，首次加载（空keyword）立即执行
    const needDebounce = keyword.trim().length > 0;
    if (needDebounce && authorDebounceRef.current) clearTimeout(authorDebounceRef.current);

    const doFetch = async () => {
      setAuthorSearching(true);
      try {
        const res = await userApi.search(keyword.trim());
        // 只接受最后一次请求的结果
        if (fetchId === authorFetchIdRef.current) {
          setAuthorOptions(res.items || []);
        }
      } catch {}
      if (fetchId === authorFetchIdRef.current) {
        setAuthorSearching(false);
      }
    };

    if (needDebounce) {
      authorDebounceRef.current = setTimeout(doFetch, 300);
    } else {
      doFetch();
    }
  };

  // 加载分类
  const loadCategories = () => {
    styleApi.categories().then((res) => setCategories(res)).catch(() => {});
  };

  // 加载风格列表
  const loadStyles = (categoryId: string) => {
    setLoading(true);
    styleApi.list({ category_id: categoryId })
      .then((res) => {
        const filtered = res.items?.filter(s => !s.name.startsWith('_cat_placeholder_')) || [];
        setStyles(filtered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // 强制刷新当前列表（用于外部操作后同步数据）
  const refreshCurrentList = () => {
    if (activeTab === 'users') loadUsers();
    else if (activeTab === 'shows' && activeShowCategory) loadShows(activeShowCategory);
    else if (activeTab === 'styles' && activeCategory) loadStyles(activeCategory);
  };

  // 加载用户列表
  const loadUsers = () => {
    setUserLoading(true);
    userApi.list()
      .then((res) => {
        setUsers(res.items || []);
      })
      .catch(() => {})
      .finally(() => setUserLoading(false));
  };

  // ========== 首页管理函数 ==========
  const loadShowCategories = () => {
    showApi.categories().then((res) => setShowCategories(res)).catch(() => {});
  };

  const loadShows = (categoryId: string) => {
    setShowsLoading(true);
    showApi.list({ category_id: categoryId })
      .then((res) => setShows(res.items || []))
      .catch(() => {})
      .finally(() => setShowsLoading(false));
  };

  const handleCreateShowCategory = async () => {
    if (!newShowCatName.trim()) return;
    setCreatingShowCat(true);
    try {
      await showApi.createCategory({ name: newShowCatName.trim(), sort_order: 0 });
      setShowNewShowCatDialog(false);
      setNewShowCatName('');
      const res = await showApi.categories();
      setShowCategories(res);
      const newCat = res.find(c => c.name === newShowCatName.trim());
      if (newCat) setActiveShowCategory(newCat.id);
    } catch {}
    setCreatingShowCat(false);
  };

  const openAddShowDialog = () => {
    setEditingShow(null);
    setAddShowForm({ title: '', description: '', video_url: '', author_id: '', duration: 0, tags: '' });
    setAddShowFile(null);
    setAddShowPreviewUrl('');
    setAddShowVideoFile(null);
    setAddShowVideoName('');
    setShowAddShowDialog(true);
    if (authorOptions.length === 0) fetchAuthors('');
  };

  const openEditShowDialog = (s: ShowItem) => {
    setEditingShow(s);
    setAddShowForm({
      title: s.title,
      description: s.description || '',
      video_url: s.video_url,
      author_id: s.author_id || '',
      duration: s.duration,
      tags: (s.tags || []).join(', '),
    });
    setAddShowFile(null);
    setAddShowPreviewUrl(s.thumbnail_url || '');
    setAddShowVideoFile(null);
    setAddShowVideoName(s.video_url ? s.video_url.split('/').pop() || '' : '');
    setShowAddShowDialog(true);
    if (authorOptions.length === 0) fetchAuthors('');
  };

  const handleSelectShowFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setAddShowFile(file); setAddShowPreviewUrl(URL.createObjectURL(file)); }
  };

  const handleSelectShowVideo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAddShowVideoFile(file);
    setAddShowVideoName(file.name);
    setAddShowForm(prev => ({ ...prev, video_url: '' }));
    setVideoUploadedUrl('');
    setVideoUploadProgress(0);

    // 自动截取视频第一帧作为封面
    const thumbFile = await new Promise<File | null>((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.src = URL.createObjectURL(file);

      video.onloadeddata = () => {
        video.currentTime = Math.min(1, video.duration * 0.01 || 1);
        const dur = Math.round(video.duration) || 0;
        setAddShowForm(prev => ({ ...prev, duration: prev.duration || dur }));
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        setAddShowPreviewUrl(dataUrl);
        fetch(dataUrl).then(r => r.blob()).then(blob => {
          resolve(new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }));
        });
        URL.revokeObjectURL(video.src);
      };

      video.onerror = () => { URL.revokeObjectURL(video.src); resolve(null); };
    });

    if (thumbFile) setAddShowFile(thumbFile);

    // 独立上传视频（不依赖 show ID）
    try {
      setVideoUploading(true);
      setVideoUploadProgress(0);
      const result = await uploadVideo(file, (pct) => {
        setVideoUploadProgress(pct);
      });
      // 上传成功：填入表单 + 标记已上传
      setAddShowForm(prev => ({ ...prev, video_url: result.url }));
      setVideoUploadedUrl(result.url);
      if (result.cached) {
        message.success('视频已存在，直接使用缓存');
      } else if (result.compressed) {
        message.success('视频上传并压缩完成');
      } else {
        message.success('视频上传完成');
      }
    } catch (err) {
      console.error('视频上传失败:', err);
      message.error('视频上传失败');
    } finally {
      setVideoUploading(false);
    }
  };

  // 填写视频地址失焦后，加载视频预览 + 自动截取封面
  const handleVideoUrlBlur = (url: string) => {
    if (!url.trim() || videoUploading || addShowVideoFile || videoUploadedUrl) return;
    // 清除之前的预览
    setVideoPreviewUrl('');
    const fullUrl = url.trim().startsWith('/') ? url.trim() : url.trim();
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.src = fullUrl;

    video.onloadeddata = () => {
      // 显示视频预览在上方区域
      setVideoPreviewUrl(fullUrl);
      // 跳转截取第一帧作为封面
      video.currentTime = Math.min(1, video.duration * 0.01 || 1);
      const dur = Math.round(video.duration) || 0;
      setAddShowForm(prev => ({ ...prev, duration: prev.duration || dur }));
    };

    video.onseeked = () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      setAddShowPreviewUrl(dataUrl);
      fetch(dataUrl).then(r => r.blob()).then(blob => {
        setAddShowFile(new File([blob], 'thumbnail.jpg', { type: 'image/jpeg' }));
      });
    };

    video.onerror = () => {};
  };

  const handleAddShowSubmit = async () => {
    if (!addShowForm.title.trim()) return;
    // 新建模式必须有封面图
    if (!editingShow && !addShowFile) return;
    setAddingShow(true);
    try {
      if (editingShow) {
        // 编辑模式（包括选视频时自动创建的记录）：更新信息 + 上传封面
        await showApi.update(editingShow.id, {
          title: addShowForm.title.trim(),
          description: addShowForm.description.trim() || undefined,
          // 视频已在选择时上传完成，或用户手动填写了地址
          video_url: (videoUploadedUrl || addShowForm.video_url.trim()) || undefined,
          author_id: addShowForm.author_id || undefined,
          duration: addShowForm.duration || undefined,
          tags: addShowForm.tags ? addShowForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
        });
        if (addShowFile) {
          await showApi.uploadThumbnail(editingShow.id, addShowFile);
        }
      } else {
        // 纯手动填写 URL 的创建（没有选择视频文件）
        const res = await showApi.create({
          category_id: activeShowCategory,
          title: addShowForm.title.trim(),
          description: addShowForm.description.trim() || undefined,
          video_url: addShowForm.video_url.trim(),
          author_id: addShowForm.author_id || undefined,
          duration: addShowForm.duration || undefined,
          tags: addShowForm.tags ? addShowForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
        });
        if (addShowFile) {
          await showApi.uploadThumbnail(res.id, addShowFile);
        }
      }
      setShowAddShowDialog(false);
      URL.revokeObjectURL(addShowPreviewUrl);
      loadShows(activeShowCategory);
      loadShowCategories();
    } catch {}
    setAddingShow(false);
  };

  const handleDeleteShow = async (id: string) => {
    const show = shows.find(s => s.id === id);
    if (!show) return;

    // 使用 antd 的 modal 确认
    const { Modal } = await import('antd');
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除视频「${show.title}」吗？此操作不可恢复，关联的封面图和视频文件也将被删除。`,
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await showApi.delete(id);
          message.success('删除成功');
          loadShows(activeShowCategory);
          loadShowCategories();
        } catch (err) {
          message.error('删除失败');
          console.error(err);
        }
      },
    });
  };

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
    else if (activeTab === 'shows') {
      let cancelled = false;
      setShowsLoading(true);
      showApi.categories()
        .then((res) => {
          if (cancelled) return;
          setShowCategories(res);
          const catId = res.length > 0 ? res[0].id : '';
          if (catId) setActiveShowCategory(catId);
          if (catId) return showApi.list({ category_id: catId });
          return { items: [] as ShowItem[], total: 0, page: 1 };
        })
        .then((res) => { if (cancelled || !res) return; setShows(res.items || []); })
        .catch(() => {})
        .finally(() => { if (!cancelled) setShowsLoading(false); });
      return () => { cancelled = true; };
    } else if (activeTab === 'styles') {
      // 先加载分类列表，选中第一个后再加载风格
      let cancelled = false;
      setLoading(true);
      styleApi.categories()
        .then((res) => {
          if (cancelled) return;
          setCategories(res);
          const catId = res.length > 0 ? res[0].id : '';
          // 始终重置为第一个分类（确保切换回来时刷新数据）
          if (catId) setActiveCategory(catId);
          if (catId) {
            return styleApi.list({ category_id: catId });
          }
          return { items: [] as StyleItem[], total: 0, page: 1 };
        })
        .then((res) => {
          if (cancelled || !res) return;
          const filtered = (res.items || []).filter(s => !s.name.startsWith('_cat_placeholder_'));
          setStyles(filtered);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setLoading(false); });
      return () => { cancelled = true; };
    } else setStyles([]);
  }, [activeTab]); // 每次切换 tab 时都会重新加载

  // 监听分类切换：当 activeCategory 变化时重新加载该分类下的风格
  useEffect(() => {
    if (activeTab === 'styles' && activeCategory) {
      loadStyles(activeCategory);
    }
    if (activeTab === 'shows' && activeShowCategory) {
      loadShows(activeShowCategory);
    }
  }, [activeCategory, activeShowCategory, activeTab]); // 依赖 activeCategory 和 activeTab

  // 页面获得焦点时自动刷新（处理从其他页面返回的情况）
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        refreshCurrentList();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [activeTab, activeCategory]);

  // 新建分类
  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      await styleApi.createCategory({
        name: newCatName.trim(),
        sort_order: 0,
      });
      setShowNewCatDialog(false);
      setNewCatName('');
      loadCategories();
      // 创建后选中新的分类
      const res = await styleApi.categories();
      if (res.length > 0) {
        // 找到刚创建的分类（按名称匹配）
        const newCat = res.find(c => c.name === newCatName.trim());
        if (newCat) setActiveCategory(newCat.id);
      }
    } catch {}
    setCreatingCat(false);
  };

  // 打开添加弹窗
  const openAddDialog = () => {
    setEditingStyle(null);
    setAddForm({ name: '', author: '', tags: '' });
    setAddFile(null);
    setAddPreviewUrl('');
    setShowAddDialog(true);
  };

  // 打开编辑弹窗（复用添加弹窗，预填数据）
  const openEditDialog = (s: StyleItem) => {
    setEditingStyle(s);
    setAddForm({ name: s.name, author: s.author, tags: (s.tags || []).join(', ') });
    setAddFile(null); // 不预填文件，用户可选换图
    setAddPreviewUrl(s.image_url || ''); // 显示当前图片
    setShowAddDialog(true);
  };

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setAddFile(file); setAddPreviewUrl(URL.createObjectURL(file)); }
  };

  const handleAddSubmit = async () => {
    if (!addForm.name.trim()) return;
    // 新建模式必须有图片
    if (!editingStyle && !addFile) return;
    setAdding(true);
    try {
      if (editingStyle) {
        // 编辑模式：更新信息 + 可选换图
        await styleApi.update(editingStyle.id, {
          name: addForm.name.trim(),
          author: addForm.author.trim() || undefined,
          category_id: activeCategory,
          tags: addForm.tags ? addForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
        });
        if (addFile) {
          await styleApi.uploadImage(editingStyle.id, addFile);
        }
      } else {
        // 新建模式：创建 + 上传图片
        const res = await styleApi.create({
          name: addForm.name.trim(),
          author: addForm.author.trim() || undefined,
          category_id: activeCategory,
          tags: addForm.tags ? addForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
        });
        await styleApi.uploadImage(res.id, addFile);
      }
      setShowAddDialog(false);
      URL.revokeObjectURL(addPreviewUrl);
      loadStyles(activeCategory);
      loadCategories();
    } catch {}
    setAdding(false);
  };

  // 删除风格
  const handleDelete = async (id: string) => {
    const style = styles.find(s => s.id === id);
    if (!style) return;

    // 使用 antd 的 modal 确认
    const { Modal } = await import('antd');
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除风格「${style.name}」吗？此操作不可恢复。`,
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await styleApi.delete(id);
          message.success('删除成功');
          loadStyles(activeCategory);
          loadCategories();
        } catch (err) {
          message.error('删除失败');
          console.error(err);
        }
      },
    });
  };

  // 侧边栏菜单
  const menuItems: { key: AdminTab; icon: React.ReactNode; label: string }[] = [
    { key: 'shows', icon: <VideoCameraOutlined />, label: '首页管理' },
    { key: 'styles', icon: <TagOutlined />, label: '风格管理' },
    { key: 'users', icon: <UserOutlined />, label: '用户管理' },
    { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
  ];

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* 左侧边栏 */}
      <aside className="w-[200px] bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-800">运营后台</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">System Administration</p>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {menuItems.map(item => (
            <button
              key={item.key}
              onClick={() => navigate(`/admin/${item.key}`)}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
                activeTab === item.key
                  ? 'bg-blue-50 text-blue-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-800'
              }`}
            >
              <span className={activeTab === item.key ? 'text-blue-600' : 'text-gray-400'}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <main className="flex-1 overflow-hidden flex flex-col bg-gray-50/50">
        {/* ========== 首页管理 Tab ========== */}
        {activeTab === 'shows' && (
          <>
            {/* 工具栏 */}
            <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0">
              {(showCategories?.length || 0) === 0 ? (
                <span className="text-gray-400 text-[13px]">暂无分类，点击右侧按钮创建</span>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto">
                  {showCategories.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => { setActiveShowCategory(cat.id); setPlayingShowId(null); }}
                      className={`px-3.5 py-1.5 text-[12px] whitespace-nowrap rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                        activeShowCategory === cat.id ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {cat.name}
                      <span className={`text-[10px] ${activeShowCategory === cat.id ? 'bg-blue-200/60 text-blue-600' : 'bg-gray-200 text-gray-400'} rounded-full px-1.5 py-px`}>
                        {cat.show_count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1" />
              <button onClick={() => setShowNewShowCatDialog(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer">
                <FolderAddOutlined /> 新建标签
              </button>
              {activeShowCategory && (
                <button onClick={openAddShowDialog} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
                  <PlusOutlined /> 添加视频
                </button>
              )}
            </div>

            {/* 视频列表 */}
            <div className="flex-1 overflow-y-auto p-6">
              {(!activeShowCategory) && (showCategories?.length || 0) > 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <FolderAddOutlined style={{ fontSize: 40 }} className="mb-3 opacity-40" />
                  <div className="text-[14px]">选择一个标签查看或添加视频</div>
                </div>
              )}
              {showsLoading ? (
                <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
              ) : activeShowCategory && (shows?.length || 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <UploadOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                  <div className="text-[14px] mb-2">「{showCategories?.find(c => c.id === activeShowCategory)?.name}」暂无视频</div>
                  <button onClick={openAddShowDialog} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
                    <PlusOutlined /> 添加第一个视频
                  </button>
                </div>
              ) : activeShowCategory && (shows?.length || 0) > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-gray-500">{shows?.length || 0} 个视频</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {shows.map(show => (
                      <div key={show.id} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                        <div className="aspect-[16/9] relative bg-gray-100">
                          {playingShowId === show.id ? (
                            /* 原地播放视频 */
                            <video
                              src={show.video_url}
                              className="w-full h-full object-cover"
                              autoPlay
                              controls
                              playsInline
                              onEnded={() => setPlayingShowId(null)}
                            />
                          ) : (
                            <>
                              {show.thumbnail_url ? (
                                <img src={show.thumbnail_url} alt={show.title} className="w-full h-full object-cover" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-300 text-[12px]">暂无封面</div>
                              )}

                              {/* 播放按钮 */}
                              {show.video_url && (
                                <button
                                  onClick={() => setPlayingShowId(show.id)}
                                  className="absolute inset-0 m-auto w-10 h-10 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
                                  title="播放"
                                >
                                  <CaretRightOutlined style={{ fontSize: 18, marginLeft: 2 }} />
                                </button>
                              )}

                              {/* 标签 */}
                              {(show.tags?.length || 0) > 0 && (
                                <div className="absolute top-2 left-2 flex gap-1 z-10 flex-wrap">
                                  {(show.tags || []).slice(0, 2).map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">{tag}</span>
                                  ))}
                                </div>
                              )}

                              {/* 编辑/删除按钮 */}
                              <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                                <button onClick={() => openEditShowDialog(show)} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 cursor-pointer" title="编辑">
                                  <EditOutlined style={{ fontSize: 11 }} />
                                </button>
                                <button onClick={() => handleDeleteShow(show.id)} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/50 cursor-pointer" title="删除">
                                  <DeleteOutlined style={{ fontSize: 11 }} />
                                </button>
                              </div>

                              {/* 底部信息遮罩（播放时隐藏） */}
                              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5 z-10">
                                <p className="text-white text-[13px] font-medium truncate drop-shadow">{show.title}</p>
                                <div className="flex items-center justify-between mt-1">
                                  {show.author ? <span className="text-white/70 text-[11px] truncate mr-2">{show.author}</span> : <span />}
                                  <span className="text-white/70 text-[10px]">{show.duration > 0 ? `${Math.floor(show.duration / 60)}:${String(show.duration % 60).padStart(2, '0')}` : ''}</span>
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="px-6 py-2.5 border-t border-gray-100 shrink-0 flex items-center justify-between text-[12px] text-gray-400 bg-white">
              <span>共 {showCategories?.length || 0} 个标签 · {activeShowCategory ? `${shows?.length || 0} 个视频` : ''}</span>
              <span>Hover 卡片可编辑 / 删除</span>
            </div>
          </>
        )}

        {/* ========== 风格管理 Tab ========== */}
        {activeTab === 'styles' && (
          <>
            {/* 工具栏 */}
            <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0">
              {(categories?.length || 0) === 0 ? (
                <span className="text-gray-400 text-[13px]">暂无分类，点击右侧按钮创建</span>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto">
                  {(categories || []).map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setActiveCategory(cat.id)}
                      className={`px-3.5 py-1.5 text-[12px] whitespace-nowrap rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                        activeCategory === cat.id ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {cat.name}
                      <span className={`text-[10px] ${activeCategory === cat.id ? 'bg-blue-200/60 text-blue-600' : 'bg-gray-200 text-gray-400'} rounded-full px-1.5 py-px`}>
                        {cat.style_count}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1" />
              <button onClick={() => setShowNewCatDialog(true)} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer">
                <FolderAddOutlined /> 新建分类
              </button>
              {activeCategory && (
                <button onClick={openAddDialog} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
                  <PlusOutlined /> 添加图片
                </button>
              )}
            </div>

            {/* 图墙 */}
            <div className="flex-1 overflow-y-auto p-6">
              {(!activeCategory) && (categories?.length || 0) > 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <FolderAddOutlined style={{ fontSize: 40 }} className="mb-3 opacity-40" />
                  <div className="text-[14px]">选择一个分类查看或上传图片</div>
                </div>
              )}
              {loading ? (
                <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
              ) : activeCategory && (styles?.length || 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <UploadOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                  <div className="text-[14px] mb-2">「{categories?.find(c => c.id === activeCategory)?.name || activeCategory}」暂无风格图片</div>
                  <button onClick={openAddDialog} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
                    <PlusOutlined /> 上传第一张图片
                  </button>
                </div>
              ) : activeCategory && (styles?.length || 0) > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-gray-500">{styles?.length || 0} 张图片</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {(styles || []).map(style => (
                      <div key={style.id} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                        <div className="aspect-[4/3] relative bg-gray-100">
                          {style.image_url ? (
                            <img src={style.image_url} alt={style.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 text-[12px]">暂无图片</div>
                          )}

                          {/* 左上角标签 */}
                          {(style.tags?.length || 0) > 0 && (
                            <div className="absolute top-2 left-2 flex gap-1 z-10 flex-wrap">
                              {(style.tags || []).slice(0, 2).map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Hover 操作栏：编辑 + 删除 */}
                          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                            <button onClick={() => openEditDialog(style)} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 cursor-pointer" title="编辑">
                              <EditOutlined style={{ fontSize: 11 }} />
                            </button>
                            <button onClick={() => handleDelete(style.id)} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/50 cursor-pointer" title="删除">
                              <DeleteOutlined style={{ fontSize: 11 }} />
                            </button>
                          </div>

                          {/* 底部浮层 + 点赞数 */}
                          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5 z-10">
                                <p className="text-white text-[13px] font-medium truncate drop-shadow">{style.name}</p>
                                <div className="flex items-center justify-between mt-1">
                                  {style.author ? <span className="text-white/70 text-[11px] truncate mr-2">{style.author}</span> : <span />}
                                  {/* 点赞数显示 */}
                                  <div className="flex items-center gap-1 text-white/70 text-[10px]">
                                    <HeartFilled style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }} />
                                    <span>{style.likes || 0}</span>
                                  </div>
                                </div>
                              </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            <div className="px-6 py-2.5 border-t border-gray-100 shrink-0 flex items-center justify-between text-[12px] text-gray-400 bg-white">
              <span>共 {categories?.length || 0} 个分类 · {activeCategory ? `${styles?.length || 0} 张图片` : ''}</span>
              <span>Hover 卡片可编辑 / 删除</span>
            </div>
          </>
        )}

        {/* ========== 用户管理 Tab ========== */}
        {activeTab === 'users' && (
          <div className="flex-1 overflow-y-auto p-6">
            {userLoading ? (
              <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
            ) : (users?.length || 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <UserOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                <div className="text-[14px] mb-2">暂无用户</div>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] text-gray-500">共 {users?.length || 0} 个用户</span>
                </div>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-[13px]">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">ID</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">邮箱</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">昵称</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">角色</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">注册时间</th>
                        <th className="px-4 py-3 text-left font-medium text-gray-600">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(users || []).map(user => (
                        <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">{user.id}</td>
                          <td className="px-4 py-3 text-gray-800">{user.email}</td>
                          <td className="px-4 py-3 text-gray-600">{user.nickname || '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`px-2 py-0.5 rounded-full text-[11px] ${
                              user.role === 'admin'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {user.role === 'admin' ? '管理员' : '普通用户'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-gray-500">
                            {new Date(user.created_at).toLocaleDateString('zh-CN')}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (window.confirm(`确定要删除用户「${user.email}」吗？此操作不可恢复。`)) {
                                  userApi.delete(user.id)
                                    .then(() => loadUsers())
                                    .catch(() => alert('删除失败'));
                                }
                              }}
                              className="text-red-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-[12px] transition-colors cursor-pointer"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========== 系统设置 Tab（占位）========== */}
        {activeTab === 'settings' && (
          <div className="flex-1 overflow-y-auto p-6 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <SettingOutlined style={{ fontSize: 40 }} className="mb-3 opacity-40" />
              <div className="text-[14px]">系统设置功能开发中...</div>
            </div>
          </div>
        )}
      </main>

      {/* ========== 首页管理：新建标签弹窗 ========== */}
      {showNewShowCatDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewShowCatDialog(false)} />
          <div className="relative w-[360px] bg-white rounded-xl shadow-xl border border-gray-200 z-10 p-6">
            <h3 className="text-[14px] font-semibold text-gray-800 mb-4">新建标签</h3>
            <input
              value={newShowCatName}
              onChange={e => setNewShowCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateShowCategory()}
              placeholder="输入标签名称"
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewShowCatDialog(false)} className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer">取消</button>
              <button onClick={handleCreateShowCategory} disabled={!newShowCatName.trim() || creatingShowCat} className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {creatingShowCat ? '创建中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 首页管理：添加/编辑视频弹窗 ========== */}
      {showAddShowDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowAddShowDialog(false); URL.revokeObjectURL(addShowPreviewUrl); }} />
          <div className="relative w-[520px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10 max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 shrink-0">
              <h3 className="text-[15px] font-semibold text-gray-800">{editingShow ? '编辑视频' : '添加视频'}</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {/* 标题 */}
              <div>
                <label className="block text-[12px] text-gray-500 mb-1.5">标题 <span className="text-red-400">*</span></label>
                <input
                  value={addShowForm.title}
                  onChange={e => setAddShowForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="输入视频标题"
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-[12px] text-gray-500 mb-1.5">描述</label>
                <textarea
                  value={addShowForm.description}
                  onChange={e => setAddShowForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="输入视频描述"
                  rows={2}
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none resize-none"
                />
              </div>

              {/* 视频 + 封面图（同一行） */}
              <div className="grid grid-cols-2 gap-3">
                {/* 左：视频预览/上传区域 */}
                <div>
                  <label className="block text-[12px] text-gray-500 mb-1.5">视频 {!editingShow && <span className="text-red-400">*</span>}</label>
                  <div
                    onClick={() => !videoUploading && document.getElementById('show-video-input')?.click()}
                    className={`w-full aspect-video border-2 border-dashed rounded-lg flex items-center justify-center cursor-pointer transition-colors overflow-hidden relative ${videoUploading ? 'border-blue-400 bg-blue-50 cursor-wait' : 'border-gray-200 hover:border-blue-300'}`}
                  >
                    {videoUploading ? (
                      /* 上传进度浮层 */
                      <>
                        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-10">
                          <div className="flex flex-col items-center gap-1">
                            <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            <div className="text-[11px] text-white font-medium">上传 {videoUploadProgress}%</div>
                          </div>
                        </div>
                        {videoPreviewUrl && (
                          <video src={videoPreviewUrl} className="w-full h-full object-contain" muted playsInline />
                        )}
                      </>
                    ) : videoUploadedUrl ? (
                      /* 上传完成：显示可播放视频 */
                      <video
                        src={videoUploadedUrl}
                        className="w-full h-full object-contain"
                        muted
                        playsInline
                        controls
                        onClick={e => e.stopPropagation()}
                      />
                    ) : videoPreviewUrl ? (
                      /* 填写地址后的视频预览 */
                      <video src={videoPreviewUrl} className="w-full h-full object-contain" muted playsInline />
                    ) : addShowVideoFile ? (
                      <div className="text-center">
                        <VideoCameraOutlined style={{ fontSize: 20 }} className="mb-1 block text-blue-500" />
                        <div className="text-[12px] text-blue-600 truncate max-w-[180px]">{addShowVideoName}</div>
                      </div>
                    ) : (
                      <div className="text-center text-gray-400">
                        <UploadOutlined style={{ fontSize: 18 }} className="mb-1" />
                        <div className="text-[11px]">点击上传视频</div>
                      </div>
                    )}
                  </div>
                  <input id="show-video-input" type="file" accept=".mp4,.webm,.mov,.avi,.mkv" className="hidden" onChange={handleSelectShowVideo} />
                </div>

                {/* 右：封面图 */}
                <div>
                  <label className="block text-[12px] text-gray-500 mb-1.5">
                    封面图
                    {(videoUploadedUrl || videoPreviewUrl) ? <span className="text-green-500 ml-1">(已自动截取)</span> : !editingShow ? <span className="text-red-400">*</span> : null}
                  </label>
                  <div onClick={() => document.getElementById('show-file-input')?.click()} className="w-full aspect-[16/9] border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-300 transition-colors overflow-hidden">
                    {addShowPreviewUrl ? (
                      <img src={addShowPreviewUrl} alt="preview" className="w-full h-full object-cover" />
                    ) : (
                      <div className="text-center text-gray-400">
                        <UploadOutlined style={{ fontSize: 20 }} className="mb-1" />
                        <div className="text-[11px]">点击上传封面</div>
                      </div>
                    )}
                  </div>
                  <input id="show-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={handleSelectShowFile} />
                </div>
              </div>

              {/* 视频地址 + 时长（同一行） */}
              <div className="flex gap-3">
                <div className="flex-1">
                  <input
                    value={addShowForm.video_url}
                    onChange={e => setAddShowForm(prev => ({ ...prev, video_url: e.target.value }))}
                    onBlur={e => handleVideoUrlBlur(e.target.value)}
                    placeholder="或填写视频地址（失焦后自动加载预览）"
                    disabled={!!videoUploading || !!videoUploadedUrl}
                    className="w-full px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </div>
                <div className="w-24">
                  <input
                    type="number"
                    value={addShowForm.duration || ''}
                    onChange={e => setAddShowForm(prev => ({ ...prev, duration: parseInt(e.target.value) || 0 }))}
                    placeholder="时长(秒)"
                    className="w-full px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                  />
                </div>
              </div>

              {/* 作者 + 标签 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[12px] text-gray-500 mb-1.5">作者</label>
                  <Select
                    value={addShowForm.author_id || undefined}
                    onChange={val => setAddShowForm(prev => ({ ...prev, author_id: val }))}
                    onSearch={fetchAuthors}
                    placeholder="点击选择或输入搜索"
                    showSearch
                    allowClear
                    options={authorOptions.slice(0, 10).map(u => ({ label: u.nickname || u.email, value: u.id }))}
                    notFoundContent={authorSearching ? '搜索中...' : '暂无匹配用户'}
                    filterOption={false}
                    getPopupContainer={(trigger) => trigger.parentElement!}
                    style={{ width: '100%', height: 38 }}
                  />
                </div>
                <div>
                  <label className="block text-[12px] text-gray-500 mb-1.5">标签（逗号分隔）</label>
                  <input
                    value={addShowForm.tags}
                    onChange={e => setAddShowForm(prev => ({ ...prev, tags: e.target.value }))}
                    placeholder="标签1, 标签2"
                    className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button onClick={() => { setShowAddShowDialog(false); URL.revokeObjectURL(addShowPreviewUrl); }} className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer">取消</button>
              <button onClick={handleAddShowSubmit} disabled={addingShow || (!editingShow && !addShowFile)} className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {addingShow ? '提交中...' : (editingShow ? '保存' : '创建')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 新建分类小弹窗 ========== */}
      {showNewCatDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewCatDialog(false)} />
          <div className="relative w-[360px] bg-white rounded-xl shadow-xl border border-gray-200 z-10 p-6">
            <h3 className="text-[14px] font-semibold text-gray-800 mb-4">新建分类</h3>
            <input
              value={newCatName}
              onChange={e => setNewCatName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateCategory()}
              placeholder="输入分类名称"
              className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowNewCatDialog(false)} className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer">取消</button>
              <button onClick={handleCreateCategory} disabled={!newCatName.trim() || creatingCat} className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {creatingCat ? '创建中...' : '确认'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== 添加图片弹窗 ========== */}
      {showAddDialog && (
        <div className="fixed inset-0 z-[10000] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setShowAddDialog(false); URL.revokeObjectURL(addPreviewUrl); }} />
          <div className="relative w-[520px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10">
            <h3 className="text-[15px] font-semibold text-gray-800 px-6 py-4 border-b border-gray-100">
              {editingStyle ? '编辑风格' : '添加风格图片'} — {categories?.find(c => c.id === activeCategory)?.name || activeCategory}
            </h3>
            <div className="p-6 space-y-4">
              <div className="flex gap-4">
                <label className={`w-[200px] h-[180px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors shrink-0 ${addFile ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
                  {addPreviewUrl ? (
                    <img src={addPreviewUrl} alt="" className="w-full h-full object-cover rounded-md" />
                  ) : (
                    <><UploadOutlined className="text-gray-400 text-xl mb-1" /><span className="text-[12px] text-gray-400">选择图片</span></>
                  )}
                  <input ref={addFileRef as React.RefObject<HTMLInputElement>} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" className="hidden" onChange={handleSelectFile} />
                </label>
                <div className="flex-1 space-y-2.5">
                  <div>
                    <label className="text-[11px] text-gray-500 mb-0.5 block">风格名称 *</label>
                    <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} placeholder="输入风格名称" className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 mb-0.5 block">作者</label>
                    <input value={addForm.author} onChange={e => setAddForm(f => ({ ...f, author: e.target.value }))} placeholder="作者名（可选）" className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none" />
                  </div>
                  <div>
                    <label className="text-[11px] text-gray-500 mb-0.5 block">标签</label>
                    <input value={addForm.tags} onChange={e => setAddForm(f => ({ ...f, tags: e.target.value }))} placeholder="逗号分隔，如：写实,油画,风景" className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none" />
                  </div>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => { setShowAddDialog(false); URL.revokeObjectURL(addPreviewUrl); }} className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer">取消</button>
              <button onClick={handleAddSubmit} disabled={(!editingStyle && !addFile) || !addForm.name.trim() || adding} className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {adding ? (editingStyle ? '保存中...' : '添加中...') : (editingStyle ? '保存修改' : '确认添加')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
