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