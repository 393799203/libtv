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
