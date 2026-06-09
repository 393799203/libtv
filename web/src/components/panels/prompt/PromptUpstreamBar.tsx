import { memo, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  PictureOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
  CodeOutlined,
  CloseOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import type { UpstreamInput } from '@/types/prompt';
import { useCanvasStore } from '@/stores/canvasStore';

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
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const edges = useCanvasStore((s) => s.edges);
  const [hoveredItem, setHoveredItem] = useState<UpstreamInput | null>(null);
  const [hoverPos, setHoverPos] = useState<{ mouseX: number; thumbTop: number }>({ mouseX: 0, thumbTop: 0 });
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 风格选择状态
  const [selectedStyle, setSelectedStyle] = useState<string | undefined>(undefined);
  const [styleMarketOpen, setStyleMarketOpen] = useState(false);

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
      // 从 store 的 edges 中查找匹配的边，取其真实 ID
      const edge = edges.find(
        (ed) => ed.source === upstreamNodeId && ed.target === targetNodeId
      );
      if (edge) {
        removeEdges([edge.id]);
      }
    },
    [removeEdges, targetNodeId, edges]
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
              {/* 风格缩略图占位（后续对接真实图片） */}
              <div className="w-full h-full rounded-lg bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center overflow-hidden">
                <span className="text-[9px] text-blue-600 font-medium leading-tight text-center px-1 line-clamp-2">{selectedStyle.slice(0, 4)}</span>
              </div>
              {/* 删除按钮 */}
              <button
                onClick={(e) => { e.stopPropagation(); setSelectedStyle(undefined); }}
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
                {/* 顶部栏：标题 + 搜索 + 关闭 */}
                <div className="flex items-center gap-4 px-5 py-3.5 border-b border-gray-100 shrink-0">
                  <div className="flex gap-1.5">
                    <button className="px-3 py-1 text-[13px] text-gray-800 font-medium rounded-full bg-gray-100">广场</button>
                    <button className="px-3 py-1 text-[13px] text-gray-500 hover:text-gray-700 rounded-full">我的收藏</button>
                    <button className="px-3 py-1 text-[13px] text-gray-500 hover:text-gray-700 rounded-full">最近使用</button>
                  </div>
                  <div className="flex-1 max-w-xs mx-auto">
                    <input
                      placeholder="搜索模型名称、作者、标签"
                      className="w-full px-3 py-1.5 text-[13px] bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-gray-300"
                    />
                  </div>
                  <button
                    onClick={() => setStyleMarketOpen(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-400 cursor-pointer transition-colors"
                  >
                    ✕
                  </button>
                </div>

                {/* 分类标签栏 */}
                <div className="flex items-center gap-2 px-5 py-2.5 border-b border-gray-50 overflow-x-auto shrink-0">
                  {['推荐', '摄影写真', '电商营销', '动漫游戏', '风格插画', '平面设计', '建筑及室内设计', '创意玩法', '文创周边', '小说插画'].map((cat) => (
                    <button key={cat} className="px-3 py-1 text-[12px] text-gray-600 whitespace-nowrap rounded-full hover:bg-gray-100 transition-colors cursor-pointer">
                      {cat}
                    </button>
                  ))}
                </div>

                {/* 风格卡片网格 */}
                <div className="flex-1 overflow-y-auto p-5">
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      { name: '美式漫画暗黑风', author: '尹', likes: 1600 },
                      { name: '拼贴美学·复古旧质感', author: 'Three_A_clock', likes: 115 },
                      { name: '一键厚涂油画风景', author: '', likes: 35 },
                      { name: '多彩涂色插画', author: '星尘岁月', likes: 94 },
                      { name: '卡通Q版｜扁平化治愈系', author: '尹', likes: 16 },
                      { name: '创意花束', author: '星空岁月', likes: 14 },
                      { name: '唯美写实油画', author: '星空岁月', likes: 175 },
                      { name: '西湖油画', author: '星空岁月', likes: 71 },
                      { name: '一镜琉璃中式建筑', author: '尹520', likes: 18 },
                      { name: '童趣可爱画面', author: '星空岁月', likes: 350 },
                      { name: '数字油画色彩', author: '星空岁月', likes: 23 },
                      { name: '印象主义色彩画风', author: '星空岁月', likes: 28 },
                      { name: '古典宠物（超萌宠魅）', author: '小小喵', likes: 5 },
                      { name: '多彩油画', author: '星空岁月', likes: 25 },
                      { name: '动漫场景（电影感构图）', author: '星空岁月', likes: 223 },
                      { name: '莫奈风格油画', author: '星空岁月', likes: 360 },
                    ].map((style) => (
                      <button
                        key={style.name}
                        onClick={() => { setSelectedStyle(style.name); setStyleMarketOpen(false); }}
                        className={`group relative rounded-xl overflow-hidden border transition-all cursor-pointer ${
                          selectedStyle === style.name
                            ? 'border-blue-400 ring-2 ring-blue-100'
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                        }`}
                      >
                        {/* 占位图 */}
                        <div className="aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 group-hover:from-gray-50 group-hover:to-gray-150" />

                        {/* 底部信息 */}
                        <div className="p-2">
                          <div className={`text-[12px] truncate ${selectedStyle === style.name ? 'text-blue-700 font-medium' : 'text-gray-800'}`}>
                            {style.name}
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            {style.author && (
                              <span className="text-[10px] text-gray-400 truncate flex items-center gap-0.5">
                                <span className="w-3 h-3 rounded-full bg-gray-300 inline-block" />
                                {style.author}
                              </span>
                            )}
                            {!style.author && <span />}
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                              ❤ {style.likes}
                            </span>
                          </div>
                        </div>

                        {/* 选中标记 */}
                        {selectedStyle === style.name && (
                          <div className="absolute top-2 right-2 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center shadow-sm">
                            <svg width="10" height="10" viewBox="0 0 12 12" fill="none"><path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {inputs.map((input, index) => (
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
                {index + 1}
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
      ))}

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
