import { useIsMobile, useIsTouchDevice } from './useIsMobile';

/** 运营后台仅面向桌面：手机横屏和平板也不加载后台。 */
export function useCanManageOnDevice(): boolean {
  const mobileViewport = useIsMobile();
  const touchOnly = useIsTouchDevice();
  return !mobileViewport && !touchOnly;
}
