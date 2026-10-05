import { useEffect } from 'react';
import { refreshCredits } from '@/utils/refreshCredits';

/**
 * 余额自动同步：组件挂载时拉一次；窗口重新聚焦 / 标签页切回来时再拉一次。
 *
 * 凡是「显示当前用户余额」的地方都该挂上它（全局头部、画布头部、积分超市……）：
 * 余额变动可能发生在本页订阅不到的地方 —— 别的标签页里生成、看门狗异步处理、
 * 管理员后台充值/退款、支付宝回调到账。refreshCredits 自带节流与并发合并，
 * 多处在同一时刻挂载也不会打爆接口。
 */
export function useCreditsSync(): void {
  useEffect(() => {
    void refreshCredits(true);
    const sync = () => {
      if (document.visibilityState === 'visible') void refreshCredits();
    };
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);
}