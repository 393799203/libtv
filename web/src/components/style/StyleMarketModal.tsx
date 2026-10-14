import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { HeartFilled, HeartOutlined } from '@ant-design/icons';
import { styleApi, type StyleItem, type CategoryItem } from '@/services/styleApi';

/**
 * 风格市场弹窗（广场 / 我的收藏 + 分类 + 搜索 + 收藏）
 *
 * 为什么抽出来：这个弹窗原本长在 StyleSelector 里（节点内选风格），
 * 现在左侧「风格素材」入口也要用同一套浏览体验。同一个市场在两处各写一遍，
 * 以后加分类、改卡片样式就会出现「一处改了另一处忘」的分叉，所以收敛成一个组件，
 * 由调用方通过 onPick 决定「选中一个风格之后干什么」：
 *   · 节点内选风格 → 把风格节点接到当前节点上
 *   · 左侧入口      → 直接在画布上建一个图片节点并带上该风格
 *
 * 本组件只负责「浏览 + 选中」，不碰画布。
 */
interface StyleMarketModalProps {
  onClose: () => void;
  /** 选中一个风格。关闭弹窗由本组件负责，调用方只管业务动作 */
  onPick: (style: StyleItem) => void;
  /** 当前已选风格 id（卡片高亮 + 勾选角标） */
  selectedStyleId?: string;
  /** 顶部说明文案：让用户先知道「点了会发生什么」 */
  hint?: string;
}

/**
 * 调用方按需挂载（`{open && <StyleMarketModal ... />}`），组件本身不带 open 开关。
 * 这样每次打开都是全新实例：分类/搜索/所在 Tab 自动回到初始态，
 * 也省掉了「在 effect 里同步 setState 重置」那种会引起级联渲染的写法。
 */
