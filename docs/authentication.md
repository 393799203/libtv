# 注册、登录和会话

新用户注册必须先通过邮箱验证码验证；已有账号继续使用原有邮箱和密码登录，不强制修改旧密码。

登录、注册成功后统一进入首页 `/`，忽略旧的 `redirect` 查询参数和 `auth_redirect` 缓存。注册推荐码不显示输入框，仅随当前 URL 的 `ref` 参数提交。

## 运营管理权限

前端 `/admin` 路由要求管理员角色，在渲染后台页面或加载后台数据之前拦截普通账号。后端通过 `ManagementAccess` 独立限制用户列表、运营配置、待审核列表、审核操作、公共素材修改及其他管理操作；隐藏导航不能替代接口鉴权。

公开 Banner 接口只返回启用的内容，包含禁用内容的运营列表改为 `/api/admin/banners`。已发布作品仍可公开浏览；未发布作品仅管理员和所属项目的主人可预览。普通用户只能提交自己项目的作品，作者强制为本人、状态强制为待审核，不能自行审核通过或修改已发布作品。

## 行为

| 项目 | 规则 |
| --- | --- |
| 注册验证码 | 6 位随机数字，10 分钟有效，60 秒后可重发；错误 5 次后必须重新获取 |
| 新密码 | 至少 8 个 Unicode 字符，最多 72 个 UTF-8 字节；注册、修改、找回共用规则 |
| 普通登录 | 浏览器会话 Cookie，服务端最长 24 小时 |
| 记住我 | 持久 Cookie，服务端最长 30 天 |
| 访问凭证 | 15 分钟有效，接近过期时自动续签；续签不能延长服务端的绝对期限 |
| 单处登录 | 新登录在事务中撤销此账号的其他会话；同时登录也只留下一个有效会话 |
| 多个标签页 | 同一浏览器通过 Cookie 共享会话，登录和退出通过无凭证的事件同步 |
| 退出 | 服务端撤销当前会话后才报告退出成功；旧访问凭证和续签凭证立即失效 |
| 修改、找回密码 | 密码版本递增，所有旧访问凭证和续签凭证失效 |

访问凭证只留在内存中。刷新页面时通过 `HttpOnly; SameSite=Lax` Cookie 恢复登录；HTTPS 下 Cookie 同时设置 `Secure`。服务端只保存随机续签凭证的 SHA-256 摘要，注册验证码保存带密钥的 HMAC 摘要。浏览器不再将认证信息写入 localStorage 或可被 JavaScript 读取的共享 Cookie。

`POST /api/auth/refresh` 和 `/logout` 需要 `X-Requested-With: libtv`，并校验请求 Origin。跨域来源必须显式加入 CORS 白名单。`AUTH_COOKIE_DOMAIN` 为父域时可在其子域间共享登录；其他域名自动使用当前域名的 Cookie。

画布 SSE 接口同时校验访问凭证、服务端会话、项目所有者及执行所属项目；在心跳和数据事件发送前复查会话，撤销后停止推送。

## 频率限制

频率计数保存在 PostgreSQL，Redis 不可用时仍有效。数据库不可用时认证请求失败，不绕过校验。

| 范围 | 限制 |
| --- | --- |
| 登录 IP | 每分钟 30 次 |
| 登录邮箱 | 每 15 分钟 10 次尝试，大小写共用计数 |
| 注册 IP | 每分钟 10 次 |
| 注册验证码 IP | 每分钟 5 次 |
| 找回、重置密码 IP | 分别每分钟 10 次 |

过期会话、验证码和频率计数在启动及每小时清理。服务端新增 `auth_sessions`、`registration_codes`、`auth_rate_buckets` 三张表，由现有 AutoMigrate 创建。

## 部署

1. 在 `.env` 中设置私有 `JWT_SECRET`，建议使用 `openssl rand -hex 32` 生成。Docker 和 release 模式拒绝使用仓库示例密钥；密钥至少 32 字节。
2. 复用现有的 `SMTP_*` 环境变量。线上容器已配置并启用 SMTP，无需另建邮件服务；新环境可参照 `.env.example`。新注册必须成功发送验证码，不提供跳过邮箱验证的降级入口。欢迎邮件仍是可选通知，找回密码沿用邮件重置流程。
3. 同父域共享登录时设置 `AUTH_COOKIE_DOMAIN=.yunqueai.cloud`；独立域名不必修改。保持 HTTPS 反向代理传递正确的 Host 和 `X-Forwarded-Proto`。
   IP 限流只信任 `server.trusted_proxies` 中的代理及其覆盖设置的 `X-Real-IP`。现有配置包含本机和 Docker 常用网段；其他代理通过 `TRUSTED_PROXIES` 配置，不要将任意公网客户端设为可信代理。
4. 重建前后端并启动。旧版 JWT 缺少服务端会话标识，会被拒绝；旧版浏览器认证缓存自动清除，升级后需重新登录一次。

## 验证

后端：`cd server && go test ./...`。新增 `internal/handler/auth_flow_test.go` 在本地 PostgreSQL 独立临时 schema 中验证验证码、会话期限、单处登录、并发登录、退出、改密、JWT 限制和 CSRF。可通过 `AUTH_TEST_DSN` 指定测试数据库。

前端：在 `web` 运行 `npx tsc --noEmit -p tsconfig.app.json`、`npm run build` 和 `node --import ./tests/register-loader.mjs --test tests/auth-session.test.ts tests/auth-navigation.test.ts`。

浏览器：先启动前端，再运行 `node tests/auth-flow-browser.mjs`。测试使用模拟 API，不发送真实邮件或创建真实账号。需要 Playwright 和 Chrome；若 Playwright 不在项目模块路径内，可用 `PLAYWRIGHT_MODULE` 指向其 `index.mjs`。覆盖 320 / 390 / 768 / 1440 宽度、注册和登录错误、记住我、刷新恢复、跨标签页退出、迟到的续签响应、异地登录失效、后台图标和作品广场列数。

`node tests/admin-access-browser.mjs` 验证登录和注册默认首页、历史跳转无效、普通用户无法挂载后台的任何页签、管理员仍能访问后台。`node tests/mobile-gallery-search-browser.mjs` 验证移动端搜索、中文输入和清空防抖。
