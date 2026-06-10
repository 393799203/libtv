import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
} from '@ant-design/icons';
import { styleApi, type StyleItem, type CategoryItem } from '@/services/styleApi';

type AdminTab = 'styles' | 'favorites' | 'settings';

export default function AdminPage() {
  const navigate = useNavigate();
  const { tab = 'styles' } = useParams<{ tab: string }>();
  const activeTab: AdminTab = (tab as AdminTab) || 'styles';

  // ========== 风格管理状态 ==========
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [showNewCatDialog, setShowNewCatDialog] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  // 添加图片弹窗
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addForm, setAddForm] = useState({ name: '', author: '', tags: '' });
  const [addFile, setAddFile] = useState<File | null>(null);
  const [addPreviewUrl, setAddPreviewUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const addFileRef = useRef<HTMLInputElement>(null);

  // 编辑模式
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', author: '', tags: '' });
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 收藏加载状态
  const [favLoading, setFavLoading] = useState(false);

  // 加载分类
  const loadCategories = () => {
    styleApi.categories().then((res) => setCategories(res)).catch(() => {});
  };

  // 加载风格列表
  const loadStyles = (cat: string) => {
    setLoading(true);
    styleApi.list({ category: cat })
      .then((res) => {
        const filtered = res.items.filter(s => !s.name.startsWith('_cat_placeholder_'));
        setStyles(filtered);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  // 加载我的收藏
  const loadFavorites = () => {
    setLoading(true);
    setFavLoading(true);
    styleApi.listFavorites()
      .then((res) => {
        setStyles(res.items);
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setFavLoading(false); });
  };

  useEffect(() => {
    if (activeTab === 'favorites') loadFavorites();
    else if (activeTab === 'styles') {
      // 先加载分类列表，选中第一个后再加载风格
      let cancelled = false;
      setLoading(true);
      styleApi.categories()
        .then((res) => {
          if (cancelled) return;
          setCategories(res);
          const cat = res.length > 0 ? res[0].category : '';
          // 始终重置为第一个分类（确保切换回来时刷新数据）
          if (cat) setActiveCategory(cat);
          if (cat) {
            return styleApi.list({ category: cat });
          }
          return { items: [] as StyleItem[], total: 0, page: 1 };
        })
        .then((res) => {
          if (cancelled || !res) return;
          const filtered = res.items.filter(s => !s.name.startsWith('_cat_placeholder_'));
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
  }, [activeCategory, activeTab]); // 依赖 activeCategory 和 activeTab

  // 切换收藏（用于"我的收藏" tab）
  const handleToggleFav = async (e: React.MouseEvent, styleId: string) => {
    e.stopPropagation();
    try {
      await styleApi.toggleFavorite(styleId);
      // 取消收藏后重新加载列表
      loadFavorites();
    } catch {}
  };

  // 新建分类
  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      await styleApi.create({
        name: `_cat_placeholder_${newCatName.trim()}`,
        category: newCatName.trim(),
        tags: [],
      });
      setShowNewCatDialog(false);
      setNewCatName('');
      loadCategories();
      setActiveCategory(newCatName.trim());
    } catch {}
    setCreatingCat(false);
  };

  // 添加图片
  const openAddDialog = () => {
    setAddForm({ name: '', author: '', tags: '' });
    setAddFile(null);
    setAddPreviewUrl('');
    setShowAddDialog(true);
  };

  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) { setAddFile(file); setAddPreviewUrl(URL.createObjectURL(file)); }
  };

  const handleAddSubmit = async () => {
    if (!addFile || !addForm.name.trim()) return;
    setAdding(true);
    try {
      const res = await styleApi.create({
        name: addForm.name.trim(),
        author: addForm.author.trim() || undefined,
        category: activeCategory,
        tags: addForm.tags ? addForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
      });
      await styleApi.uploadImage(res.id, addFile);
      setShowAddDialog(false);
      URL.revokeObjectURL(addPreviewUrl);
      loadStyles(activeCategory);
      loadCategories();
    } catch {}
    setAdding(false);
  };

  // 编辑
  const startEdit = (s: StyleItem) => {
    setEditingId(s.id);
    setEditForm({ name: s.name, author: s.author, tags: s.tags.join(', ') });
  };
  const saveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    try {
      await styleApi.update(editingId, {
        name: editForm.name.trim(), author: editForm.author.trim() || undefined,
        tags: editForm.tags ? editForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
      });
      setEditingId(null); loadStyles(activeCategory);
    } catch {}
  };

  // 删除
  const handleDelete = async (id: string) => {
    try { await styleApi.delete(id); loadStyles(activeCategory); loadCategories(); } catch {}
  };

  // 替换图片
  const handleUpload = async (id: string, file: File) => {
    setUploadingId(id);
    try { await styleApi.uploadImage(id, file); loadStyles(activeCategory); } catch {}
    setUploadingId(null);
  };

  // 侧边栏菜单
  const menuItems: { key: AdminTab; icon: React.ReactNode; label: string }[] = [
    { key: 'styles', icon: <TagOutlined />, label: '风格管理' },
    { key: 'favorites', icon: <HeartFilled />, label: '我的收藏' },
    { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
  ];

  return (
    <div className="flex h-[calc(100vh-56px)]">
      {/* 左侧边栏 */}
      <aside className="w-[200px] bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-gray-100">
          <h2 className="text-[15px] font-semibold text-gray-800">系统管理</h2>
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
        {/* ========== 风格管理 Tab ========== */}
        {activeTab === 'styles' && (
          <>
            {/* 工具栏 */}
            <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 shrink-0">
              {categories.length === 0 ? (
                <span className="text-gray-400 text-[13px]">暂无分类，点击右侧按钮创建</span>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto">
                  {categories.map(cat => (
                    <button
                      key={cat.category}
                      onClick={() => { setActiveCategory(cat.category); setEditingId(null); }}
                      className={`px-3.5 py-1.5 text-[12px] whitespace-nowrap rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
                        activeCategory === cat.category ? 'bg-blue-100 text-blue-700 font-medium' : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {cat.category}
                      <span className={`text-[10px] ${activeCategory === cat.category ? 'bg-blue-200/60 text-blue-600' : 'bg-gray-200 text-gray-400'} rounded-full px-1.5 py-px`}>
                        {cat.count}
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
              {!activeCategory && categories.length > 0 && (
                <div className="flex flex-col items-center justify-center h-full text-gray-400">
                  <FolderAddOutlined style={{ fontSize: 40 }} className="mb-3 opacity-40" />
                  <div className="text-[14px]">选择一个分类查看或上传图片</div>
                </div>
              )}
              {loading ? (
                <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
              ) : activeCategory && styles.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                  <UploadOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                  <div className="text-[14px] mb-2">「{activeCategory}」暂无风格图片</div>
                  <button onClick={openAddDialog} className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">
                    <PlusOutlined /> 上传第一张图片
                  </button>
                </div>
              ) : activeCategory && styles.length > 0 ? (
                <>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-gray-500">{styles.length} 张图片</span>
                  </div>
                  <div className="grid grid-cols-4 gap-4">
                    {styles.map(style => (
                      <div key={style.id} className={`group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all ${editingId === style.id ? 'ring-2 ring-blue-400' : ''}`}>
                        <div className="aspect-[4/3] relative bg-gray-100">
                          {style.image_url ? (
                            <img src={style.image_url} alt={style.name} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-gray-300 text-[12px]">暂无图片</div>
                          )}

                          {/* 右上角标签 */}
                          {style.tags.length > 0 && (
                            <div className="absolute top-2 right-2 flex gap-1 z-10 flex-wrap">
                              {style.tags.slice(0, 2).map(tag => (
                                <span key={tag} className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          {/* Hover 操作栏 */}
                          <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                            <button onClick={() => startEdit(style)} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 cursor-pointer" title="编辑信息">
                              <EditOutlined style={{ fontSize: 11 }} />
                            </button>
                            <button onClick={() => fileInputRef.current?.click()} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 cursor-pointer" title="替换图片">
                              <UploadOutlined style={{ fontSize: 11 }} />
                            </button>
                            <button onClick={() => handleDelete(style.id)} className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/50 cursor-pointer" title="删除">
                              <DeleteOutlined style={{ fontSize: 11 }} />
                            </button>
                          </div>
                          {uploadingId === style.id && (
                            <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20">
                              <span className="text-white text-[12px]">上传中...</span>
                            </div>
                          )}
                          {/* 编辑模式 */}
                          {editingId === style.id && (
                            <div className="absolute inset-0 z-25 bg-white/95 backdrop-blur-sm p-3 flex flex-col gap-2">
                              <input autoFocus value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} placeholder="风格名称 *" className="px-2.5 py-1.5 text-[12px] bg-white border border-blue-300 rounded-lg focus:border-blue-500 outline-none" />
                              <input value={editForm.author} onChange={e => setEditForm(f => ({ ...f, author: e.target.value }))} placeholder="作者" className="px-2.5 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg focus:border-blue-400 outline-none" />
                              <input value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))} placeholder="标签（逗号分隔）" className="px-2.5 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg focus:border-blue-400 outline-none" />
                              <div className="flex gap-2 mt-auto">
                                <button onClick={saveEdit} className="flex-1 py-1.5 text-[12px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">保存</button>
                                <button onClick={() => setEditingId(null)} className="flex-1 py-1.5 text-[12px] bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 cursor-pointer">取消</button>
                              </div>
                            </div>
                          )}
                          {/* 底部浮层 + 点赞数 */}
                          {editingId !== style.id && (
                            <>
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
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : null}

              <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.gif" className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f && editingId) handleUpload(editingId, f);
                  else if (f && activeCategory) { openAddDialog(); setAddFile(f); setAddPreviewUrl(URL.createObjectURL(f)); }
                  e.target.value = '';
                }}
              />
            </div>

            <div className="px-6 py-2.5 border-t border-gray-100 shrink-0 flex items-center justify-between text-[12px] text-gray-400 bg-white">
              <span>共 {categories.length} 个分类 · {activeCategory ? `${styles.length} 张图片` : ''}</span>
              <span>Hover 卡片可编辑 / 替换 / 删除</span>
            </div>
          </>
        )}

        {/* ========== 我的收藏 Tab ========== */}
        {activeTab === 'favorites' && (
          <div className="flex-1 overflow-y-auto p-6">
            {favLoading || loading ? (
              <div className="flex items-center justify-center py-20"><span className="text-gray-400">加载中...</span></div>
            ) : styles.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                <HeartOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                <div className="text-[14px] mb-2">暂无收藏</div>
                <span className="text-[12px]">在风格管理中点击卡片上的心形图标即可收藏</span>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] text-gray-500">共 {styles.length} 个收藏</span>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {styles.map(style => (
                    <div key={style.id} className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
                      <div className="aspect-[4/3] relative bg-gray-100">
                        {style.image_url ? (
                          <img src={style.image_url} alt={style.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300 text-[12px]">暂无图片</div>
                        )}

                        {/* 右上角标签 */}
                        {style.tags.length > 0 && (
                          <div className="absolute top-2 right-2 flex gap-1 z-10 flex-wrap">
                            {style.tags.slice(0, 2).map(tag => (
                              <span key={tag} className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}

                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5 z-10">
                          <p className="text-white text-[13px] font-medium truncate drop-shadow">{style.name}</p>
                          <div className="flex items-center justify-between mt-1">
                            {style.author && <span className="text-white/70 text-[11px] truncate mr-2">{style.author}</span>}
                            {/* 点赞数显示 */}
                            <div className="flex items-center gap-1 text-white/70 text-[10px]">
                              <HeartFilled style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }} />
                              <span>{style.likes || 0}</span>
                            </div>
                          </div>
                        </div>
                        {/* 取消收藏按钮 */}
                        <button
                          onClick={(e) => handleToggleFav(e, style.id)}
                          className="absolute bottom-2 right-2 z-20 w-7 h-7 flex items-center justify-center rounded-full bg-red-500/80 backdrop-blur-md cursor-pointer hover:bg-red-500 transition-colors"
                          title="取消收藏"
                        >
                          <HeartFilled style={{ color: '#fff', fontSize: 13 }} />
                        </button>
                      </div>
                    </div>
                  ))}
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
            <h3 className="text-[15px] font-semibold text-gray-800 px-6 py-4 border-b border-gray-100">添加风格图片 — {activeCategory}</h3>
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
              <button onClick={handleAddSubmit} disabled={!addFile || !addForm.name.trim() || adding} className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                {adding ? '添加中...' : '确认添加'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
