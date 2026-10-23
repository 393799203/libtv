import base from './vite.config';

// 临时审计配置：把 /api 指向线上只读接口，用于本地设计与检测（用完即删）
export default {
  ...base,
  server: {
    ...base.server,
    port: 3101,
    proxy: {
      '/api': { target: 'https://yunqueai.cloud', changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      '/media': { target: 'https://yunqueai.cloud', changeOrigin: true },
    },
  },
};
