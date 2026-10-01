import { useEffect, useState } from 'react';

/**
 * 是否为移动端视口（默认 <768px，与 Tailwind 的 md: 断点口径一致）。
 *
 * 只用于「必须用 JS 分叉」的场景：例如菜单项数量不同、DOM 结构不同。
 * 纯样式差异请优先用 Tailwind 的 md: / max-md: 断点，不要用这个 hook 做条件渲染，
 * 否则会在窗口缩放时触发额外的重渲染。
 */
export function useIsMobile(breakpoint = 768): boolean {
  const query = `(max-width: ${breakpoint - 1}px)`;
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handleChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    // 初次挂载同步一次，避免 SSR/首帧与断点不一致
    setIsMobile(mql.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return isMobile;
}

export default useIsMobile;

/**
 * 是否为「纯触摸设备」（无 hover 且粗指针），即真正的手机/平板。
 *
 * 与 useIsMobile 的区别（实测）：把桌面浏览器窗口拉窄到 700px 时
 * max-width:767px 会命中、而 (hover:none) and (pointer:coarse) 不会。
 * 所以「要不要换成移动端专用交互」这类**能力性**判断用这个 hook，
 * 只有「版面怎么排」才用宽度断点 —— 否则窄窗 PC 会被误判成手机。
 */
export function useIsTouchDevice(): boolean {
  const query = '(hover: none) and (pointer: coarse)';
  const [isTouch, setIsTouch] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handleChange = (e: MediaQueryListEvent) => setIsTouch(e.matches);
    setIsTouch(mql.matches);
    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [query]);

  return isTouch;
}