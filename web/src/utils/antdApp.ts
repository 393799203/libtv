import { message as staticMessage, Modal as StaticModal } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';
import type { HookAPI as ModalHookAPI } from 'antd/es/modal/useModal';

/**
 * 非组件代码（services / hooks）里用的 message / modal。
 *
 * 为什么需要这层转发：
 * antd 的静态方法（`import { message } from 'antd'`）脱离 ConfigProvider 的 context，
 * 拿不到 App.tsx 里配的 darkAlgorithm 主题 —— 它渲染的是 antd 默认的**浅色**提示条，
 * 在这套冷色暗底站里就是一条"白底黑字"的横条，和组件里 `App.useApp()` 弹出的暗色
 * 提示条完全两个样（同一个站里一条暗一条白）。
 * 由 services 层弹出的提示（接口报错、登录失效）正好都走了静态方法这条路。
 *
 * 做法：`<AntdAppBridge>`（挂在 antd `<App>` 内部）把 useApp() 的带主题实例注册进来，
 * 这里只做转发。桥接之前的极早期调用退回 antd 静态实例 —— 提示仍能弹出来，只是不带主题。
 */
let themed: { message: MessageInstance; modal: ModalHookAPI } | null = null;

/** 由 <AntdAppBridge> 调用，注入带主题的实例 */
export function bindAntdApp(instances: { message: MessageInstance; modal: ModalHookAPI }) {
  themed = instances;
}

/**
 * 把任意对象转发到"当前生效的实例"上。
 * 用 Proxy 而不是逐个方法手写转发：antd 版本升级新增/改动方法时这里不用跟着改。
 */
function forward<T extends object>(get: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      const source = get() as Record<string | symbol, unknown>;
      const value = source[prop];
      return typeof value === 'function' ? value.bind(source) : value;
    },
  });
}

/** 带主题的 message，用法与 antd 静态 message 完全一致 */
export const message: MessageInstance = forward(() => themed?.message ?? staticMessage);

/** 带主题的 modal（Modal.confirm 等），用法与 antd 静态 Modal 一致 */
export const modal: ModalHookAPI = forward(() => themed?.modal ?? (StaticModal as unknown as ModalHookAPI));