import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rolldownOptions: {
      // 配合 includeDependenciesRecursively: false，避免 chunk 间循环依赖导致运行时报错
      preserveEntrySignatures: 'allow-extension',
      output: {
        // 保证模块执行顺序严格正确，避免跨 chunk 引用未初始化的导出
        strictExecutionOrder: true,
        codeSplitting: {
          // 每个 group 只捕获匹配的模块本身，避免把整条依赖链拉进单个 chunk
          includeDependenciesRecursively: false,
          groups: [
            // React 核心
            { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/, priority: 30 },
            // antd 依赖的基础库（dayjs、emotion 等）
            { name: 'vendor-base', test: /[\\/]node_modules[\\/](@babel[\\/]runtime|dayjs|@emotion|classnames|@ctrl[\\/]tinycolor|lodash|scroll-into-view-if-needed|toggle-selection|copy-to-clipboard)[\\/]/, priority: 30 },
            // antd 的 rc-* 底层组件，体量大，与 antd 主体分开便于缓存
            { name: 'vendor-antd-rc', test: /[\\/]node_modules[\\/](rc-[\w-]+|@rc-component)[\\/]/, priority: 25 },
            // UI 组件库主体（antd + 图标）
            { name: 'vendor-antd', test: /[\\/]node_modules[\\/](antd|@ant-design)[\\/]/, priority: 20 },
            // 画布引擎（画布页专用）
            { name: 'vendor-xyflow', test: /[\\/]node_modules[\\/]@xyflow[\\/]/, priority: 20 },
            // FFmpeg WASM（仅上传/处理场景用到）
            { name: 'vendor-ffmpeg', test: /[\\/]node_modules[\\/]@ffmpeg[\\/]/, priority: 20 },
            // 轮播组件
            { name: 'vendor-carousel', test: /[\\/]node_modules[\\/](swiper|react-slick|slick-carousel)[\\/]/, priority: 20 },
            // 其余三方依赖统一归入 vendor，超过 400KB 自动再切分
            { name: 'vendor', test: /[\\/]node_modules[\\/]/, priority: 10, minSize: 1, maxSize: 400 * 1024 },
          ],
        },
      },
    },
    // antd 生态（antd 主体 + rc-* 组件）天然较大，放宽告警阈值
    chunkSizeWarningLimit: 1024,
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        // SSE 长连接：禁用超时，防止 ~14s 断连
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            // SSE 长连接：禁用压缩，防止缓冲
            if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
              delete proxyRes.headers['content-encoding'];
            }
          });
        },
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
      '/media': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
