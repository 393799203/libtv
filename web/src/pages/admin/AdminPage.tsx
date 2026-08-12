import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Select } from 'antd';
import {
  TagOutlined,
  SettingOutlined,
  FolderAddOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  UploadOutlined,
  HeartFilled,
  HeartOutlined,
  UserOutlined,
  VideoCameraOutlined,
  CaretRightOutlined,
} from '@ant-design/icons';
import { styleApi, type StyleItem, type CategoryItem } from '@/services/styleApi';
import { showApi, type ShowItem, type ShowCategoryItem } from '@/services/showApi';
import { userApi, type UserItem } from '@/services/userApi';
import { bannerApi, type BannerItem } from '@/services/bannerApi';
import { useAuthStore } from '@/stores/authStore';
import AddShowDialog from '@/components/AddShowDialog';

type AdminTab = 'banners' | 'shows' | 'styles' | 'users' | 'settings';

export default function AdminPage() {
  const navigate = useNavigate();
  const { tab = 'banners' } = useParams<{ tab: string }>();
  const activeTab: AdminTab = (tab as AdminTab) || 'banners';
  const { message, modal } = App.useApp();
  const currentUser = useAuthStore((s) => s.user); // 获取当前登录用户

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

  // ========== 版图管理状态 ==========
  const [banners, setBanners] = useState<BannerItem[]>([]);
  const [bannersLoading, setBannersLoading] = useState(false);
  const [showAddBannerDialog, setShowAddBannerDialog] = useState(false);
  const [addBannerForm, setAddBannerForm] = useState({ 
    title: '', 
    description: '', 
    link_url: '', 
    sort_order: 0, 
    is_active: true 
  });
  const [addBannerFile, setAddBannerFile] = useState<File | null>(null);
  const [addBannerPreviewUrl, setAddBannerPreviewUrl] = useState('');
  const [addingBanner, setAddingBanner] = useState(false);
  const [editingBanner, setEditingBanner] = useState<BannerItem | null>(null);
  const [bannerImageUploading, setBannerImageUploading] = useState(false);
  const [bannerImageUploadedUrl, setBannerImageUploadedUrl] = useState('');
  const addBannerFileRef = useRef<HTMLInputElement>(null);

  // ========== 首页管理状态 ==========
  const [showCategories, setShowCategories] = useState<ShowCategoryItem[]>([]);
  const [shows, setShows] = useState<ShowItem[]>([]);
  const [showsLoading, setShowsLoading] = useState(false);
  const [activeShowCategory, setActiveShowCategory] = useState<string>('');
  const [showNewShowCatDialog, setShowNewShowCatDialog] = useState(false);
  const [newShowCatName, setNewShowCatName] = useState('');
  const [creatingShowCat, setCreatingShowCat] = useState(false);
  const [showAddShowDialog, setShowAddShowDialog] = useState(false);
  const [editingShow, setEditingShow] = useState<ShowItem | null>(null);
  const [playingShowId, setPlayingShowId] = useState<string | null>(null);
  // 待审核视频
  const [showPendingView, setShowPendingView] = useState(false);
  const [pendingShows, setPendingShows] = useState<ShowItem[]>([]);
  const [pendingLoading, setPendingLoading] = useState(false);
  // 作者搜索（风格弹窗使用）
  const [authorOptions, setAuthorOptions] = useState<UserItem[]>([]);
  const [authorSearching, setAuthorSearching] = useState(false);

  // 远程搜索作者（供风格弹窗使用）
  const fetchAuthors = (_keyword?: string) => {
    setAuthorSearching(true);
    userApi.list()
      .then(res => setAuthorOptions(res.items || []))
      .catch(() => {})
      .finally(() => setAuthorSearching(false));
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
    else if (activeTab === 'banners') loadBanners();
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

  // ========== 版图管理函数 ==========
  const loadBanners = () => {
    setBannersLoading(true);
    bannerApi.list()
      .then((res) => setBanners(res || []))
      .catch(() => {})
      .finally(() => setBannersLoading(false));
  };

  const openAddBannerDialog = () => {
    setEditingBanner(null);
    setAddBannerForm({ title: '', description: '', link_url: '', sort_order: 0, is_active: true });
    setAddBannerFile(null);
    setAddBannerPreviewUrl('');
    setBannerImageUploadedUrl('');
    setBannerImageUploading(false);
    setShowAddBannerDialog(true);
  };

  const openEditBannerDialog = (banner: BannerItem) => {
    setEditingBanner(banner);
    setAddBannerForm({
      title: banner.title,
      description: banner.description || '',
      link_url: banner.link_url || '',
      sort_order: banner.sort_order,
      is_active: banner.is_active,
    });
    setAddBannerFile(null);
    setAddBannerPreviewUrl(banner.image_url);
    setBannerImageUploadedUrl(banner.image_url); // 编辑模式下，已有图片URL
    setBannerImageUploading(false);
    setShowAddBannerDialog(true);
  };

  const handleSelectBannerFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      console.log('没有选择文件');
      return;
    }

    console.log('选择了文件:', file.name, '大小:', file.size, '类型:', file.type);
    console.log('文件大小(MB):', (file.size / 1024 / 1024).toFixed(2));

    // 检查文件大小（前端提前提示）
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
      console.error('❌ 文件大小超出限制:', fileSizeMB, 'MB > 50MB');
      message.error(`图片大小 ${fileSizeMB}MB 超过限制，最大支持50MB，请选择更小的图片或压缩后再上传`);
      return;
    }

    console.log('✅ 文件大小检查通过');

    // 检查文件类型
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      console.error('❌ 文件类型不支持:', file.type);
      message.error(`不支持 ${file.type} 格式，只支持 jpg/jpeg/png/webp/gif 格式的图片`);
      return;
    }

    console.log('✅ 文件类型检查通过');

    // 设置本地预览
    setAddBannerFile(file);
    const localPreviewUrl = URL.createObjectURL(file);
    setAddBannerPreviewUrl(localPreviewUrl);
    console.log('✅ 本地预览已设置:', localPreviewUrl);

    // 立即上传图片到服务器（不创建版图）
    setBannerImageUploading(true);
    try {
      console.log('开始上传版图图片...');
      const uploadRes = await bannerApi.uploadImage(file);
      console.log('✅ 图片上传成功，URL:', uploadRes.url);
      setBannerImageUploadedUrl(uploadRes.url);
      setAddBannerPreviewUrl(uploadRes.url); // 使用服务器返回的URL
      message.success('图片上传成功，请填写标题等信息后点击"创建"按钮');
    } catch (err: any) {
      console.error('❌ 上传失败:', err);
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
      // 上传失败，清除预览
      setAddBannerFile(null);
      setAddBannerPreviewUrl('');
      setBannerImageUploadedUrl('');
    }
    setBannerImageUploading(false);
  };

  const handleAddBannerSubmit = async () => {
    if (!addBannerForm.title.trim()) {
      message.error('请填写标题');
      return;
    }
    
    setAddingBanner(true);
    try {
      if (editingBanner) {
        // 编辑模式：更新版图信息
        console.log('编辑模式：更新版图信息');
        const updateData: any = {
          title: addBannerForm.title.trim(),
          description: addBannerForm.description.trim() || undefined,
          link_url: addBannerForm.link_url.trim() || undefined,
          sort_order: addBannerForm.sort_order,
          is_active: addBannerForm.is_active,
        };
        // 如果有新上传的图片URL，更新图片
        if (bannerImageUploadedUrl) {
          updateData.image_url = bannerImageUploadedUrl;
        }
        await bannerApi.update(editingBanner.id, updateData);
        message.success('版图更新成功');
      } else {
        // 新建模式：创建版图（传入已上传的图片URL）
        console.log('新建模式：创建版图');
        const res = await bannerApi.create({
          title: addBannerForm.title.trim(),
          description: addBannerForm.description.trim() || undefined,
          image_url: bannerImageUploadedUrl || undefined, // 传入已上传的图片URL
          link_url: addBannerForm.link_url.trim() || undefined,
          sort_order: addBannerForm.sort_order,
          is_active: addBannerForm.is_active,
        });
        console.log('版图创建成功，ID:', res.id);
        message.success('版图创建成功');
      }
      
      setShowAddBannerDialog(false);
      if (addBannerPreviewUrl && addBannerPreviewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(addBannerPreviewUrl);
      }
      loadBanners();
    } catch (err: any) {
      console.error('操作失败:', err);
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    }
    setAddingBanner(false);
  };

  const handleDeleteBanner = async (id: string) => {
    const banner = banners.find(b => b.id === id);
    if (!banner) return;

    const { Modal } = await import('antd');
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除版图「${banner.title}」吗？此操作不可恢复。`,
      okText: '确定删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await bannerApi.delete(id);
          message.success('删除成功');
          loadBanners();
        } catch (err) {
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
          console.error(err);
        }
      },
    });
  };

  const handleToggleBannerActive = async (banner: BannerItem) => {
    try {
      await bannerApi.update(banner.id, { is_active: !banner.is_active });
      message.success(banner.is_active ? '已禁用' : '已启用');
      loadBanners();
    } catch (err) {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
      console.error(err);
    }
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
    setShowAddShowDialog(true);
  };

  const openEditShowDialog = (s: ShowItem) => {
    setEditingShow(s);
    setShowAddShowDialog(true);
  };

  const loadPendingShows = async () => {
    setPendingLoading(true);
    try {
      const res = await showApi.listPending({ page: 1, page_size: 100 });
      setPendingShows(res.items || []);
    } catch {}
    setPendingLoading(false);
  };

  const handleApproveShow = async (id: string) => {
    try {
      await showApi.approve(id);
      message.success('已审核通过');
      loadPendingShows();
    } catch {}
  };

  const handleRejectShow = async (id: string) => {
    try {
      await showApi.reject(id);
      message.success('已标记不通过');
      loadPendingShows();
    } catch {}
  };

  const handleDeleteShow = async (id: string) => {
    const show = [...shows, ...pendingShows].find(s => s.id === id);
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
          if (showPendingView) loadPendingShows();
          else { loadShows(activeShowCategory); loadShowCategories(); }
        } catch (err) {
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
          console.error(err);
        }
      },
    });
  };

  useEffect(() => {
    if (activeTab === 'users') loadUsers();
    else if (activeTab === 'banners') loadBanners();
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

    modal.confirm({
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
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
          console.error(err);
        }
      },
    });
  };

  // 侧边栏菜单
  const menuItems: { key: AdminTab; icon: React.ReactNode; label: string }[] = [
    { key: 'banners', icon: <TagOutlined />, label: '版图管理' },
    { key: 'shows', icon: <VideoCameraOutlined />, label: '视频管理' },
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
              {showPendingView ? (
                <>
                  <span className="text-[14px] font-medium text-gray-700">待审核视频</span>
                  <div className="flex-1" />
                  <button onClick={() => setShowPendingView(false)} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer">
                    返回已发布视频列表
                  </button>
                </>
              ) : (
                <>
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
                  <button onClick={() => { setShowPendingView(true); loadPendingShows(); }} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer">
                    待审核视频
                  </button>
                </>
              )}
            </div>

            {/* 视频列表 */}
            <div className="flex-1 overflow-y-auto p-6">
              {showPendingView ? (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-gray-500">{pendingShows.length} 个待审核视频</span>
                  </div>
                  {pendingLoading ? (
                    <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
                  ) : pendingShows.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                      <div className="text-[14px]">暂无待审核视频</div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-4">
                      {pendingShows.map(show => (
                        <div key={show.id} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                          <div className="aspect-[16/9] relative bg-gray-100">
                            {playingShowId === show.id ? (
                              <video src={show.video_url} className="w-full h-full object-cover" autoPlay controls playsInline onEnded={() => setPlayingShowId(null)} />
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

                                {/* 分类标签 */}
                                <div className="absolute top-2 left-2 flex gap-1 z-10 flex-wrap">
                                  {show.category?.name && (
                                    <span className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">{show.category.name}</span>
                                  )}
                                  {(show.tags || []).slice(0, 2).map(tag => (
                                    <span key={tag} className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">{tag}</span>
                                  ))}
                                </div>

                                {/* 审核按钮（hover 显示） */}
                                <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                                  {show.status === 'rejected' ? (
                                    <button onClick={() => handleDeleteShow(show.id)} className="px-2.5 py-1 bg-red-500/80 backdrop-blur-sm text-white text-[11px] rounded-md hover:bg-red-500 transition-colors cursor-pointer font-medium" title="删除">
                                      删除
                                    </button>
                                  ) : (
                                    <>
                                      <button onClick={() => handleApproveShow(show.id)} className="px-2.5 py-1 bg-green-500/80 backdrop-blur-sm text-white text-[11px] rounded-md hover:bg-green-500 transition-colors cursor-pointer font-medium" title="审核通过">
                                        通过
                                      </button>
                                      <button onClick={() => handleRejectShow(show.id)} className="px-2.5 py-1 bg-red-500/80 backdrop-blur-sm text-white text-[11px] rounded-md hover:bg-red-500 transition-colors cursor-pointer font-medium" title="不通过">
                                        不通过
                                      </button>
                                    </>
                                  )}
                                </div>

                                {/* 底部信息遮罩 */}
                                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5 z-10">
                                  <div className="flex items-center justify-between">
                                    <p className="text-white text-[13px] font-medium truncate drop-shadow flex-1">{show.title}</p>
                                  </div>
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
                  )}
                </div>
              ) : (
                <>
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
                                    <div className="flex items-center justify-between">
                                      <p className="text-white text-[13px] font-medium truncate drop-shadow flex-1">{show.title}</p>
                                      <div className="flex items-center gap-1 ml-2">
                                        <HeartOutlined style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} />
                                        <span className="text-white/70 text-[10px]">{show.likes || 0}</span>
                                      </div>
                                    </div>
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
                </>
              )}
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
                  <div className="grid grid-cols-8 gap-2">
                    {(styles || []).map(style => (
                      <div key={style.id} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                        <div className="aspect-[3/4] relative bg-gray-100">
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
                      {(users || []).map(user => {
                        const isCurrentUser = currentUser && user.id === currentUser.id;
                        return (
                          <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-gray-500 font-mono text-[11px]">{user.id}</td>
                            <td className="px-4 py-3 text-gray-800">{user.email}</td>
                            <td className="px-4 py-3 text-gray-600">{user.nickname || '-'}</td>
                            <td className="px-4 py-3">
                              <Select
                                value={user.role}
                                size="small"
                                style={{ width: 100 }}
                                disabled={isCurrentUser}
                                options={[
                                  { value: 'user', label: '普通用户' },
                                  { value: 'admin', label: '管理员' },
                                ]}
                                onChange={(value) => {
                                  userApi.updateRole(user.id, value as 'user' | 'admin')
                                    .then(() => {
                                      message.success('角色已更新');
                                      loadUsers();
                                    })
                                    .catch(() => {
                                      // HTTP 错误已由 api.ts 拦截器统一 message.error()
                                    });
                                }}
                              />
                            </td>
                            <td className="px-4 py-3 text-gray-500">
                              {new Date(user.created_at).toLocaleDateString('zh-CN')}
                            </td>
                            <td className="px-4 py-3">
                              {!isCurrentUser && (
                                <button
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    const { Modal } = await import('antd');
                                    // 第一次确认
                                    Modal.confirm({
                                      title: '删除用户',
                                      content: `确定要删除用户「${user.email}」吗？`,
                                      okText: '确认',
                                      cancelText: '取消',
                                      okButtonProps: { danger: true },
                                      onOk: () => {
                                        // 第二次确认（明确告知将删除所有关联数据）
                                        Modal.confirm({
                                          title: '⚠️ 永久删除警告',
                                          content: (
                                            <div>
                                              <p>此操作将永久删除该用户的所有数据：</p>
                                              <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                                                <li>项目及画布</li>
                                                <li>工作流执行记录</li>
                                                <li>风格收藏</li>
                                              </ul>
                                              <p style={{ color: '#ff4d4f' }}>此操作不可恢复</p>
                                            </div>
                                          ),
                                          okText: '确认删除',
                                          cancelText: '取消',
                                          okButtonProps: { danger: true },
                                          onOk: () => {
                                            userApi.delete(user.id)
                                              .then(() => loadUsers())
                                              .catch(() => Modal.error({ title: '删除失败' }));
                                          },
                                        });
                                      },
                                    });
                                  }}
                                  className="text-red-500 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded text-[12px] transition-colors cursor-pointer"
                                >
                                  删除
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========== 版图管理 Tab ========== */}
        {activeTab === 'banners' && (
          <>
            {/* 工具栏 */}
            <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0">
              <span className="text-[13px] text-gray-500">共 {banners?.length || 0} 个版图</span>
              <div className="flex-1" />
              <button onClick={openAddBannerDialog} className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer">
                <PlusOutlined /> 添加版图
              </button>
            </div>

            {/* Banner列表 */}
            <div className="flex-1 overflow-y-auto p-6">
              {bannersLoading ? (
                <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
              ) : (banners?.length || 0) === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <UploadOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                  <div className="text-[14px] mb-2">暂无版图</div>
                  <button onClick={openAddBannerDialog} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
                    <PlusOutlined /> 添加第一个版图
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {banners.map(banner => (
                      <div key={banner.id} className="group relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                        {/* Banner图片 */}
                        <div className="relative aspect-[16/9] bg-gray-100">
                          {banner.image_url ? (
                            <img src={banner.image_url} alt={banner.title} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-400">
                              <UploadOutlined style={{ fontSize: 20 }} />
                            </div>
                          )}
                          
                          {/* 悬浮遮罩层：标题+操作按钮 */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
                            {/* 标题 */}
                            <h3 className="text-[13px] font-medium text-white truncate mb-2">{banner.title}</h3>
                            
                            {/* 操作按钮 */}
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleToggleBannerActive(banner); }}
                                className={`flex-1 px-2 py-1 text-[11px] rounded transition-colors cursor-pointer ${
                                  banner.is_active 
                                    ? 'bg-white/20 text-white hover:bg-white/30' 
                                    : 'bg-green-500/80 text-white hover:bg-green-500'
                                }`}
                              >
                                {banner.is_active ? '禁用' : '启用'}
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openEditBannerDialog(banner); }}
                                className="flex-1 px-2 py-1 text-[11px] bg-white/20 text-white hover:bg-white/30 rounded transition-colors cursor-pointer"
                              >
                                编辑
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteBanner(banner.id); }}
                                className="flex-1 px-2 py-1 text-[11px] bg-red-500/80 text-white hover:bg-red-500 rounded transition-colors cursor-pointer"
                              >
                                删除
                              </button>
                            </div>
                          </div>
                          
                          {/* 状态标签 */}
                          <div className={`absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            banner.is_active ? 'bg-green-500 text-white' : 'bg-gray-500 text-white'
                          }`}>
                            {banner.is_active ? '启用' : '禁用'}
                          </div>
                          
                          {/* 排序标签 */}
                          <div className="absolute top-2 right-2 px-1.5 py-0.5 bg-black/50 text-white rounded text-[10px]">
                            #{banner.sort_order}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className="px-6 py-2.5 border-t border-gray-100 shrink-0 flex items-center justify-between text-[12px] text-gray-400 bg-white">
              <span>共 {banners?.length || 0} 个版图</span>
              <span>点击卡片可编辑或删除</span>
            </div>
          </>
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
      <AddShowDialog
        open={showAddShowDialog}
        onClose={() => setShowAddShowDialog(false)}
        onSuccess={() => {
          if (showPendingView) loadPendingShows();
          else { loadShows(activeShowCategory); loadShowCategories(); }
        }}
        categories={showCategories || []}
        activeCategoryId={activeShowCategory}
        editingShow={editingShow}
      />

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
                <label className={`w-[150px] h-[200px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors shrink-0 ${addFile ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'}`}>
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
                    <Select
                      value={addForm.author || undefined}
                      onChange={(val) => setAddForm(f => ({ ...f, author: val }))}
                      onSearch={fetchAuthors}
                      onOpenChange={(open) => { if (open) fetchAuthors(''); }}
                      placeholder="点击选择或输入搜索"
                      showSearch
                      allowClear
                      options={authorOptions.slice(0, 10).map(u => ({ label: u.nickname || u.email, value: u.nickname || u.email }))}
                      notFoundContent={authorSearching ? '搜索中...' : '暂无匹配用户'}
                      filterOption={false}
                      getPopupContainer={(trigger) => trigger.parentElement!}
                      style={{ width: '100%', height: 38 }}
                    />
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

      {/* ========== 版图管理：添加/编辑Banner弹窗 ========== */}
      {showAddBannerDialog && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowAddBannerDialog(false)} />
          <div className="relative w-[500px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10">
            <h3 className="text-[15px] font-semibold text-gray-800 px-6 py-4 border-b border-gray-100">
              {editingBanner ? '编辑版图' : '添加版图'}
            </h3>
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* 版图图片上传 */}
              <div>
                <label className="block text-[12px] text-gray-500 mb-1.5">
                  版图图片 {!editingBanner && <span className="text-red-400">*</span>}
                </label>
                <div 
                  onClick={() => !bannerImageUploading && addBannerFileRef.current?.click()} 
                  className={`w-full aspect-[16/9] border-2 border-dashed border-gray-200 rounded-lg flex items-center justify-center cursor-pointer hover:border-blue-300 transition-colors overflow-hidden relative ${bannerImageUploading ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {bannerImageUploading ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/80">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
                        <div className="text-[12px] text-blue-600">正在上传图片...</div>
                      </div>
                    </div>
                  ) : addBannerPreviewUrl ? (
                    <img src={addBannerPreviewUrl} alt="preview" className="w-full h-full object-cover" />
                  ) : (
                    <div className="text-center text-gray-400">
                      <UploadOutlined style={{ fontSize: 24 }} className="mb-2" />
                      <div className="text-[12px]">点击上传版图图片</div>
                      <div className="text-[11px] text-gray-400 mt-1">推荐尺寸: 1920x1080 或 16:9比例，最大50MB</div>
                    </div>
                  )}
                </div>
                <input 
                  ref={addBannerFileRef} 
                  type="file" 
                  accept=".jpg,.jpeg,.png,.webp,.gif" 
                  className="hidden" 
                  onChange={handleSelectBannerFile} 
                />
              </div>

              {/* 标题 */}
              <div>
                <label className="block text-[12px] text-gray-500 mb-1.5">
                  标题 <span className="text-red-400">*</span>
                </label>
                <input
                  value={addBannerForm.title}
                  onChange={e => setAddBannerForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="输入Banner标题"
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                />
              </div>

              {/* 描述 */}
              <div>
                <label className="block text-[12px] text-gray-500 mb-1.5">描述</label>
                <textarea
                  value={addBannerForm.description}
                  onChange={e => setAddBannerForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="输入Banner描述（可选）"
                  rows={3}
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none resize-none"
                />
              </div>

              {/* 链接地址 */}
              <div>
                <label className="block text-[12px] text-gray-500 mb-1.5">跳转链接</label>
                <input
                  value={addBannerForm.link_url}
                  onChange={e => setAddBannerForm(prev => ({ ...prev, link_url: e.target.value }))}
                  placeholder="输入点击后跳转的URL（可选）"
                  className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                />
              </div>

              {/* 排序和状态 */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-500 mb-1.5">排序</label>
                  <input
                    type="number"
                    value={addBannerForm.sort_order}
                    onChange={e => setAddBannerForm(prev => ({ ...prev, sort_order: parseInt(e.target.value) || 0 }))}
                    placeholder="数字越小越靠前"
                    className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-[12px] text-gray-500 mb-1.5">状态</label>
                  <Select
                    value={addBannerForm.is_active ? 'active' : 'inactive'}
                    onChange={(value) => setAddBannerForm(prev => ({ ...prev, is_active: value === 'active' }))}
                    options={[
                      { value: 'active', label: '启用' },
                      { value: 'inactive', label: '禁用' },
                    ]}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
              <button 
                onClick={() => { setShowAddBannerDialog(false); URL.revokeObjectURL(addBannerPreviewUrl); }} 
                className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer"
              >
                取消
              </button>
              <button 
                onClick={handleAddBannerSubmit} 
                disabled={addingBanner || (!editingBanner && !addBannerFile) || !addBannerForm.title.trim()} 
                className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {addingBanner ? '提交中...' : (editingBanner ? '保存' : '创建')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
