import '@wangeditor/editor/dist/css/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import { message } from 'antd';
import { useAuthStore } from '@/stores/authStore';

const IMAGE_MAX_MB = 10;
// 视频上限按角色区分（与后端 forumVideoMaxSize 对齐）：管理员 1GB，其他用户 200MB
const VIDEO_MAX_MB_ADMIN = 1024;
const VIDEO_MAX_MB_USER = 200;
// 上传超时：wangEditor 默认只给 30 秒，大视频必然超时
const VIDEO_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;
/** 与后端接口白名单保持一致：只放浏览器能直接播的容器 */
const VIDEO_ACCEPT = ['video/mp4', 'video/quicktime', 'video/webm'];

/**
 * 上传前的本地校验 + 失败提示。
 *
 * 之所以不用 wangEditor（uppy）自带的 maxFileSize / allowedFileTypes：
 * 它们拦下来是**静默的** —— 用户选完文件界面什么都没发生，看起来像卡住了，
 * 而且拦过一次之后上传菜单会卡在异常态，再点按钮不会重新弹文件选择框。
 * 所以这两个限制在 MENU_CONF 里刻意留空，统一由这里校验并明确报错；
 * 网络/服务端失败也一并提示（错误信息优先用后端的 msg）。
 */
function guardUpload(kind: '图片' | '视频', maxMBOverride?: number) {
  const maxMB = maxMBOverride ?? (kind === '视频' ? VIDEO_MAX_MB_USER : IMAGE_MAX_MB);
  return {
    onBeforeUpload(files: Record<string, { size?: number; type?: string }>) {
      for (const file of Object.values(files || {})) {
        const size = file?.size ?? 0;
        const type = file?.type ?? '';
        if (size > maxMB * 1024 * 1024) {
          message.error(`${kind}不能超过 ${maxMB}MB（当前 ${(size / 1048576).toFixed(0)}MB）`);
          return false;
        }
        if (kind === '视频' && type && !VIDEO_ACCEPT.includes(type)) {
          message.error('只支持 mp4 / webm 格式的视频，请先转成 mp4 再上传');
          return false;
        }
      }
      return true;
    },
    onError(_file: unknown, error: Error) {
      const raw = error?.message || '';
      // 超限时 wangEditor（uppy）给的是英文文案（"xxx exceeds maximum allowed size of 10 MB"），
      // 直接甩给用户很怪，这里翻成中文并说清楚该怎么办。
      const tooBig = /exceeds maximum allowed size/i.test(raw);
      message.error(
        tooBig
          ? `${kind}不能超过 ${maxMB}MB，请压缩或裁剪后再上传`
          : `${kind}上传失败：${raw || '请重试'}`,
      );
    },
    onFailed(_file: unknown, res: { data?: { msg?: string }; msg?: string }) {
      message.error(`${kind}上传失败：${res?.data?.msg || res?.msg || '服务端返回错误'}`);
    },
  };
}

interface RichTextEditorProps {
  /**
   * 本条内容（帖子/回复）的 id，由父组件用 newContentId() 先生成。
   * 上传时作为目录名带给服务端（存到 forum/<draftId>/），
   * 发帖/回复时再用同一个 id 提交，删帖就能按目录把媒体一次删干净。
   * 不传则退回旧布局 forum/<userID>/（老调用方兼容，但删帖只能靠兜底逻辑清理）。
   */
  draftId?: string;
  /** 初始 HTML。组件是非受控的（见下方说明），改动后不影响已输入内容 */
  defaultValue?: string;
  /** 内容变化回调，参数为最新 HTML */
  onChange: (html: string) => void;
  /** 编辑区高度 */
  height?: number;
  placeholder?: string;
  /** 紧凑模式：回复框用，工具栏精简 */
  compact?: boolean;
  /**
   * 挂载后是否自动聚焦。默认 false。
   * 注意：wangEditor 在「非自动聚焦」状态下，点工具栏格式按钮会因恢复选区触发
   * selection 变更，Slate 会清掉待生效的格式标记（表现为点了粗体再打字不变粗）。
   * 所以「用户打开就是要写」的场景（发帖弹窗）应该传 true；
   * 页面上常驻的回复框要传 false，否则页面加载就被聚焦、可能误输入。
   */
  autoFocus?: boolean;
  /**
   * 全屏状态变化回调。wangEditor 的全屏是给编辑器容器加类名（position:fixed 铺满视口），
   * 父组件（发帖弹窗）需要据此把弹窗也铺满视口，否则弹窗的关闭 X 和底部按钮会
   * 留在原来的小盒子里，看起来浮在全屏编辑区中间。
   */
  onFullscreenChange?: (fullscreen: boolean) => void;
}

const FULL_TOOLBAR = [
  'headerSelect',
  'bold',
  'italic',
  'underline',
  'through',
  '|',
  'fontSize',
  'color',
  'bgColor',
  '|',
  'bulletedList',
  'numberedList',
  'justifyLeft',
  'justifyCenter',
  '|',
  'blockquote',
  'codeBlock',
  'divider',
  '|',
  'insertLink',
  'uploadImage',
  'uploadVideo',
  'insertTable',
  '|',
  'undo',
  'redo',
  'clearStyle',
  'fullScreen',
];

const COMPACT_TOOLBAR = [
  'bold',
  'italic',
  'underline',
  'color',
  '|',
  'bulletedList',
  'numberedList',
  '|',
  'blockquote',
  'code',
  '|',
  'insertLink',
  'uploadImage',
  '|',
  'undo',
  'redo',
];