export function StyleMarketModal({
  onClose,
  onPick,
  selectedStyleId,
  hint,
}: StyleMarketModalProps) {
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [styleLoading, setStyleLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [favoritedMap, setFavoritedMap] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'market' | 'favorites'>('market');

  /** 批量回填收藏态（失败静默：收藏态只是装饰，不该挡住列表渲染） */
  const syncFavorited = useCallback((items: StyleItem[]) => {
    if (items.length === 0) return;
    styleApi.checkFavorited(items.map((s) => s.id))
      .then(setFavoritedMap)
      .catch(() => {});
  }, []);

  // 加载收藏列表
  const loadFavorites = useCallback(() => {
    setStyleLoading(true);
    styleApi.listFavorites()
      .then((res) => {
        const items = res.items || [];
        setStyles(items);
        syncFavorited(items);
      })
      .catch(() => {})
      .finally(() => setStyleLoading(false));
  }, [syncFavorited]);

  // 切换分类/搜索
  const handleFilterChange = useCallback((category?: string, keyword?: string) => {
    if (category !== undefined) setActiveCategory(category);
    if (keyword !== undefined) setSearchKeyword(keyword);
    setStyleLoading(true);
    const cat = category ?? activeCategory;
    styleApi.list({ category_id: cat || undefined, keyword: keyword ?? searchKeyword })
      .then((res) => {
        const items = res.items || [];
        setStyles(items);
        syncFavorited(items);
      })
      .catch(() => {})
      .finally(() => setStyleLoading(false));
  }, [activeCategory, searchKeyword, syncFavorited]);

  // 挂载即加载：先取分类列表，选中第一个后再加载该分类下的风格
  useEffect(() => {
    let cancelled = false;
    styleApi.categories()
      .then((res) => {
        if (cancelled) return;
        setCategories(res || []);
        // 自动选中第一个分类
        const catId = (res || []).length > 0 ? res[0].id : '';
        if (catId) setActiveCategory(catId);
        // 用选中的分类加载风格
        return styleApi.list({ category_id: catId || undefined });
      })
      .then((res) => {
        if (cancelled || !res) return;
        const items = res.items || [];
        setStyles(items);
        syncFavorited(items);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setStyleLoading(false); });
    return () => { cancelled = true; };
    // 只在挂载时跑一次；后续筛选/搜索走 handleFilterChange
  }, [syncFavorited]);

  // 切换收藏
  const handleToggleFav = async (e: React.MouseEvent, styleId: string) => {
    e.stopPropagation();
    try {
      const res = await styleApi.toggleFavorite(styleId);
      setFavoritedMap((prev) => ({ ...prev, [styleId]: res.favorited }));
    } catch {
      // 收藏失败不打扰用户（多为未登录/网络抖动），列表照常可用
    }
  };

  /** 选中：先通知调用方，再关闭弹窗 */
  const handlePick = useCallback((style: StyleItem) => {
    onPick(style);
    onClose();
  }, [onPick, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* 遮罩 */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* 居中面板 */}
      <div className="relative w-[700px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
        {/* 顶部栏：标题 + Tab + 搜索 + 关闭 */}
        <div className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-100 shrink-0">
          {/* Tab 切换 */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => { setActiveTab('market'); handleFilterChange(activeCategory); }}
              className={`px-4 py-1.5 text-[13px] rounded-md transition-all cursor-pointer ${
                activeTab === 'market'
                  ? 'bg-white text-gray-800 font-medium shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              广场
            </button>
            <button
              onClick={() => { setActiveTab('favorites'); loadFavorites(); }}
              className={`px-4 py-1.5 text-[13px] rounded-md transition-all cursor-pointer ${
                activeTab === 'favorites'
                  ? 'bg-white text-gray-800 font-medium shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              我的收藏
            </button>
          </div>

          {/* 搜索（仅广场显示） */}
          {activeTab === 'market' && (
            <div className="flex-1 max-w-xs">
              <input
                placeholder="搜索风格名称、作者、标签"
                className="w-full px-3 py-1.5 text-[13px] bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                onChange={(e) => handleFilterChange(undefined, e.target.value)}
              />
            </div>
          )}

          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 cursor-pointer transition-colors ml-auto shrink-0"
          >
            ✕
          </button>
        </div>

        {/* 行为说明：两处入口的「选中之后」不一样，先说清楚再让人点 */}
        {hint && (
          <div className="px-5 py-2 text-[12px] text-gray-500 bg-blue-50/60 border-b border-blue-100/60 shrink-0">
            {hint}
          </div>
        )}

        {/* 分类标签栏（仅广场） */}
        {activeTab === 'market' && (
          <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-50 overflow-x-auto shrink-0">
            {(categories?.length || 0) === 0 ? (
              <span className="text-[12px] text-gray-400">暂无分类</span>
            ) : (categories || []).map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleFilterChange(cat.id)}
                className={`px-3 py-1 text-[12px] whitespace-nowrap rounded-full transition-colors cursor-pointer ${
                  activeCategory === cat.id ? 'text-gray-800 font-medium bg-gray-100' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* 风格卡片网格 */}
        <div className="flex-1 overflow-y-auto p-5">
          {styleLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400 text-[13px]">加载中...</div>
            </div>
          ) : (styles?.length || 0) === 0 ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-gray-400 text-[13px]">暂无风格</div>
            </div>
          ) : (
            <div className="grid grid-cols-6 gap-2.5">
              {(styles || []).map((style) => (
                <div
                  key={style.id}
                  onClick={() => handlePick(style)}
                  className={`group relative rounded-xl overflow-hidden border transition-all cursor-pointer ${
                    selectedStyleId === style.id
                      ? 'border-blue-400 ring-2 ring-blue-100'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                  }`}
                >
                  {/* 全图 */}
                  <img
                    src={style.image_url}
                    alt={style.name}
                    className="aspect-[3/4] w-full object-cover group-hover:opacity-90 transition-opacity"
                  />

                  {/* 左上角标签 */}
                  {(style.tags?.length || 0) > 0 && (
                    <div className="absolute top-2 left-2 right-8 flex gap-1 z-10 flex-wrap">
                      {(style.tags || []).slice(0, 2).map(tag => (
                        <span key={tag} className="px-1.5 py-0.5 bg-black/50 backdrop-blur-sm text-white text-[9px] rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* 底部透明浮层 */}
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-7 pb-2">
                    <p className="text-white text-[12px] font-medium truncate drop-shadow">{style.name}</p>
                    {style.author && (
                      <span className="text-white/70 text-[10px] truncate block mt-0.5">{style.author}</span>
                    )}
                  </div>

                  {/* 收藏按钮 */}
                  <button
                    onClick={(e) => handleToggleFav(e, style.id)}
                    className="absolute bottom-2 right-2 z-20 w-6 h-6 flex items-center justify-center rounded-full backdrop-blur-md cursor-pointer transition-colors"
                    style={{ background: favoritedMap[style.id] ? 'rgba(239,68,68,0.8)' : 'rgba(0,0,0,0.35)' }}
                    title={favoritedMap[style.id] ? '取消收藏' : '收藏'}
                  >
                    {favoritedMap[style.id]
                      ? <HeartFilled style={{ color: '#fff', fontSize: 11 }} />
                      : <HeartOutlined style={{ color: '#fff', fontSize: 11 }} />
                    }
                  </button>

                  {/* 选中标记 */}
                  {selectedStyleId === style.id && (
                    <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm z-20">
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}