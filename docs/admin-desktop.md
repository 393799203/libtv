# 运营后台仅支持 PC

运营管理保留 PC 侧栏、表格、筛选和业务操作。移动端专用列表、模块选择器、响应式表格封装和适配样式已移除。

后台入口与路由守卫共用设备条件：视口至少 768px，且不是无悬停能力的粗指针触摸设备。手机横屏和平板同样不提供运营管理入口。直接访问 `/admin` 或任意后台子页面会返回首页；PC 后台窗口缩窄到 768px 以下时也会退出后台，子页面不挂载、不请求管理数据。

设备限制用于前端使用范围，实际权限仍由管理员角色和后端鉴权保证。公开广场、个人中心等已有手机功能继续使用原有布局。

## 验证

```sh
cd web
npx tsc --noEmit -p tsconfig.app.json
npm run build
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/admin-desktop-browser.mjs
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node tests/admin-access-browser.mjs
```

浏览器回归检查手机竖屏、横屏、平板、窄 PC 窗口和窗口缩放的访问限制，以及 PC 八个后台模块、表格与主要弹窗。全部使用模拟 API，不提交充值、退费或删除等修改。`QA_ORIGIN` 可用于验证已部署前端。
