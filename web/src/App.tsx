import { useEffect, type ReactNode } from 'react';
import { RouterProvider } from 'react-router-dom';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { router } from '@/router';
import { bindAntdApp } from '@/utils/antdApp';

/**
 * 平台主题：高饱和冷色暗底（黑 / 青 / 蓝 / 紫）。
 *
 * 背景动机：用户在这个平台上高强度连续作业，大面积白底的眩光会明显加重眼疲劳；
 * 冷色系暗底既能降低亮度冲击，也更符合"科技工具"的调性。
 *
 * 两层落地：
 *  1) antd 用 darkAlgorithm + 冷色主色 —— 组件库（表格/弹窗/下拉/输入…）整体转暗；
 *  2) `<html>` 上挂 `.theme-dark`，由 src/styles/dark-theme.css 把历史代码里写死的
 *     浅色工具类（bg-white / text-gray-800 …）统一映射到暗色语义变量。
 * 两者合起来才不出现"组件暗了、页面还白着"的割裂。
 */
const THEME_CLASSES = ['theme-dark', 'theme-dark-root'] as const;

/**
 * 把 antd <App> 提供的（带上面这套主题的）message / modal 注册给非组件代码用。
 * 没有它，services 层只能用 antd 静态方法，弹出来的是没主题的浅色提示条（白底）。
 * 详见 src/utils/antdApp.ts。
 */
function AntdAppBridge({ children }: { children: ReactNode }) {
  const { message, modal } = AntApp.useApp();
  useEffect(() => {
    bindAntdApp({ message, modal });
  }, [message, modal]);
  return <>{children}</>;
}

function App() {
  useEffect(() => {
    document.documentElement.classList.add(...THEME_CLASSES);
    return () => document.documentElement.classList.remove(...THEME_CLASSES);
  }, []);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          // 主色走青色（冷、饱和、在暗底上对比足够），链接色略偏蓝
          colorPrimary: '#22d3ee',
          colorInfo: '#22d3ee',
          colorLink: '#38bdf8',
          colorSuccess: '#22c55e',
          colorWarning: '#f59e0b',
          colorError: '#f43f5e',
          borderRadius: 6,
          // 底色与文字都压到中性黑灰（原来偏藏蓝），避免 antd 默认的纯灰
          colorBgBase: '#121316',
          colorTextBase: '#f6f6f7',
          // 显式指定文字色阶：antd 默认由基色按透明度混出次级色，在暗底上总是偏灰，
          // 这里直接对齐 dark-theme.css 的 --dv-text-2/3，让 antd 组件与手写样式同一档白度
          colorTextSecondary: '#d6d7da',
          colorTextTertiary: '#aaacb1',
          colorTextQuaternary: '#8b8d93',
          // 主文字与图标：antd 组件（菜单、按钮、分页、下拉）内部用的是这几个令牌，
          // 不显式接管就会用默认的"基色混透明度"，在深底上整体偏暗
          colorText: '#f6f6f7',
          colorTextHeading: '#f6f6f7',
          colorTextDescription: '#aaacb1',
          colorTextPlaceholder: '#8b8d93',
          colorTextDisabled: '#5f6166',
          colorIcon: '#d6d7da',
          colorIconHover: '#f6f6f7',
          colorBorder: '#3a3d43',   // 与 --dv-border-2 同步（这两个值必须一起改，否则框/分隔线在暗底上看不见）
          colorBorderSecondary: '#2c2e33',   // 与 --dv-border-1 同步
          // antd 暗色算法把分隔线推导成"半透明白"，在近黑底上会变成刺眼白线
          colorSplit: '#2c2e33',
          // ---- 选中态统一：全站"被选中"一律用青色 ----
          // colorPrimaryBg / controlItemBgActive 是 antd 里绝大多数"选中/激活"的取值来源：
          // 下拉选中项、菜单激活项、表格选中行底色都走它们，统一在这里定义就不会各处分叉。
          colorPrimaryBg: 'rgba(34, 211, 238, 0.14)',
          colorPrimaryBgHover: 'rgba(34, 211, 238, 0.2)',
          colorPrimaryBorder: '#22d3ee',
          controlItemBgActive: 'rgba(34, 211, 238, 0.16)',
          // ---- 悬浮/填充色：antd 暗色算法把"填充"定义成半透明白（rgba(255,255,255,.08)），
          // 在近黑底上就会"发白"（文字按钮、标签、图标按钮的 hover 底都是它）。
          // 这里改成冷色暗面/青色淡染，与整体色调一致，也不会亮得刺眼。
          controlItemBgHover: 'rgba(34, 211, 238, 0.10)',
          colorFillTertiary: '#232427',
          colorFillSecondary: '#2b2d31',
          colorFill: '#36383d',
          colorFillQuaternary: '#232427',
          controlItemBgActiveHover: 'rgba(34, 211, 238, 0.22)', 
        },
        components: {
          // headerBg 半透明：配合 dark-theme.css 里的 backdrop-filter 做玻璃化头部
          Layout: { headerBg: 'rgba(18, 19, 22, 0.86)', bodyBg: '#121316', siderBg: 'rgba(18, 19, 22, 0.86)' },
          Modal: { contentBg: '#232427', headerBg: '#232427' },
          // 主按钮的投影：青色调、柔和下沉，让按钮"浮"在面板上（比默认灰影更贴主题）
          Button: { primaryShadow: '0 6px 18px -6px rgba(34, 211, 238, 0.55)' },
          Card: { colorBgContainer: '#1b1c1f' },
          Table: {
            colorBgContainer: '#1b1c1f',
            headerBg: '#232427',
            borderColor: '#2c2e33',
            headerSplitColor: '#2c2e33',
            rowHoverBg: '#2b2d31',
          },
          Dropdown: { colorBgElevated: '#232427' },
          Menu: {
            itemBg: 'transparent',
            subMenuItemBg: 'transparent',
            itemSelectedBg: 'rgba(34, 211, 238, 0.16)',
            itemSelectedColor: '#67e8f9',
            itemColor: '#d6d7da',
            itemHoverColor: '#f6f6f7',
            darkItemColor: '#d6d7da',
            darkItemHoverColor: '#f6f6f7',
            darkItemSelectedColor: '#67e8f9',
          },
          Tabs: { itemSelectedColor: '#67e8f9', inkBarColor: '#22d3ee' },
          Segmented: { itemSelectedBg: 'rgba(34, 211, 238, 0.2)', itemSelectedColor: '#a5f3fc' },
          Select: { optionSelectedBg: 'rgba(34, 211, 238, 0.16)' },
          Tooltip: { colorBgSpotlight: '#2b2d31' },
        },
      }}
    >
      <AntApp>
        <AntdAppBridge>
          <RouterProvider router={router} />
        </AntdAppBridge>
      </AntApp>
    </ConfigProvider>
  );
}

export default App;