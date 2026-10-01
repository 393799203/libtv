import { useCallback, useState } from 'react';

/**
 * 让 AntD Modal 跟着 wangEditor 的全屏状态一起铺满视口。
 *
 * 编辑器点全屏后，它自己是 position:fixed 铺满整个视口的；如果弹窗还是原来那个
 * 居中偏上的小盒子，标题栏的关闭 X 和底部的取消/发布按钮就会「浮」在全屏编辑区中间。
 * 这里的 modalProps 把弹窗也铺满（标题栏钉顶、按钮组钉底），
 * 编辑器容器改相对弹窗正文定位的规则在 index.css 的 .post-fullscreen-modal 里。
 *
 * 用法：
 *   const { modalProps, onFullscreenChange, resetFullscreen } = useFullscreenModal();
 *   <Modal {...modalProps} ...>
 *     <RichTextEditor onFullscreenChange={onFullscreenChange} ... />
 *   </Modal>
 */
export function useFullscreenModal() {
  const [fullscreen, setFullscreen] = useState(false);

  // 稳定引用：编辑器内部用它挂 MutationObserver，每次渲染换新函数会导致反复重挂
  const onFullscreenChange = useCallback((value: boolean) => setFullscreen(value), []);
  const resetFullscreen = useCallback(() => setFullscreen(false), []);

  const modalProps = fullscreen
    ? {
        width: '100vw' as const,
        style: { top: 0, margin: 0, paddingBottom: 0, maxWidth: '100vw' },
        rootClassName: 'post-fullscreen-modal',
      }
    : {};

  return { fullscreen, modalProps, onFullscreenChange, resetFullscreen };
}