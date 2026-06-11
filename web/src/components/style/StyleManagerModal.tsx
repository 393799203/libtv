import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Select } from 'antd';
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  UploadOutlined,
  TagOutlined,
  FolderAddOutlined,
} from '@ant-design/icons';
import { styleApi, type StyleItem, type CategoryItem } from '@/services/styleApi';
import { userApi, type UserItem } from '@/services/userApi';

interface StyleManagerModalProps {
  open: boolean;
  onClose: () => void;
}

export function StyleManagerModal({ open, onClose }: StyleManagerModalProps) {
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [showNewCatDialog, setShowNewCatDialog] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [creatingCat, setCreatingCat] = useState(false);

  // 添加图片弹窗状态
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

  // 作者选择
  const [authorOptions, setAuthorOptions] = useState<UserItem[]>([]);
  const [authorSearching, setAuthorSearching] = useState(false);
  const authorFetchIdRef = useRef(0);
  const authorDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchAuthors = (keyword: string) => {
    const fetchId = ++authorFetchIdRef.current;
    const needDebounce = keyword.trim().length > 0;
    if (needDebounce && authorDebounceRef.current) clearTimeout(authorDebounceRef.current);

    const doFetch = async () => {
      setAuthorSearching(true);
      try {
        const res = await userApi.search(keyword.trim());
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

  // 加载分类列表
  const loadCategories = () => {
    styleApi.categories()
      .then((res) => setCategories(res))
      .catch(() => {});
  };

  // 加载当前分类下的风格
  const loadStyles = (categoryId: string) => {
    setLoading(true);
    styleApi.list({ category_id: categoryId })
      .then((res) => setStyles((res.items || []).filter(s => !s.name.startsWith('_cat_placeholder_'))))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) loadCategories();
  }, [open]);

  useEffect(() => {
    if (open && activeCategory) loadStyles(activeCategory);
  }, [open, activeCategory]);

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
        const newCat = res.find(c => c.name === newCatName.trim());
        if (newCat) setActiveCategory(newCat.id);
      }
    } catch {}
    setCreatingCat(false);
  };

  // 打开添加弹窗
  const openAddDialog = () => {
    setAddForm({ name: '', author: '', tags: '' });
    setAddFile(null);
    setAddPreviewUrl('');
    setShowAddDialog(true);
    if (authorOptions.length === 0) fetchAuthors('');
  };

  // 选择文件预览
  const handleSelectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setAddFile(file);
      setAddPreviewUrl(URL.createObjectURL(file));
    }
  };

  // 提交添加（一次性完成创建+上传+填信息）
  const handleAddSubmit = async () => {
    if (!addFile || !addForm.name.trim()) return;
    setAdding(true);
    try {
      const res = await styleApi.create({
        name: addForm.name.trim(),
        author: addForm.author.trim() || undefined,
        category_id: activeCategory,
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
    if (authorOptions.length === 0) fetchAuthors('');
  };

  const saveEdit = async () => {
    if (!editingId || !editForm.name.trim()) return;
    try {
      await styleApi.update(editingId, {
        name: editForm.name.trim(),
        author: editForm.author.trim() || undefined,
        tags: editForm.tags ? editForm.tags.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [],
      });
      setEditingId(null);
      loadStyles(activeCategory);
    } catch {}
  };

  // 删除
  const handleDelete = async (id: string) => {
    try {
      await styleApi.delete(id);
      loadStyles(activeCategory);
      loadCategories();
    } catch {}
  };

  // 替换图片
  const handleUpload = async (id: string, file: File) => {
    setUploadingId(id);
    try {
      await styleApi.uploadImage(id, file);
      loadStyles(activeCategory);
    } catch {}
    setUploadingId(null);
  };

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-[1200px] max-h-[88vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* 头部 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <TagOutlined className="text-blue-500 text-lg" />
            <span className="text-[16px] font-semibold text-gray-800">风格图库管理</span>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 cursor-pointer transition-colors">
            ✕
          </button>
        </div>

        {/* 工具栏 */}
        <div className="flex items-center gap-3 px-6 py-3 border-b border-gray-50 shrink-0">
          {(categories?.length || 0) === 0 ? (
            <span className="text-gray-400 text-[13px]">暂无分类，点击右侧按钮创建</span>
          ) : (
            <div className="flex gap-1.5 overflow-x-auto">
              {(categories || []).map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => { setActiveCategory(cat.id); setEditingId(null); }}
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
          {/* 新建分类 */}
          <button
            onClick={() => setShowNewCatDialog(true)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors cursor-pointer"
          >
            <FolderAddOutlined />
            新建分类
          </button>
          {/* 添加图片（选中分类后才显示） */}
          {activeCategory && (
            <button
              onClick={openAddDialog}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
            >
              <PlusOutlined />
              添加图片
            </button>
          )}
        </div>

        {/* 图墙区域 — 全图 + 底部透明浮层 */}
        <div className="flex-1 overflow-y-auto p-6 relative">
          {(!activeCategory) && (categories?.length || 0) > 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <FolderAddOutlined style={{ fontSize: 40 }} className="mb-3 opacity-40" />
              <div className="text-[14px]">选择一个分类查看或上传图片</div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400 text-[14px]">加载中...</div>
            </div>
          ) : activeCategory && (styles?.length || 0) === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-gray-400">
              <UploadOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
              <div className="text-[14px] mb-2">「{categories?.find(c => c.id === activeCategory)?.name || activeCategory}」暂无风格图片</div>
              <button
                onClick={openAddDialog}
                className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors cursor-pointer"
              >
                <PlusOutlined />
                上传第一张图片
              </button>
            </div>
          ) : activeCategory && (styles?.length || 0) > 0 ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <span className="text-[13px] text-gray-500">{styles?.length || 0} 张图片</span>
              </div>
              <div className="grid grid-cols-6 gap-3">
                {(styles || []).map((style) => (
                  <div
                    key={style.id}
                    className={`group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all ${
                      editingId === style.id ? 'ring-2 ring-blue-400' : ''
                    }`}
                  >
                    {/* 全图区域 */}
                    <div className="aspect-[9/16] relative bg-gray-100">
                      {style.image_url ? (
                        <img src={style.image_url} alt={style.name} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-gray-300 text-[12px]">暂无图片</div>
                      )}

                      {/* Hover 操作栏 */}
                      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                        <button
                          onClick={() => startEdit(style)}
                          className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 cursor-pointer"
                          title="编辑信息"
                        >
                          <EditOutlined style={{ fontSize: 11 }} />
                        </button>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-white/90 hover:text-white hover:bg-black/70 cursor-pointer"
                          title="替换图片"
                        >
                          <UploadOutlined style={{ fontSize: 11 }} />
                        </button>
                        <button
                          onClick={() => handleDelete(style.id)}
                          className="w-7 h-7 bg-black/50 backdrop-blur-sm rounded-lg flex items-center justify-center text-red-400 hover:text-red-300 hover:bg-red-900/50 cursor-pointer"
                          title="删除"
                        >
                          <DeleteOutlined style={{ fontSize: 11 }} />
                        </button>
                      </div>

                      {/* 上传中遮罩 */}
                      {uploadingId === style.id && (
                        <div className="absolute inset-0 bg-black/30 flex items-center justify-center z-20">
                          <div className="text-white text-[12px]">上传中...</div>
                        </div>
                      )}

                      {/* 编辑模式内联表单 */}
                      {editingId === style.id && (
                        <div className="absolute inset-0 z-25 bg-white/95 backdrop-blur-sm p-3 flex flex-col gap-2">
                          <input
                            autoFocus
                            value={editForm.name}
                            onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                            placeholder="风格名称 *"
                            className="px-2.5 py-1.5 text-[12px] bg-white border border-blue-300 rounded-lg focus:border-blue-500 outline-none"
                          />
                          <Select
                            value={editForm.author || undefined}
                            onChange={(val) => setEditForm(f => ({ ...f, author: val }))}
                            onSearch={fetchAuthors}
                            onDropdownVisibleChange={(open) => { if (open && authorOptions.length === 0) fetchAuthors(''); }}
                            placeholder="选择作者"
                            showSearch
                            allowClear
                            size="small"
                            options={authorOptions.slice(0, 10).map(u => ({ label: u.nickname || u.email, value: u.nickname || u.email }))}
                            notFoundContent={authorSearching ? '搜索中...' : '暂无匹配用户'}
                            filterOption={false}
                            getPopupContainer={(trigger) => trigger.parentElement!}
                            style={{ width: '100%' }}
                          />
                          <input
                            value={editForm.tags}
                            onChange={(e) => setEditForm(f => ({ ...f, tags: e.target.value }))}
                            placeholder="标签（逗号分隔）"
                            className="px-2.5 py-1.5 text-[12px] bg-white border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                          />
                          <div className="flex gap-2 mt-auto">
                            <button onClick={saveEdit} className="flex-1 py-1.5 text-[12px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer">保存</button>
                            <button onClick={() => setEditingId(null)} className="flex-1 py-1.5 text-[12px] bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 cursor-pointer">取消</button>
                          </div>
                        </div>
                      )}

                      {/* 底部透明浮层（非编辑模式） */}
                      {editingId !== style.id && (
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5 z-10">
                          <p className="text-white text-[13px] font-medium truncate drop-shadow">{style.name}</p>
                          <div className="flex items-center justify-between mt-1">
                            {style.author ? (
                              <span className="text-white/70 text-[11px] truncate mr-2">{style.author}</span>
                            ) : <span />}
                            <div className="flex gap-1 flex-wrap justify-end">
                              {(style.tags || []).slice(0, 3).map(tag => (
                                <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-white/15 text-white/80 rounded-full backdrop-blur-sm">{tag}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          {/* 隐藏文件输入（替换图片用） */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".jpg,.jpeg,.png,.webp,.gif"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && editingId) handleUpload(editingId, file);
              else if (file && !editingId && activeCategory) {
                openAddDialog();
                setAddFile(file);
                setAddPreviewUrl(URL.createObjectURL(file));
              }
              e.target.value = '';
            }}
          />
        </div>

        {/* 底部统计 */}
        <div className="px-6 py-2.5 border-t border-gray-100 shrink-0 flex items-center justify-between text-[12px] text-gray-400">
          <span>共 {categories?.length || 0} 个分类 · {activeCategory ? `${styles?.length || 0} 张图片` : ''}</span>
          <span>Hover 卡片可编辑 / 替换 / 删除</span>
        </div>

        {/* ========== 添加图片弹窗（一次性完成选图 + 填信息）========== */}
        {showAddDialog && createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => { setShowAddDialog(false); URL.revokeObjectURL(addPreviewUrl); }} />

            <div className="relative w-[520px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-150">
              <h3 className="text-[15px] font-semibold text-gray-800 px-6 py-4 border-b border-gray-100">
                添加风格图片 — {categories?.find(c => c.id === activeCategory)?.name || activeCategory}
              </h3>

              <div className="p-6 space-y-4">
                {/* 图片选择 + 预览 */}
                <div className="flex gap-4">
                  {/* 上传区 */}
                  <label className={`w-[150px] h-[200px] rounded-lg border-2 border-dashed flex flex-col items-center justify-center cursor-pointer transition-colors shrink-0 ${
                    addFile ? 'border-green-300 bg-green-50' : 'border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                  }`}>
                    {addPreviewUrl ? (
                      <img src={addPreviewUrl} alt="" className="w-full h-full object-cover rounded-md" />
                    ) : (
                      <>
                        <UploadOutlined className="text-gray-400 text-xl mb-1" />
                        <span className="text-[12px] text-gray-400">选择图片</span>
                      </>
                    )}
                    <input
                      ref={addFileRef}
                      type="file"
                      accept=".jpg,.jpeg,.png,.webp,.gif"
                      className="hidden"
                      onChange={handleSelectFile}
                    />
                  </label>

                  {/* 信息填写 */}
                  <div className="flex-1 space-y-2.5">
                    <div>
                      <label className="text-[11px] text-gray-500 mb-0.5 block">风格名称 *</label>
                      <input
                        value={addForm.name}
                        onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="输入风格名称"
                        className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 mb-0.5 block">作者</label>
                      <Select
                        value={addForm.author || undefined}
                        onChange={(val) => setAddForm(f => ({ ...f, author: val }))}
                        onSearch={fetchAuthors}
                        onDropdownVisibleChange={(open) => { if (open && authorOptions.length === 0) fetchAuthors(''); }}
                        placeholder="点击选择或输入搜索"
                        showSearch
                        allowClear
                        options={authorOptions.slice(0, 10).map(u => ({ label: u.nickname || u.email, value: u.nickname || u.email }))}
                        notFoundContent={authorSearching ? '搜索中...' : '暂无匹配用户'}
                        filterOption={false}
                        getPopupContainer={(trigger) => trigger.parentElement!}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-gray-500 mb-0.5 block">标签</label>
                      <input
                        value={addForm.tags}
                        onChange={(e) => setAddForm(f => ({ ...f, tags: e.target.value }))}
                        placeholder="逗号分隔，如：写实,油画,风景"
                        className="w-full px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
                <button
                  onClick={() => { setShowAddDialog(false); URL.revokeObjectURL(addPreviewUrl); }}
                  className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleAddSubmit}
                  disabled={!addFile || !addForm.name.trim() || adding}
                  className="px-5 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
                >
                  {adding ? '上传中...' : '确认添加'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {/* ========== 新建分类弹窗 ========== */}
        {showNewCatDialog && createPortal(
          <div className="fixed inset-0 z-[10000] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/40" onClick={() => setShowNewCatDialog(false)} />
            <div className="relative w-[380px] bg-white rounded-xl shadow-xl border border-gray-200 p-6 z-10 animate-in fade-in zoom-in-95 duration-150">
              <h3 className="text-[15px] font-semibold text-gray-800 mb-4">新建分类</h3>
              <input
                autoFocus
                placeholder="输入分类名称"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreateCategory()}
                className="w-full px-3 py-2.5 text-[13px] border border-gray-200 rounded-lg outline-none focus:border-blue-400 mb-4"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowNewCatDialog(false)}
                  className="px-4 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 rounded-lg cursor-pointer"
                >
                  取消
                </button>
                <button
                  onClick={handleCreateCategory}
                  disabled={!newCatName.trim() || creatingCat}
                  className="px-4 py-1.5 text-[13px] bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 cursor-pointer"
                >
                  {creatingCat ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      </div>
    </div>,
    document.body
  );
}
