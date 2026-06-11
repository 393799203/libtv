import { memo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  PictureOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
  CodeOutlined,
  CloseOutlined,
  HeartFilled,
  HeartOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import type { UpstreamInput } from '@/types/prompt';
import type { ImageNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { styleApi, type StyleItem, type CategoryItem } from '@/services/styleApi';
import { createDefaultNodeData } from '@/utils/nodeFactory';

interface PromptUpstreamBarProps {
  inputs: UpstreamInput[];
  onInsertMention: (input: UpstreamInput) => void;
  /** 当前节点 ID，用于删除连线时定位边 */
  targetNodeId?: string;
  /** 是否显示风格选择按钮（仅图片节点） */
  showStyleSelector?: boolean;
}

const NODE_TYPE_ICON: Record<UpstreamInput['nodeType'], React.ReactNode> = {
  image: <PictureOutlined className="text-blue-500" />,
  video: <VideoCameraOutlined className="text-red-500" />,
  text: <FileTextOutlined className="text-purple-500" />,
  script: <CodeOutlined className="text-amber-500" />,
};

export const PromptUpstreamBar = memo<PromptUpstreamBarProps>(function PromptUpstreamBar({
  inputs,
  onInsertMention,
  targetNodeId,
  showStyleSelector = false,
}) {
  // 仅订阅 action 函数（zustand 中这些是稳定引用），不订阅 nodes/edges 数组
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdgeFn = useCanvasStore((s) => s.addEdge);
  const removeNodes = useCanvasStore((s) => s.removeNodes);
  const [hoveredItem, setHoveredItem] = useState<UpstreamInput | null>(null);
  const [hoverPos, setHoverPos] = useState<{ mouseX: number; thumbTop: number }>({ mouseX: 0, thumbTop: 0 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 风格选择状态
  const [selectedStyle, setSelectedStyle] = useState<StyleItem | undefined>(undefined);
  const [styleMarketOpen, setStyleMarketOpen] = useState(false);
  const [styles, setStyles] = useState<StyleItem[]>([]);
  const [styleLoading, setStyleLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [favoritedMap, setFavoritedMap] = useState<Record<string, boolean>>({});
  const [activeTab, setActiveTab] = useState<'market' | 'favorites'>('market');
  // 风格在画布上对应的图片节点 ID
  const [styleNodeId, setStyleNodeId] = useState<string | null>(null);

  // 从上游连线推导风格状态（重新聚焦时）
  useEffect(() => {
    if (!targetNodeId) return;
    const { nodes, edges } = useCanvasStore.getState();
    // 找到上游"风格-"节点
    const styleNode = nodes.find((n) =>
      n.id.startsWith('style-') &&
      edges.some((e) => e.source === n.id && e.target === targetNodeId)
    );
    if (styleNode) {
      // 从风格节点本身取信息（styleId 存在风格节点 data 里）
      const sd = styleNode.data as ImageNodeData;
      setSelectedStyle({
        id: (sd as Record<string, string>).styleId || '',
        name: styleNode.data.label!.replace('风格-', ''),
        image_url: sd.imageUrl || '',
      } as StyleItem);
      setStyleNodeId(styleNode.id);
    } else {
      setSelectedStyle(undefined);
      setStyleNodeId(null);
    }
  }, [targetNodeId]);

  // 加载收藏列表
  const loadFavorites = useCallback(() => {
    setStyleLoading(true);
    styleApi.listFavorites()
      .then((res) => {
        const items = res.items || [];
        setStyles(items);
        if (items.length > 0) {
          styleApi.checkFavorited(items.map(s => s.id))
            .then(setFavoritedMap)
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setStyleLoading(false));
  }, []);

  // 选中风格：先清理旧风格，再创建新图片节点 + 连接
  const handleSelectStyle = useCallback((style: StyleItem) => {
    setSelectedStyle(style);
    setStyleMarketOpen(false);

    if (!targetNodeId) return;

    // 如果已有旧风格节点，先删除它和连线
    if (styleNodeId) {
      const { edges } = useCanvasStore.getState();
      const oldEdge = edges.find(
        (ed) => ed.source === styleNodeId && ed.target === targetNodeId
      );
      if (oldEdge) removeEdges([oldEdge.id]);
      removeNodes([styleNodeId]);
    }

    // 按需读取当前节点位置（不订阅 nodes，避免无关更新触发重渲染）
    const { nodes } = useCanvasStore.getState();
    const current = nodes.find((n) => n.id === targetNodeId);
    const posX = (current?.position.x ?? 0) - 350;
    const posY = current?.position.y ?? 0;

    const newNodeId = `style-${Date.now()}`;
    const nodeData = createDefaultNodeData('image') as ImageNodeData;
    nodeData.label = `风格-${style.name}`;
    nodeData.imageUrl = style.image_url;
    // 把后端 styleId 存到风格节点上，恢复时从这里取
    (nodeData as Record<string, string>).styleId = style.id;

    addNode({
      id: newNodeId,
      type: 'image',
      position: { x: posX, y: posY },
      data: nodeData,
      style: { width: 280 },
    });
    addEdgeFn({
      id: `e-${newNodeId}-${targetNodeId}`,
      source: newNodeId,
      target: targetNodeId,
      type: 'dataFlow',
    });
    setStyleNodeId(newNodeId);
  }, [targetNodeId, styleNodeId, addNode, addEdgeFn, removeNodes, removeEdges]);

  // 移除风格：删除连线 + 删除图片节点
  const handleRemoveStyle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedStyle(undefined);

    if (!styleNodeId || !targetNodeId) return;

    // 按需读取 edges（不订阅，避免无关更新触发重渲染）
    const { edges } = useCanvasStore.getState();
    const edge = edges.find(
      (ed) => ed.source === styleNodeId && ed.target === targetNodeId
    );
    if (edge) removeEdges([edge.id]);

    // 删除图片节点
    removeNodes([styleNodeId]);
    setStyleNodeId(null);
  }, [styleNodeId, targetNodeId, removeEdges, removeNodes]);

  // 切换收藏
  const handleToggleFav = async (e: React.MouseEvent, styleId: string) => {
    e.stopPropagation();
    try {
      const res = await styleApi.toggleFavorite(styleId);
      setFavoritedMap(prev => ({ ...prev, [styleId]: res.favorited }));
    } catch {}
  };

  // 打开弹窗时：先加载分类列表，选中第一个后再加载风格
  useEffect(() => {
    if (!styleMarketOpen) return;
    let cancelled = false;
    setStyleLoading(true);
    styleApi.categories()
      .then((res) => {
        if (cancelled) return;
        setCategories(res || []);
        // 自动选中第一个分类
        const catId = (res || []).length > 0 ? res[0].id : '';
        if (catId && !activeCategory) setActiveCategory(catId);
        // 用选中的分类加载风格
        return styleApi.list({ category_id: catId || activeCategory || undefined, keyword: searchKeyword });
      })
      .then((res) => {
        if (cancelled || !res) return;
        setStyles(res.items || []);
        if ((res.items || []).length > 0) {
          styleApi.checkFavorited(res.items.map(s => s.id))
            .then(setFavoritedMap)
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setStyleLoading(false); });
    return () => { cancelled = true; };
  }, [styleMarketOpen]);

  // 切换分类/搜索
  const handleFilterChange = useCallback((category?: string, keyword?: string) => {
    if (category !== undefined) setActiveCategory(category);
    if (keyword !== undefined) setSearchKeyword(keyword);
    setStyleLoading(true);
    styleApi.list({ category_id: category ?? activeCategory, keyword: keyword ?? searchKeyword })
      .then((res) => {
        setStyles(res.items || []);
        if ((res.items || []).length > 0) {
          styleApi.checkFavorited(res.items.map(s => s.id))
            .then(setFavoritedMap)
            .catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => setStyleLoading(false));
  }, [activeCategory, searchKeyword]);

  // 鼠标进入缩略图区域：显示预览浮层
  const handleThumbEnter = useCallback((e: React.MouseEvent, input: UpstreamInput) => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; }
    setHoveredItem(input);
    setHoverPos({
      mouseX: e.clientX,
      thumbTop: e.currentTarget.getBoundingClientRect().top,
    });
  }, []);

  // 鼠标离开缩略图：延迟隐藏
  const handleThumbLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setHoveredItem(null), 150);
  }, []);

  // 删除连线：通过 source+target 匹配真实 edge ID（不依赖手动拼接格式）
  const handleRemove = useCallback(
    (e: React.MouseEvent, upstreamNodeId: string) => {
      e.stopPropagation();
      e.preventDefault();
      if (!targetNodeId) return;
      // 按需读取 edges
      const { edges } = useCanvasStore.getState();
      const edge = edges.find(
        (ed) => ed.source === upstreamNodeId && ed.target === targetNodeId
      );
      if (edge) {
        removeEdges([edge.id]);
      }
    },
    [removeEdges, targetNodeId]
  );

  if (inputs.length === 0 && !showStyleSelector) return null;

  return (
    <div className="flex items-center gap-2 pb-3">
      {/* 风格选择器 */}
      {showStyleSelector && (
        <div className="relative group/style">
          {selectedStyle ? (
            /* 已选风格：显示缩略图 + 可删除 */
            <div className="relative w-[44px] h-[44px] rounded-lg bg-gray-100 border border-gray-200 cursor-pointer" onClick={() => setStyleMarketOpen(true)}>
              {/* 风格缩略图 */}
              <img
                src={selectedStyle.image_url}
                alt={selectedStyle.name}
                className="w-full h-full rounded-lg object-cover"
              />
              {/* 删除按钮 */}
              <button
                onClick={(e) => { handleRemoveStyle(e); }}
                className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover/style:opacity-100 transition-opacity cursor-pointer z-10"
              >
                <CloseOutlined style={{ fontSize: 10 }} />
              </button>
            </div>
          ) : (
            /* 未选：显示风格图标按钮 */
            <button
              onClick={() => setStyleMarketOpen(true)}
              className="w-[44px] h-[44px] rounded-lg border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
              <span className="text-[9px] leading-none">风格</span>
            </button>
          )}

          {styleMarketOpen && createPortal(
            <div className="fixed inset-0 z-[9999] flex items-center justify-center">
              {/* 遮罩 */}
              <div className="absolute inset-0 bg-black/40" onClick={() => setStyleMarketOpen(false)} />

              {/* 居中面板 */}
              <div className="relative w-[900px] max-h-[80vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden z-10 animate-in fade-in zoom-in-95 duration-200">
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
                    onClick={() => setStyleMarketOpen(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 cursor-pointer transition-colors ml-auto shrink-0"
                  >
                    ✕
                  </button>
                </div>

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
                        onClick={() => { handleSelectStyle(style); }}
                        className={`group relative rounded-xl overflow-hidden border transition-all cursor-pointer ${
                          selectedStyle?.id === style.id
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

                        {/* 右上角标签 */}
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
                        {selectedStyle?.id === style.id && (
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
          )}
        </div>
      )}

      {(() => {
        // 按类型独立计数，角标编号不受 label 影响
        const counters: Record<string, number> = {};
        return inputs.map((input) => {
          counters[input.nodeType] = (counters[input.nodeType] || 0) + 1;
          const num = counters[input.nodeType];
          return (
          <div
            key={input.nodeId}
            className="relative group"
          >
            {/* 缩略图 */}
            {input.thumbnail ? (
              <div className="relative w-[44px] h-[44px] rounded-lg bg-gray-100 border border-gray-200">
                {/* 图片：控制预览浮层的显示/隐藏 */}
                <img
                  src={input.thumbnail}
                  alt={input.label}
                  className="w-full h-full object-cover rounded-lg"
                  onMouseEnter={(e) => handleThumbEnter(e, input)}
                  onMouseLeave={handleThumbLeave}
                />
                {/* 删除按钮：纯 CSS group-hover 控制，不依赖 React 状态 */}
                <button
                  className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                  onClick={(e) => handleRemove(e, input.nodeId)}
                >
                  <CloseOutlined style={{ fontSize: 10 }} />
                </button>
                {/* 序号角标 */}
                <span className="absolute bottom-0.5 right-0.5 w-4 h-4 bg-black/60 text-white text-[9px] rounded-full flex items-center justify-center font-medium shadow-sm pointer-events-none">
                  {num}
                </span>
              </div>
            ) : (
              <div
                className="w-[44px] h-[44px] rounded-lg bg-gray-50 border border-dashed border-gray-250 flex flex-col items-center justify-center gap-0.5"
                onMouseEnter={(e) => handleThumbEnter(e, input)}
                onMouseLeave={handleThumbLeave}
              >
                {NODE_TYPE_ICON[input.nodeType]}
                <span className="text-[9px] text-gray-400 leading-none">{input.label}</span>
            </div>
          )}
        </div>
          );
        });
      })()}

      {/* hover 预览浮层（Portal 渲染到 body） */}
      {createPortal(
        <div
          className="fixed z-[9999] transition-opacity duration-150"
          style={{
            left: hoverPos.mouseX,
            top: hoverPos.thumbTop - 8,
            transform: 'translate(-50%, -100%)',
            opacity: hoveredItem ? 1 : 0,
            // 图片预览不需要交互；文本预览需要滚动
            pointerEvents: hoveredItem?.textSnippet ? 'auto' : 'none',
          }}
          onMouseEnter={() => { if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null; } }}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setHoveredItem(null), 150); }}
        >
          {hoveredItem?.thumbnail ? (
            <img
              src={hoveredItem.thumbnail}
              alt=""
              className="max-w-[280px] max-h-[240px] object-contain rounded-lg shadow-2xl"
            />
          ) : hoveredItem?.textSnippet ? (
            <div className="max-w-[280px] max-h-[320px] overflow-y-auto bg-white rounded-lg shadow-2xl border border-gray-200 p-3">
              <div className="prose prose-sm max-w-none text-[13px] text-gray-600 leading-relaxed">
                <ReactMarkdown>{hoveredItem.textSnippet}</ReactMarkdown>
              </div>
            </div>
          ) : null}
        </div>,
        document.body
      )}
    </div>
  );
});