/**
 * 论坛富文本编辑器（wangEditor 5 封装）
 *
 * 刻意用 defaultHtml 而不是 value：wangEditor 的 value 是受控模式，把 onChange 的
 * 结果再回灌会给每次输入都重设一次内容，中文输入法下光标会跳动。
 * 需要「清空重来」时请由父组件改 key 重新挂载（见 ForumListPage / ForumPostPage）。
 *
 * 正文最终会被前端以 dangerouslySetInnerHTML 渲染，安全性由服务端
 * bluemonday 白名单保证（service/forum_service.go），前端不做也做不到可信过滤。
 */
export function RichTextEditor({
  defaultValue = '',
  onChange,
  height = 360,
  placeholder = '写点什么…支持标题、加粗、列表、引用、代码块和图片',
  compact = false,
  autoFocus = false,
  onFullscreenChange,
  draftId,
}: RichTextEditorProps) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  const token = useAuthStore((s) => s.token);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // 管理员可以传整段片子（1GB），普通用户 200MB
  const videoMaxMB = isAdmin ? VIDEO_MAX_MB_ADMIN : VIDEO_MAX_MB_USER;
  const rootRef = useRef<HTMLDivElement>(null);

  // 这两个 config 必须用 useMemo 稳定引用：父组件（发帖/回复页）每次内容变化都会
  // setState 重渲染，如果每次都给 wangEditor 传新对象，工具栏内部状态会被重置，
  // 表现就是「点了粗体图标再打字，字不会变粗」。
  const toolbarConfig = useMemo<Partial<IToolbarConfig>>(
    () => ({ toolbarKeys: compact ? COMPACT_TOOLBAR : FULL_TOOLBAR }),
    [compact],
  );

  // 上传地址带上内容 id：服务端据此把文件放进 forum/<draftId>/。
  // 用查询参数而不是 form 字段，是因为上传配置只在挂载时读取一次，拼在 URL 上最直接。
  const uploadURL = (base: string) =>
    draftId ? `${base}?draftId=${encodeURIComponent(draftId)}` : base;

  const editorConfig = useMemo<Partial<IEditorConfig>>(
    () =>
      ({
        placeholder,
        autoFocus,
        MENU_CONF: {
          uploadImage: {
            // 论坛专用上传接口（需登录）：存到 forum/<draftId>/，
            // 不和全站 images/ 目录混在一起，删帖时按这个目录前缀一次删净
            server: uploadURL('/api/upload/forum-image'),
            fieldName: 'file',
            // maxFileSize 必须显式写死：wangEditor 的 uploadImage 默认 10MB、uploadVideo
            // 默认也是 10MB，不写就悄悄按默认值拦（视频那 200MB 会被按 10MB 拒掉）。
            // allowedFileTypes 不设，格式统一由 guardUpload 校验并给中文提示。
            maxFileSize: IMAGE_MAX_MB * 1024 * 1024,
            timeout: 5 * 60 * 1000,

            headers: token ? { Authorization: `Bearer ${token}` } : {},
            ...guardUpload('图片'),
            // 后端返回的是 {code:0,msg,data:{url,width,height}}，
            // 与 wangEditor 默认期望的 {errno,data:{url,alt,href}} 不同，所以自己插入
            customInsert(
              res: { data?: { url?: string } },
              insertFn: (url: string, alt: string, href: string) => void,
            ) {
              const url = res?.data?.url;
              if (url) insertFn(url, '', url);
            },
          },
          uploadVideo: {
            // 论坛专用视频接口（需登录）：服务端存到 forum/<userID>/，同步落盘不转码，
            // 所以拿到 url 就能立刻播。格式限制在这里和接口白名单两处都要对得上。
            server: uploadURL('/api/upload/forum-video'),
            fieldName: 'file',
            // 同上：必须显式写，否则会用库里的 10MB 默认值（视频上限会被误拒）
            maxFileSize: videoMaxMB * 1024 * 1024,
            // 库默认只给 30 秒，1GB 的视频必然超时；这里放宽到 30 分钟
            timeout: VIDEO_UPLOAD_TIMEOUT_MS,

            headers: token ? { Authorization: `Bearer ${token}` } : {},
            ...guardUpload('视频', videoMaxMB),
            // wangEditor 会插入 <video poster controls><source src type></video>，
            // 插入回调签名是 (src, poster)，这里不要封面图。
            customInsert(
              res: { data?: { url?: string } },
              insertFn: (src: string, poster: string) => void,
            ) {
              const url = res?.data?.url;
              if (url) insertFn(url, '');
            },
          },
        },
      }) as Partial<IEditorConfig>,
    [placeholder, token, autoFocus, draftId, videoMaxMB],
  );

  // 监听编辑器容器的类名变化，把全屏状态同步给父组件
  useEffect(() => {
    const el = rootRef.current;
    if (!el || !onFullscreenChange) return;
    const sync = () => {
      const on =
        el.classList.contains('w-e-full-screen-container') ||
        !!el.querySelector('.w-e-full-screen-container');
      onFullscreenChange(on);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(el, { attributes: true, attributeFilter: ['class'], subtree: true });
    return () => observer.disconnect();
  }, [onFullscreenChange]);

  const handleChange = useCallback(
    (e: IDomEditor) => {
      onChange(e.getHtml());
    },
    [onChange],
  );

  // wangEditor 要求组件卸载时手动销毁，否则会残留事件监听
  useEffect(() => {
    return () => {
      if (editor) {
        editor.destroy();
        setEditor(null);
      }
    };
  }, [editor]);

  return (
    <div ref={rootRef} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <Toolbar
        editor={editor}
        defaultConfig={toolbarConfig}
        mode="default"
        style={{ borderBottom: '1px solid #f0f0f0', background: '#fafafa' }}
      />
      <Editor
        defaultConfig={editorConfig}
        defaultHtml={defaultValue}
        onCreated={setEditor}
        onChange={handleChange}
        mode="default"
        style={{ height, overflowY: 'auto' }}
      />
    </div>
  );
}