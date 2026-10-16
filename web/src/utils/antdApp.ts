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
/**
 * 提示条距顶部的距离。
 *
 * antd 默认是 8px，正好压在页面顶部栏（AppLayout 的 header：桌面 48px / 手机 56px，
 * 里面是保存、导出、头像这些按钮）上 —— 提示一出来就盖住按钮，点不到。
 * 72px = 顶部栏之下再留一点空隙（桌面留 24px、手机留 16px）。
 * 两处都要用同一个值：<App message={{ top }}> 管组件内的 useApp()，这里管静态实例兜底。
 */
export const MESSAGE_TOP = 72;

let themed: { message: MessageInstance; modal: ModalHookAPI } | null = null;

// 静态实例（桥接前/脱离 ConfigProvider 时用）也挪下来，否则极早期弹出的提示还是压在按钮上
/**
 * 由 <AntdAppBridge> 调用，注入带主题的实例。
 *
 * 顺手把**静态实例**也配上同样的 top：模块顶层那句 config 会被打包器当成无副作用摇掉
 * （实测线上产物里 `config(` 出现 0 次），于是「桥接之前/没走桥接」的提示条又回到 antd
 * 默认的 top:8，正好压在顶部栏按钮上。放在函数体里是运行时调用，摇不掉。
 */
export function bindAntdApp(instances: { message: MessageInstance; modal: ModalHookAPI }) {
  themed = instances;
  staticMessage.config({ top: MESSAGE_TOP });
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