import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { App, Button, Empty, Input, Modal, Spin, Tag } from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  MessageOutlined,
  PushpinFilled,
  PushpinOutlined,
} from '@ant-design/icons';
import { forumApi, type ForumPostItem, type ForumReplyItem } from '@/services/forumApi';
import { RichTextEditor } from '@/components/forum/RichTextEditor';
import { useFullscreenModal } from '@/components/forum/useFullscreenModal';
import { isRichTextEmpty } from '@/components/forum/richText';
import { useAuthStore } from '@/stores/authStore';
import { newContentId } from '@/utils/contentId';
import { deriveThumbUrl, isOwnStorageUrl } from '@/utils/thumbUrl';

function formatTime(iso: string): string {
  const time = new Date(iso).getTime();
  const diff = Date.now() - time;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 论坛帖子详情页（公开，未登录可浏览；发帖/回复需登录）
 *
 * 正文与回复都是服务端 bluemonday 清洗过的 HTML，这里用 dangerouslySetInnerHTML
 * 渲染 —— 未经清洗的 HTML 绝不能走这条路（见 server/internal/service/forum_service.go）。
 */
export default function ForumPostPage() {
  const { postId = '' } = useParams();
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const currentUser = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);

  const [post, setPost] = useState<ForumPostItem | null>(null);
  const [replies, setReplies] = useState<ForumReplyItem[]>([]);
  const [replyTotal, setReplyTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // 同列表页：回复正文用 ref，避免每次输入重渲染编辑器而打断格式标记
  const replyHtmlRef = useRef('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  // 编辑帖子：作者本人或管理员可以改标题和正文
  const [editOpen, setEditOpen] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const editHtmlRef = useRef('');
  const { modalProps, onFullscreenChange, resetFullscreen } = useFullscreenModal();
  // 本条回复的 id：上传的图片按它分目录，提交时作为回复 id 交上去，
  // 这样删回复 = 删它自己的媒体目录（发完一条就换新 id，见 handleReply）
  const [replyId, setReplyId] = useState(() => newContentId());
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = currentUser?.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const detail = await forumApi.getPost(postId);
      setPost(detail);
      setNotFound(false);
      const list = await forumApi.listReplies(postId, { page: 1, page_size: 100 });
      setReplies(list.items || []);
      setReplyTotal(list.total || 0);
    } catch {
      // 帖子不存在时接口返回 404，拦截器已提示；这里给个空状态兜底
      setPost(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [postId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleReply = async () => {
    if (!isAuthenticated) {
      openLoginModal('login');
      return;
    }
    const html = replyHtmlRef.current;
    if (isRichTextEmpty(html)) {
      message.warning('回复内容不能为空');
      return;
    }
    setSubmitting(true);
    try {
      await forumApi.createReply(postId, {
        id: replyId,
        content: html,
        reply_to_nickname: replyTo || undefined,
      });
      message.success('回复成功');
      replyHtmlRef.current = '';
      setReplyTo(null);
      setReplyId(newContentId()); // 下一条回复换新目录，避免两条回复共用一份媒体
      setEditorKey((k) => k + 1); // 重新挂载编辑器以清空内容
      await load();
    } catch {
      // 错误提示由 api 拦截器统一弹出
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeletePost = () => {
    modal.confirm({
      title: '确认删除这篇帖子？',
      content: '删除后帖子下的全部回复也会一并删除，且不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await forumApi.deletePost(postId);
        message.success('已删除');
        navigate('/forum');
      },
    });
  };

  const handleDeleteReply = (reply: ForumReplyItem) => {
    modal.confirm({
      title: '确认删除这条回复？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await forumApi.deleteReply(reply.id);
        message.success('已删除');
        await load();
      },
    });
  };

  const handleTogglePin = async () => {
    if (!post) return;
    try {
      await forumApi.setPinned(post.id, !post.is_pinned);
      message.success(post.is_pinned ? '已取消置顶' : '已置顶');
      await load();
    } catch {
      // 错误提示由 api 拦截器统一弹出
    }
  };

  // 正文/回复里的图片：优先加载 640px 缩略图（原图可能好几 MB），点击看原图。
  // 缩略图缺失（存量文件没生成过）时自动回退原图，所以替换是安全的；
  // 只替换本站存储在管的地址，外链不动，避免为外链多打一次 404。
  const contentRootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = contentRootRef.current;
    if (!root) return;
    root.querySelectorAll('.forum-content img[src]').forEach((node) => {
      const img = node as HTMLImageElement;
      if (img.dataset.thumbDone === '1') return;
      const original = img.getAttribute('src') || '';
      if (!original) return;
      img.dataset.thumbDone = '1';
      img.loading = 'lazy';
      const thumb = isOwnStorageUrl(original) ? deriveThumbUrl(original) : undefined;
      if (!thumb) return;
      img.dataset.original = original;
      img.addEventListener('error', function onThumbError() {
        img.removeEventListener('error', onThumbError);
        const fallback = img.dataset.original;
        if (fallback && img.getAttribute('src') !== fallback) img.setAttribute('src', fallback);
      });
      img.setAttribute('src', thumb);
      // 点开看原图：缩略图只有 640px，想看细节要有出口
      if (!img.closest('a')) {
        const link = document.createElement('a');
        link.href = original;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = '查看原图';
        img.parentNode?.insertBefore(link, img);
        link.appendChild(img);
      }
    });
  }, [post?.content, replies]);

  if (loading) {
    return (
      <div className="flex justify-center py-32">
        <Spin />
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-24 text-center">
        <Empty description="帖子不存在或已被删除" />
      </div>
    );
  }

  const canDeletePost = isAuthenticated && (isAdmin || post.user_id === currentUser?.id);

  const canEditPost = canDeletePost; // 修改权限与删除一致：作者本人或管理员

  const openEdit = () => {
    if (!post) return;
    setEditTitle(post.title);
    editHtmlRef.current = post.content;
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!post) return;
    if (!editTitle.trim()) {
      message.warning('请填写标题');
      return;
    }
    if (isRichTextEmpty(editHtmlRef.current)) {
      message.warning('正文不能为空');
      return;
    }
    setSaving(true);
    try {
      await forumApi.updatePost(post.id, {
        title: editTitle.trim(),
        content: editHtmlRef.current,
      });
      message.success('修改成功');
      setEditOpen(false);
      resetFullscreen();
      await load();
    } catch {
      // 错误提示由 api 拦截器统一弹出
    } finally {
      setSaving(false);
    }
  };

  return (
    <div ref={contentRootRef} className="mx-auto w-full max-w-5xl px-4 py-8">
      {/* 帖子主体 */}
      <article className="pb-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[24px] font-bold leading-8 text-gray-900">
            {post.is_pinned && (
              <Tag color="red" className="mr-2 align-middle" icon={<PushpinFilled />}>
                置顶
              </Tag>
            )}
            {post.title}
          </h1>
          <div className="flex shrink-0 items-center gap-1">
            {isAdmin && (
              <Button
                size="small"
                type="text"
                icon={post.is_pinned ? <PushpinFilled /> : <PushpinOutlined />}
                onClick={handleTogglePin}
              >
                {post.is_pinned ? '取消置顶' : '置顶'}
              </Button>
            )}
            {canEditPost && (
              <Button size="small" type="text" icon={<EditOutlined />} onClick={openEdit}>
                编辑
              </Button>
            )}
            {canDeletePost && (
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={handleDeletePost}>
                删除
              </Button>
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-4 border-b border-gray-100 pb-4 text-[12px] text-gray-400">
          <span className="flex items-center gap-2 text-[13px] text-gray-600">
            <img
              src={post.avatar_url || '/default-avatar.svg'}
              alt=""
              className="h-6 w-6 rounded-full border border-gray-200 object-cover"
            />
            {post.nickname || '匿名用户'}
          </span>
          <span>发表于 {formatTime(post.created_at)}</span>
          <span className="flex items-center gap-1">
            <EyeOutlined /> {post.view_count} 次浏览
          </span>
          <span className="flex items-center gap-1">
            <MessageOutlined /> {replyTotal} 条回复
          </span>
        </div>

        {/* 正文：服务端已清洗的 HTML */}
        <div className="forum-content mt-5" dangerouslySetInnerHTML={{ __html: post.content }} />
      </article>

      {/* 回复区 */}
      <section className="mt-6">
        <h2 className="mb-3 text-[16px] font-semibold text-gray-800">
          全部回复 {replyTotal > 0 && <span className="text-gray-400">({replyTotal})</span>}
        </h2>

        {replies.length === 0 ? (
          <div className="py-10 text-center text-[13px] text-gray-400">
            还没有人回复，来说两句吧
          </div>
        ) : (
          <div>
            {replies.map((reply, index) => {
              const canDeleteReply = isAuthenticated && (isAdmin || reply.user_id === currentUser?.id);
              return (
                <div key={reply.id} className={`flex gap-3 py-4 ${index > 0 ? 'border-t border-gray-100' : ''}`}>
                  <img
                    src={reply.avatar_url || '/default-avatar.svg'}
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full border border-gray-200 object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[12px] text-gray-400">
                      <span className="text-[13px] font-medium text-gray-700">{reply.nickname || '匿名用户'}</span>
                      {reply.reply_to_nickname && (
                        <span className="text-gray-400">
                          回复 <span className="text-blue-600">@{reply.reply_to_nickname}</span>
                        </span>
                      )}
                      <span>{formatTime(reply.created_at)}</span>
                    </div>
                    <div
                      className="forum-content forum-content--compact mt-1.5"
                      dangerouslySetInnerHTML={{ __html: reply.content }}
                    />
                    <div className="mt-1 flex items-center gap-3 text-[12px]">
                      <button
                        className="cursor-pointer text-gray-400 transition-colors hover:text-blue-600"
                        onClick={() => {
                          if (!isAuthenticated) {
                            openLoginModal('login');
                            return;
                          }
                          setReplyTo(reply.nickname || '匿名用户');
                          document.getElementById('forum-reply-editor')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }}
                      >
                        回复
                      </button>
                      {canDeleteReply && (
                        <button
                          className="cursor-pointer text-gray-400 transition-colors hover:text-red-500"
                          onClick={() => handleDeleteReply(reply)}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 回复框 */}
      <section id="forum-reply-editor" className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[14px] font-medium text-gray-700">
            {replyTo ? (
              <>
                回复 <span className="text-blue-600">@{replyTo}</span>
              </>
            ) : (
              '发表回复'
            )}
          </span>
          {replyTo && (
            <button className="cursor-pointer text-[12px] text-gray-400 hover:text-gray-600" onClick={() => setReplyTo(null)}>
              取消回复该楼
            </button>
          )}
        </div>
        {isAuthenticated ? (
          <>
            <RichTextEditor
              key={editorKey}
              draftId={replyId}
              compact
              height={180}
              onChange={(html) => {
                replyHtmlRef.current = html;
              }}
              placeholder="友善交流，支持富文本与图片"
            />
            <div className="mt-3 flex justify-end">
              <Button type="primary" loading={submitting} onClick={handleReply}>
                发表回复
              </Button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-4">
            <span className="text-[13px] text-gray-500">登录后即可回复</span>
            <Button type="primary" onClick={() => openLoginModal('login')}>
              登录
            </Button>
          </div>
        )}
      </section>

      {/* 编辑帖子（作者本人或管理员）：标题 + 富文本，编辑器挂载时带上本帖 id，
          所以编辑过程中新上传的图片/视频会进本帖目录，保存时再清掉已被移除的那些 */}
      <Modal
        title="编辑帖子"
        open={editOpen}
        onCancel={() => {
          setEditOpen(false);
          resetFullscreen();
        }}
        width={860}
        {...modalProps}
        destroyOnClose
        maskClosable={false}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={handleSaveEdit}
      >
        <div className="space-y-3 py-2">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            maxLength={100}
            showCount
            placeholder="标题（不超过 100 字）"
          />
          <RichTextEditor
            defaultValue={post?.content || ''}
            draftId={post?.id}
            // 必须自动聚焦：wangEditor 的上传类菜单在编辑器没有选区时是 disabled 的
            // （源码：if (editor.selection == null || editor.isDisabled()) disabled = true），
            // 不聚焦的话图片/视频按钮点上去毫无反应，看着像坏了
            autoFocus
            height={360}
            placeholder="支持标题、加粗、列表、引用、代码块、图片、视频……"
            onFullscreenChange={onFullscreenChange}
            onChange={(html) => {
              editHtmlRef.current = html;
            }}
          />
          <p className="text-[12px] text-gray-400">
            保存后立即生效；正文里被移除的图片、视频会一并从存储中删除。
          </p>
        </div>
      </Modal>
    </div>
  );
}