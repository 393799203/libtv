import { useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';
import { App as AntApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { router } from '@/router';

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
          // 底色与文字都压到冷色暗面，避免 antd 默认的纯灰
          colorBgBase: '#070a12',
          colorTextBase: '#f2f6ff',
          colorBorder: '#1e2942',
          colorBorderSecondary: '#1a2338',
          // antd 暗色算法把分隔线推导成"半透明白"，在近黑底上会变成刺眼白线
          colorSplit: '#172234',
          // ---- 选中态统一：全站"被选中"一律用青色 ----
          // colorPrimaryBg / controlItemBgActive 是 antd 里绝大多数"选中/激活"的取值来源：
          // 下拉选中项、菜单激活项、表格选中行底色都走它们，统一在这里定义就不会各处分叉。
          colorPrimaryBg: 'rgba(34, 211, 238, 0.14)',
          colorPrimaryBgHover: 'rgba(34, 211, 238, 0.2)',
          colorPrimaryBorder: '#22d3ee',
          controlItemBgActive: 'rgba(34, 211, 238, 0.16)',
          controlItemBgActiveHover: 'rgba(34, 211, 238, 0.22)', 
        },
        components: {
          Layout: { headerBg: '#080d18', bodyBg: '#070a12', siderBg: '#080d18' },
          Modal: { contentBg: '#0d1320', headerBg: '#0d1320' },
          Card: { colorBgContainer: '#0d1320' },
          Table: {
            colorBgContainer: '#0d1320',
            headerBg: '#131b2b',
            borderColor: '#172234',
            headerSplitColor: '#172234',
            rowHoverBg: '#1a2438',
          },
          Dropdown: { colorBgElevated: '#131b2b' },
          Menu: {
            itemBg: 'transparent',
            subMenuItemBg: 'transparent',
            itemSelectedBg: 'rgba(34, 211, 238, 0.16)',
            itemSelectedColor: '#67e8f9',
          },
          Tabs: { itemSelectedColor: '#67e8f9', inkBarColor: '#22d3ee' },
          Segmented: { itemSelectedBg: 'rgba(34, 211, 238, 0.2)', itemSelectedColor: '#a5f3fc' },
          Select: { optionSelectedBg: 'rgba(34, 211, 238, 0.16)' },
          Tooltip: { colorBgSpotlight: '#1a2438' },
        },
      }}
    >
      <AntApp>
        <RouterProvider router={router} />
      </AntApp>
    </ConfigProvider>
  );
}

export default App;