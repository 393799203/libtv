import api from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

/** 上一次真正发起请求的时间（节流用） */
let lastAt = 0;
/** 正在进行的请求：并发调用合并成一次 */
let inflight: Promise<void> | null = null;
/** 节流窗口：几秒内的重复调用只发一次（focus/visibilitychange 容易连发） */
const MIN_INTERVAL_MS = 3000;

/**
 * 拉一次最新余额并写回登录态（画布/头部等处的积分展示共用）。
 *
 * 积分的权威值只在服务端，前端更新它的时机必须跟着「扣费 / 退费」走：
 * 生成终态、SSE 断线后的轮询兜底、提示词生成、白模场景解析、看门狗异步退费……
 * 漏掉任何一处，界面就会停在旧数字上（用户花掉了积分却看不到变化）。
 * 失败静默：下次页面加载时 authStore 初始化还会再同步一次。
 */
export function refreshCredits(force = false): Promise<void> {
  if (inflight) return inflight;
  const now = Date.now();
  if (!force && now - lastAt < MIN_INTERVAL_MS) return Promise.resolve();
  lastAt = now;

  inflight = api
    .get('/auth/me')
    .then((me: { credits?: number }) => {
      if (me?.credits != null) {
        useAuthStore.getState().setUser({ credits: me.credits });
      }
    })
    .catch(() => {
      /* 静默失败 */
    })
    .finally(() => {
      inflight = null;
    });

  return inflight;
}