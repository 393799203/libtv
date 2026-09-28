import '@wangeditor/editor/dist/css/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Editor, Toolbar } from '@wangeditor/editor-for-react';
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor';
import { useAuthStore } from '@/stores/authStore';

interface RichTextEditorProps {
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
}: RichTextEditorProps) {
  const [editor, setEditor] = useState<IDomEditor | null>(null);
  const token = useAuthStore((s) => s.token);

  // 这两个 config 必须用 useMemo 稳定引用：父组件（发帖/回复页）每次内容变化都会
  // setState 重渲染，如果每次都给 wangEditor 传新对象，工具栏内部状态会被重置，
  // 表现就是「点了粗体图标再打字，字不会变粗」。
  const toolbarConfig = useMemo<Partial<IToolbarConfig>>(
    () => ({ toolbarKeys: compact ? COMPACT_TOOLBAR : FULL_TOOLBAR }),
    [compact],
  );

  const editorConfig = useMemo<Partial<IEditorConfig>>(
    () =>
      ({
        placeholder,
        autoFocus,
        MENU_CONF: {
          uploadImage: {
            // 论坛专用上传接口（需登录）：服务端按登录身份存到 forum/<userID>/，
            // 便于按作者清理，也不和全站 images/ 目录混在一起
            server: '/api/upload/forum-image',
            fieldName: 'file',
            maxFileSize: 10 * 1024 * 1024,
            allowedFileTypes: ['image/*'],
            headers: token ? { Authorization: `Bearer ${token}` } : {},
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
        },
      }) as Partial<IEditorConfig>,
    [placeholder, token, autoFocus],
  );

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
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
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