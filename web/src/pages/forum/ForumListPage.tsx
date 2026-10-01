import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Empty, Input, Modal, Pagination, Spin, Tag } from 'antd';
import {
  EyeOutlined,
  MessageOutlined,
  PlusOutlined,
  PushpinFilled,
  SearchOutlined,
} from '@ant-design/icons';
import { forumApi, type ForumPostItem } from '@/services/forumApi';
import { RichTextEditor } from '@/components/forum/RichTextEditor';
import { excerptAround, hasRichMedia, isRichTextEmpty } from '@/components/forum/richText';
import { Highlight } from '@/components/forum/Highlight';
import { useAuthStore } from '@/stores/authStore';
import { newContentId } from '@/utils/contentId';
import { useFullscreenModal } from '@/components/forum/useFullscreenModal';

const PAGE_SIZE = 10;

function formatTime(iso: string): string {
  const time = new Date(iso).getTime();
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

/**
 * 论坛帖子列表页（公开，未登录可浏览）
 *
 * 同时也是首页 banner 的活动落地页：banner 的 link_url 填 `/forum` 即可，
 * 站内链接会走 react-router 跳转（见 VideoListPage 的 banner 点击处理）。
 */
export default function ForumListPage() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);

  const [posts, setPosts] = useState<ForumPostItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(true);

  const [composeOpen, setComposeOpen] = useState(false);
  // 这篇帖子的 id：打开编辑器时就生成，上传的图片/视频按它分目录，发布时作为帖子 id 提交，
  // 这样删帖 = 删 forum/<帖子id>/ 整个目录，媒体不会残留（详见 utils/contentId.ts）
  const [composeId, setComposeId] = useState(() => newContentId());
  const [composeTitle, setComposeTitle] = useState('');
  // 正文放 ref 而不是 state：编辑器每次输入都 setState 会让父组件重渲染，
  // 实测会导致「点了粗体图标再打字，字不会变粗」（重新渲染打断了待生效的格式标记）。
  // 正文只在提交时读一次，不需要驱动渲染，用 ref 更合适。
  const composeHtmlRef = useRef('');
  // 每次打开发帖弹窗都换 key，让富文本编辑器以空内容重新挂载
  const [composeKey, setComposeKey] = useState(0);
  // 编辑器点全屏时，发帖弹窗要跟着铺满视口（详见 useFullscreenModal）
  const { modalProps, onFullscreenChange, resetFullscreen } = useFullscreenModal();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(
    async (targetPage: number, kw: string) => {
      setLoading(true);
      try {
        const res = await forumApi.listPosts({ page: targetPage, page_size: PAGE_SIZE, keyword: kw || undefined });
        setPosts(res.items || []);
        setTotal(res.total || 0);
      } catch {
        // 错误提示由 api 拦截器统一弹出
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(page, keyword);
  }, [page, keyword, load]);

  const handleSearch = () => {
    setPage(1);
    setKeyword(searchInput.trim());
  };

  const handleOpenCompose = () => {
    if (!isAuthenticated) {
      openLoginModal('login');
      return;
    }
    setComposeTitle('');
    composeHtmlRef.current = '';
    setComposeId(newContentId()); // 每次打开都换新 id：复用会导致删这篇时牵连上一篇的媒体
    setComposeKey((k) => k + 1);
    setComposeOpen(true);
  };

  const closeCompose = useCallback(() => {
    setComposeOpen(false);
    resetFullscreen();
  }, [resetFullscreen]);

  const handleSubmitPost = async () => {
    if (!composeTitle.trim()) {
      message.warning('请填写标题');
      return;
    }
    if (isRichTextEmpty(composeHtmlRef.current)) {
      message.warning('正文不能为空');
      return;
    }
    setSubmitting(true);
    try {
      const created = await forumApi.createPost({
        id: composeId,
        title: composeTitle.trim(),
        content: composeHtmlRef.current,
      });
      message.success('发布成功');
      setComposeOpen(false);
      resetFullscreen();
      navigate(`/forum/${created.id}`);
    } catch {
      // 错误提示由 api 拦截器统一弹出
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      {/* 说明行 */}
      <p className="mb-4 text-[13px] text-gray-500">
        活动公告、创作交流、问题反馈都发在这里 · 共 {total} 篇帖子
      </p>

      {/* 搜索与发帖同一行：搜索占满剩余宽度，发帖固定在右侧 */}
      <div className="mb-5 flex items-center gap-3">
        <Input
          className="flex-1 max-md:!h-11"
          size="large"
          allowClear
          prefix={<SearchOutlined className="text-gray-400" />}
          placeholder="搜索帖子标题"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onPressEnter={handleSearch}
          onClear={() => {
            setSearchInput('');
            setPage(1);
            setKeyword('');
          }}
          suffix={
            <Button type="link" size="small" className="max-md:!h-11" onClick={handleSearch}>
              搜索
            </Button>
          }
        />
        <Button
          className="shrink-0 max-md:!h-11"
          type="primary"
          size="large"
          icon={<PlusOutlined />}
          onClick={handleOpenCompose}
        >
          发帖
        </Button>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="flex justify-center py-24">
          <Spin />
        </div>
      ) : posts.length === 0 ? (
        <div className="py-20">
          <Empty description={keyword ? `没有找到包含「${keyword}」的帖子` : '还没有帖子，来发第一篇吧'} />
        </div>
      ) : (
        <div>
          {posts.map((post, index) => (
            <div
              key={post.id}
              onClick={() => navigate(`/forum/${post.id}`)}
              className={`cursor-pointer p-4 transition-colors hover:bg-gray-50 ${
                index > 0 ? 'border-t border-gray-100' : ''
              }`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {post.is_pinned && (
                    <Tag color="red" className="shrink-0 !mr-0" icon={<PushpinFilled />}>
                      置顶
                    </Tag>
                  )}
                  <h3 className="truncate text-[16px] md:text-[15px] font-medium text-gray-900">
                    <Highlight text={post.title} keyword={keyword} />
                  </h3>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-6 text-gray-500">
                  <Highlight
                    text={excerptAround(post.content, keyword) || (hasRichMedia(post.content) ? '［图片］' : '（无正文）')}
                    keyword={keyword}
                  />
                </p>
                <div className="mt-2 flex items-center gap-4 text-[12px] text-gray-400">
                  <span className="flex items-center gap-1.5 text-gray-500">
                    <img
                      src={post.avatar_url || '/default-avatar.svg'}
                      alt=""
                      className="h-5 w-5 shrink-0 rounded-full bg-gray-100 object-cover"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
                      }}
                    />
                    {post.nickname || '匿名用户'}
                  </span>
                  <span>{formatTime(post.created_at)}</span>
                  <span className="flex items-center gap-1">
                    <EyeOutlined /> {post.view_count}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageOutlined /> {post.reply_count}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 分页 */}
      {total > PAGE_SIZE && (
        <div className="mt-6 flex justify-center">
          <Pagination
            current={page}
            pageSize={PAGE_SIZE}
            total={total}
            showSizeChanger={false}
            onChange={(p) => {
              setPage(p);
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </div>
      )}

      {/* 发帖弹窗 */}
      <Modal
        title="发布新帖"
        open={composeOpen}
        onCancel={closeCompose}
        {...modalProps}
        destroyOnClose
        maskClosable={false}
        okText="发布"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={handleSubmitPost}
      >
        <div className="space-y-3 py-2">
          <Input
            size="large"
            placeholder="标题（不超过 100 字）"
            maxLength={100}
            showCount
            value={composeTitle}
            onChange={(e) => setComposeTitle(e.target.value)}
          />
          <RichTextEditor
            key={composeKey}
            autoFocus
            onChange={(html) => {
              composeHtmlRef.current = html;
            }}
            height={380}
            placeholder="正文支持标题、加粗、列表、引用、代码块、图片、视频……"
            onFullscreenChange={onFullscreenChange}
            draftId={composeId}
          />
          <p className="text-[12px] text-gray-400">
            图片可直接粘贴或点工具栏按钮上传（最大 10MB）；视频点工具栏的视频按钮上传
            （支持 mp4 / webm，普通用户最大 200MB，管理员 1GB）。
            发布后本人和管理员可以删除，帖子里的图片和视频会随帖子一起删掉。
          </p>
        </div>
      </Modal>
    </div>
  );
}