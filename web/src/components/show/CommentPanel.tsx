import { useCallback, useEffect, useRef, useState } from 'react';
import { App, Avatar, Button, Popconfirm, Spin } from 'antd';
import { CloseOutlined, DeleteOutlined, MessageOutlined, UserOutlined } from '@ant-design/icons';
import { commentApi, type CommentItem } from '@/services/commentApi';
import { useAuthStore } from '@/stores/authStore';

const PAGE_SIZE = 20;
const REPLY_PAGE_SIZE = 50;

// 相对时间格式化：刚刚 / N分钟前 / N小时前 / N天前 / 日期
function formatRelativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const minute = 60 * 1000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)}分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))}小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))}天前`;
  return new Date(t).toLocaleDateString('zh-CN');
}

// 某顶级评论的回复展开状态
interface RepliesState {
  items: CommentItem[];
  total: number;
  page: number;
  loading: boolean;
  open: boolean;
}

interface CommentPanelProps {
  showId: string;
  open: boolean;
  onClose: () => void;
  /** 详情接口返回的评论总数（含回复），面板以此为准同步图标数字 */
  initialCount: number;
  /** 评论总数（含回复）变化时同步给父组件 */
  onCountChange?: (total: number) => void;
}

/**
 * 视频详情页右侧评论面板：顶级评论 + 一层回复（回复/展开回复/删除）
 */
export default function CommentPanel({ showId, open, onClose, initialCount, onCountChange }: CommentPanelProps) {
  const { message } = App.useApp();
  const currentUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);

  const [comments, setComments] = useState<CommentItem[]>([]);
  const [total, setTotal] = useState(0); // 顶级评论数（分页用）
  // 全部评论数（含回复，头部与图标展示用）：以详情接口的 comment_count 为初始值
  const [allCount, setAllCount] = useState(initialCount);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [input, setInput] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTarget, setReplyTarget] = useState<CommentItem | null>(null); // 回复目标（顶级或回复均可）
  const [repliesMap, setRepliesMap] = useState<Record<string, RepliesState>>({});
  const listRef = useRef<HTMLDivElement>(null);

  // onCountChange 存 ref：父组件传内联函数时引用每轮渲染都变，
  // 若作为 load 的依赖会导致 useEffect 死循环（load → setState → 重渲染 → 新引用 → 再 load）
  const onCountChangeRef = useRef(onCountChange);
  onCountChangeRef.current = onCountChange;

  // 详情接口的 comment_count 异步返回后同步（初次为 0，详情加载后变为真实值）
  useEffect(() => {
    setAllCount(initialCount);
  }, [initialCount]);

  // 全部评论数变化（发评论/回复、删除）时同步给父组件
  const bumpAllCount = (delta: number) => {
    setAllCount((prev) => {
      const next = Math.max(0, prev + delta);
      onCountChangeRef.current?.(next);
      return next;
    });
  };

  const load = useCallback(async (p: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const res = await commentApi.list(showId, p, PAGE_SIZE);
      setComments((prev) => (append ? [...prev, ...(res.items || [])] : (res.items || [])));
      setTotal(res.total || 0);
      setPage(res.page || p);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [showId]);

  // 打开面板时加载第一页
  useEffect(() => {
    if (open && showId) load(1, false);
  }, [open, showId, load]);

  // 展开/收起某顶级评论的回复
  const toggleReplies = async (c: CommentItem, loadPage = 1) => {
    const entry = repliesMap[c.id];
    if (entry?.open && loadPage === 1) {
      setRepliesMap((prev) => ({ ...prev, [c.id]: { ...entry, open: false } }));
      return;
    }
    setRepliesMap((prev) => ({
      ...prev,
      [c.id]: { items: entry?.items || [], total: entry?.total || 0, page: entry?.page || 0, loading: true, open: true },
    }));
    try {
      const res = await commentApi.listReplies(c.id, loadPage, REPLY_PAGE_SIZE);
      setRepliesMap((prev) => {
        const cur = prev[c.id];
        return {
          ...prev,
          [c.id]: {
            items: loadPage === 1 ? (res.items || []) : [...(cur?.items || []), ...(res.items || [])],
            total: res.total || 0,
            page: res.page || loadPage,
            loading: false,
            open: true,
          },
        };
      });
    } catch {
      setRepliesMap((prev) => ({ ...prev, [c.id]: { ...prev[c.id], loading: false } }));
    }
  };

  // 点击「回复」：未登录先引导登录；已登录设置回复目标，底部输入框进入回复模式
  const handleReplyClick = (c: CommentItem) => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    setReplyTarget(c);
  };

  const handlePost = async () => {
    if (!isAuthenticated) {
      openLoginModal();
      return;
    }
    const content = input.trim();
    if (!content) return;
    setPosting(true);
    try {
      const item = await commentApi.create(showId, content, replyTarget?.id);
      if (replyTarget) {
        // 回复：归到顶级评论下（服务端已归一），更新其 reply_count；已展开则直接插入
        const topId = replyTarget.parent_id || replyTarget.id;
        setComments((prev) =>
          prev.map((c) => (c.id === topId ? { ...c, reply_count: (c.reply_count || 0) + 1 } : c))
        );
        setRepliesMap((prev) => {
          const entry = prev[topId];
          if (!entry || !entry.open) return prev;
          return { ...prev, [topId]: { ...entry, items: [...entry.items, item], total: entry.total + 1 } };
        });
        setReplyTarget(null);
        bumpAllCount(1);
        message.success('回复成功');
      } else {
        // 顶级评论：插入列表头部，顶级数与全部数各 +1
        setComments((prev) => [item, ...prev]);
        setTotal((t) => t + 1);
        bumpAllCount(1);
        listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
        message.success('评论成功');
      }
      setInput('');
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (c: CommentItem) => {
    try {
      await commentApi.remove(c.id);
      if (c.parent_id) {
        // 删除回复：从展开的回复列表移除，顶级评论 reply_count -1，全部数 -1
        setRepliesMap((prev) => {
          const entry = prev[c.parent_id];
          if (!entry) return prev;
          return {
            ...prev,
            [c.parent_id]: {
              ...entry,
              items: entry.items.filter((r) => r.id !== c.id),
              total: Math.max(0, entry.total - 1),
            },
          };
        });
        setComments((prev) =>
          prev.map((x) => (x.id === c.parent_id ? { ...x, reply_count: Math.max(0, (x.reply_count || 0) - 1) } : x))
        );
        bumpAllCount(-1);
      } else {
        // 删除顶级评论（服务端连带删回复）：移除条目并清理回复状态；全部数 -(1+回复数)
        setComments((prev) => prev.filter((x) => x.id !== c.id));
        setRepliesMap((prev) => {
          const next = { ...prev };
          delete next[c.id];
          return next;
        });
        setTotal((t) => Math.max(0, t - 1));
        bumpAllCount(-(1 + (c.reply_count || 0)));
      }
      message.success('已删除');
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    }
  };

  const canDelete = (c: CommentItem) =>
    !!currentUser && (currentUser.id === c.user_id || currentUser.role === 'admin');

  // 单条评论/回复的共用渲染（size 控制头像与字号）
  const renderItem = (c: CommentItem, isReply: boolean) => (
    <div key={c.id} className={`flex gap-3 ${isReply ? 'py-2' : 'py-3 border-b border-gray-50'}`}>
      <Avatar size={isReply ? 24 : 32} src={c.avatar_url || undefined} icon={<UserOutlined />} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-gray-500 truncate">
            {c.nickname || '匿名用户'}
            {isReply && c.reply_to_nickname && (
              <span className="text-gray-400"> 回复 <span className="text-blue-500">@{c.reply_to_nickname}</span></span>
            )}
          </span>
          {canDelete(c) && (
            <Popconfirm title="删除这条评论？" okText="删除" cancelText="取消" onConfirm={() => handleDelete(c)}>
              <button className="text-gray-300 hover:text-red-500 cursor-pointer ml-2 shrink-0">
                <DeleteOutlined style={{ fontSize: 12 }} />
              </button>
            </Popconfirm>
          )}
        </div>
        <div className="text-[13px] text-gray-800 mt-0.5 break-words whitespace-pre-wrap">{c.content}</div>
        <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-3">
          <span>{formatRelativeTime(c.created_at)}</span>
          <button className="hover:text-blue-500 cursor-pointer" onClick={() => handleReplyClick(c)}>
            回复
          </button>
          {!isReply && (c.reply_count || 0) > 0 && (
            <button
              className="text-blue-500 hover:text-blue-600 cursor-pointer"
              onClick={() => toggleReplies(c)}
            >
              {repliesMap[c.id]?.open ? '收起回复' : `展开 ${c.reply_count} 条回复`}
            </button>
          )}
        </div>
        {/* 回复列表（仅顶级评论下渲染） */}
        {!isReply && repliesMap[c.id]?.open && (
          <div className="mt-1">
            {repliesMap[c.id].loading ? (
              <div className="py-2 text-gray-400 text-[12px]"><Spin size="small" className="mr-1" /> 加载中...</div>
            ) : (
              <>
                {repliesMap[c.id].items.map((r) => renderItem(r, true))}
                {repliesMap[c.id].items.length < repliesMap[c.id].total && (
                  <button
                    className="text-[12px] text-blue-500 hover:text-blue-600 cursor-pointer py-1"
                    onClick={() => toggleReplies(c, (repliesMap[c.id]?.page || 1) + 1)}
                  >
                    加载更多回复
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      className={`fixed top-0 right-0 h-full w-[380px] max-w-[90vw] bg-white z-40 shadow-2xl flex flex-col transition-transform duration-300 ${
        open ? 'translate-x-0' : 'translate-x-full'
      }`}
    >
      {/* 头部 */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
        <span className="text-[14px] font-medium text-gray-800">评论 ({allCount})</span>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 cursor-pointer p-1">
          <CloseOutlined />
        </button>
      </div>

      {/* 评论列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Spin size="small" className="mr-2" /> 加载中...
          </div>
        ) : comments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <MessageOutlined style={{ fontSize: 32 }} className="mb-2 opacity-40" />
            <div className="text-[13px]">暂无评论，来抢沙发</div>
          </div>
        ) : (
          <>
            {comments.map((c) => renderItem(c, false))}
            {comments.length < total && (
              <div className="py-3 text-center">
                <Button size="small" type="text" loading={loadingMore} onClick={() => load(page + 1, true)} className="!text-blue-500">
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* 底部输入区 */}
      <div className="border-t border-gray-100 p-3 shrink-0">
        {isAuthenticated ? (
          <>
            {replyTarget && (
              <div className="flex items-center justify-between mb-2 px-1">
                <span className="text-[12px] text-gray-500">
                  回复 <span className="text-blue-500">@{replyTarget.nickname || '匿名用户'}</span>
                </span>
                <button onClick={() => setReplyTarget(null)} className="text-gray-400 hover:text-gray-600 cursor-pointer text-[12px]">
                  取消回复
                </button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handlePost();
                  }
                }}
                placeholder={replyTarget ? `回复 @${replyTarget.nickname || '匿名用户'}...` : '说点什么...'}
                rows={2}
                maxLength={500}
                className="flex-1 px-3 py-2 text-[13px] border border-gray-200 rounded-lg focus:border-blue-400 outline-none resize-none"
              />
              <Button type="primary" size="small" loading={posting} disabled={!input.trim()} onClick={handlePost}>
                发送
              </Button>
            </div>
          </>
        ) : (
          <button
            onClick={openLoginModal}
            className="w-full py-2 text-[13px] text-gray-400 bg-gray-50 rounded-lg hover:text-blue-500 cursor-pointer transition-colors"
          >
            登录后参与评论
          </button>
        )}
      </div>
    </div>
  );
}
