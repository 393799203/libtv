# 国内「AI 视频修复 / 超分」垂直厂商与工具 — API 开放情况调研

> **调研目标**：为 libtv（Go 后端，漫剧/短剧 AI 视频生成平台）的 480p 成片「清晰化」选型——视频超分（480p→720p/1080p，2~3 倍）、去噪/去块/锐化、老片修复、补帧（24/30→60fps）。
>
> **调研方法**：本机 `curl -sL --compressed` 直接抓取官方网站 / 文档站 / 定价页 / 前端 bundle 原文，并对开放平台公开 JSON 接口做全量枚举。
>
> **检索工具环境限制（重要，供后续复核者参考）**：
> - 内置 `web_search` 工具不可用。
> - Bing（cn.bing.com / www.bing.com）结果被严重过滤，不可依赖。
> - **百度**：初期可用，但**在第 4 轮请求后触发「百度安全验证」**（返回 `<title>百度安全验证</title>`，约 1.5 KB），**不可依赖**。
> - **360 搜索（www.so.com）**：调研中期可用（曾用于发现官方页面 URL），**后期同样触发「访问异常页面」限流**。
> - DuckDuckGo（html/lite）在本环境**不可达**（HTTP 000）。
> - `web.archive.org`（Wayback）在本环境**超时不可达**。
> - → **本报告所有结论均以直接抓取到的官方页面/接口原文为准**；搜索引擎仅用于发现 URL，相关线索一律标注为二手。
>
> **可信度标注约定**：
> - 【官方】= 抓取到厂商官方文档站/定价页/API 路由/开放平台接口的原文。
> - 【二手】= 搜索引擎摘要、第三方站点、经销商页面等，**可信度低**，仅作线索。
> - 「**推算**」= 本文基于官方公布单价做的算术换算，已明确标注，**非厂商公布的一口价**。
> - 页面日期：多数站点未暴露日期，统一写作「页面日期未知」；官方文档站给出的「最近更新时间 / 更新时间」照实标注。

---

## 目录

1. [商汤科技 SenseTime](#1-商汤科技-sensetime)
2. [美图 AI 开放平台](#2-美图-ai-开放平台aimeitucom)
3. [Topaz Labs（含中国代理情况）](#3-topaz-labs含中国代理情况)
4. [阿里云（百炼 VideoRetalk / IMS 音画增强 / 视觉智能开放平台）](#4-阿里云三条路线)
5. [牛学长 / 牛小影（HitPaw 中国）](#5-牛学长--牛小影hitpaw-中国)
6. [微帧科技 Visionular](#6-微帧科技-visionular补充候选)
7. [腾讯云媒体处理 MPS（含「漫剧场景」大模型增强）](#7-腾讯云媒体处理-mps含漫剧场景大模型增强)
7.5. [RunningHub（国内 AI API 聚合平台）](#75-runninghub国内-ai-api-聚合平台含-topaz--火山画质增强)
8. [影谱科技 Moviebook](#8-影谱科技-moviebook)
9. [万兴科技 Wondershare / Media.io](#9-万兴科技-wondershare--mediaio)
10. [出门问问 / 深言科技](#10-出门问问--深言科技)
11. [相芯科技 FaceUnity](#11-相芯科技-faceunity)
12. [虹软 ArcSoft](#12-虹软-arcsoft)
13. [中科视语 VISIQUEST](#13-中科视语-visiquest)
14. [海康威视 Hikvision](#14-海康威视-hikvision)
15. [大华股份 Dahua](#15-大华股份-dahua)
16. [极睿科技 / 硅基智能 / 瑞莱智慧](#16-极睿科技--硅基智能--瑞莱智慧)
16.5. [其它国内云厂商（华为云 / 百度智能云 / 火山引擎 / 腾讯云 CI）](#165-其它国内云厂商华为云--百度智能云--火山引擎--腾讯云-ci)
17. [OpenMMLab / MMagic（开源可自建路线）](#17-openmmlab--mmagic开源可自建路线)
18. [Replicate / fal.ai 与开源商用云服务](#18-replicate--falai-与开源商用云服务海外数据出境风险)
19. [汇总表](#汇总表)
20. [未证实清单](#未证实清单)

---

## 1. 商汤科技 SenseTime

**结论：否（未证实存在对外开放的文件级视频超分/插帧/修复 API）**

### 抓到的官方事实

- 官网产品体系（https://www.sensetime.com/cn/ ，页面日期未知）列出的全部相关产品为：
  - **商汤日日新 SenseNova**（大模型及应用）、Token Plan、**Seko**（多模态短片创作平台）、小浣熊 AI 办公智能体、**如影**（数字人全域营销解决方案）、咔皮记账、Kapi 相机、咔皮健康。
  - **商汤大装置 SenseCore**（AI 算力池 SSP、托管 K8s ECP、云服务器 ECS、文件存储 AFS）。
  - **商汤方舟 SenseFoundry**（城市/企业 AI 赋能平台、SFE ID 身份核验私有化、星云门禁一体机）。
  - 其它：SenseAR 美颜特效 SDK、商汤烧卖购、元萝卜下棋机器人。
- 产品/技术全站导航（https://www.sensetime.com/cn/technology-detail?categoryId=43 ，页面日期未知）中：
  - 「**智能内容增强**」仅作为技术能力栏目名出现，页面正文 JS 动态加载，**未抓到任何超分接口文档**。
  - **SenseME 水星智能移动终端平台** 官方描述为「提供包括 **SDK、AI 传感器和 ISP 芯片**等全套产品……促进感知智能和内容增强」，子项为 **移动终端 SDK / TetrasMobile ID 手机解锁 / TetrasMobile Video 智能视频 / TetrasMobile Photo 智能影像**。
  - **SenseMARS** 子项为「特效引擎 SenseMARS」「三维空间重建 SenseMARS Reconstruction」——**没有视频超分/修复 API**。
- **如影 SenseAvatar = 数字人生成**；**秒画 SenseMirage = AI 文生图**；**Seko = 多模态短片创作 Agent**（同上页）——**均非视频增强/超分**。
- SenseNova 是 LLM/多模态大模型平台：`https://api.sensenova.cn/v1/llm/models` 返回 `401 {"error": {"code": 16,"message": "Authorization Not Found"}}` —— 证明其 API 网关是 **LLM 模型接口**，产品清单中不含视频超分能力。
- SenseCore 大装置官网（https://www.sensecore.cn/ ，页面日期未知）能力为：大模型即服务、AI 云计算/存储/网络、开发者工具、大模型一体机、AI 算力池 SSP/ECP/ACP/CCI/ECS/BMS——**未见「视频超分/增强」托管 API**。其「专家服务」为「业务咨询、场景设计、模型训练、推理部署等全栈服务」，交付模式为「产品化 license 交付、云服务交付」。

### 商汤的视频超分技术实际以「开源」与「端侧 SDK/芯片」形态存在

- 商汤与港中文 MMLab 开源的 **MMSR 图像视频超分辨率工具箱**，以及 **EDVR**（NTIRE 2019 视频恢复比赛四项冠军）——**开源可自建，不是云 API**。【二手：https://blog.csdn.net/moxibingdao/article/details/106667115 、https://blog.csdn.net/moxibingdao/article/details/106666850 ，可信度中低；下方有官方交叉印证】
- **交叉印证（官方一手）**：OpenMMLab 官方 **MMagic** 仓库 README（https://raw.githubusercontent.com/open-mmlab/mmagic/main/README.md ，页面日期未知）在册 **Video Super-Resolution** 含 **EDVR (CVPR'2018)、BasicVSR (CVPR'2021)、BasicVSR++ (CVPR'2022)、RealBasicVSR (CVPR'2022)**；**Video Interpolation** 含 **TOFlow (IJCV'2019)、CAIN (AAAI'2020)、FLAVR (CVPR'2021)**；许可证 **Apache 2.0**（https://raw.githubusercontent.com/open-mmlab/mmagic/main/LICENSE ）。**这是商汤系视频超分/插帧能力可商用、可自建落地的最现实路径。**

| 项目 | 结论 |
|---|---|
| 对外开放可直接调用的文件级视频超分/插帧/修复 API | **否 / 未证实** |
| 产品与接口名 | 未证实（SenseNova 无此模型；SenseCore 无此托管服务；SenseME/TetrasMobile 为端侧 SDK） |
| 调用形态 | 不适用（端侧 SDK / AI-ISP 芯片 / 私有化 license） |
| 输入限制 | 未证实 |
| 计价方式与单价 | 未证实（官网仅「产品咨询」/「专家服务」入口） |
| 开通前置 | 商务咨询；SenseCore 提供产品化 license 交付与云服务交付 |
| 中国大陆节点 | 是（SenseCore 上海/深圳/广州/福州/济南/重庆等节点） |
| 数据出境风险 | 无（国内厂商） |

**未证实项**：SenseFoundry 方舟「算法商城」（AI-as-a-Service）是否上架视频超分算法；是否有商务定制的私有化「视频增强/超分」交付。

---

## 2. 美图 AI 开放平台（ai.meitu.com）

**结论：是 —— 官方产品清单中确有「视频超清」「视频AI超清2.0」「Video Super Resolution」等视频超分能力，并已实测确认 3 条真实 API 路由；但接口参数与价格未公开（申请制）。**

### 2.1 官方产品清单（证明「有视频超分」，不只是图片）

抓取自官方文档站的菜单（https://ai.meitu.com/doc ，页面日期未知；该 SPA 的菜单为 **SSR 输出**，可直接从 HTML 解析）。**全站文档菜单共 243 条**，其中视频/画质增强相关条目及其**文档 ID**（对应 `https://ai.meitu.com/doc/?id=<ID>`）如下——**这是「确有视频超清产品」最直接的一手证据**：

| 文档 ID | 菜单标题（原文） | 归属 |
|---|---|---|
| **404** | **视频超清** | 视频 |
| **420** | **视频AI超清2.0** | 视频 |
| **432** | **Video Super Resolution** | 海外版条目 |
| **414** | **视频-画质增强** | 视频 |
| **415** | 视频-暗光去噪-画质调光 | 视频 |
| **417** | 视频-色彩增强 | 视频 |
| **416** | 视频-人像美化 | 视频 |
| **372** | 视频去噪 | 视频 |
| **376** | 视频防抖处理 | 视频 |
| **377** | 视频眼神矫正 | 视频 |
| **418** | 视频切片 | 视频 |
| **422** | 视频片段截取 | 视频 |
| **429 / 392** | 视频去字幕 / 视频去字幕(AI开放平台) | 视频 |
| **313 / 397** | 视频去水印 / 视频去水印 | 视频 |
| **308 / 402** | 视频加水印贴纸 / 视频加水印贴纸 | 视频 |
| **374** | 视频对口型 | 视频 |
| **378 / 379** | 视频检测分析 / 视频混剪 | 视频 |
| **405 / 406 / 430** | 人像增强-基础版 / 人像增强-极致版 / 人像增强-极致版 | 视频/人像 |
| **315** | AI生视频v3.0(AI开放平台) | 视频 |

**为对比而列的「图片」条目（证明美图图片与视频是两套独立条目）**：图像去噪 134、风景去噪 143、人像去噪 144、图像画质修复V2 207、图片AI超清配置 254、图片AI超清API 255、画质修复v3 252、超清人像 75、AI超清V2 395、商品图修复 428、AI超清V1(AI开放平台) 333、AI超清V2(AI开放平台) 356、图像画质修复V3/V2(AI开放平台) 334/335、文字图表修复(AI开放平台) 343。

接入指南另有：**异步任务查询**、**异步任务取消**、**API任务查询状态**、**API调用示例**、**AIGCP-API接口签名算法接入详解**（含 Golang/Java/Python/PHP/JS/Kotlin/ObjC/Swift/C# 多语言签名示例）。

> ⚠️ 上述 `/doc/?id=NNN` 正文**需登录后读取**：未登录访问任一 ID 均返回**完全相同的 504,882 字节 SPA 壳**（正文由前端异步拉取），故**接口路径、请求参数、输入限制、具体单价均未能证实**。

> **明确区分**：美图同时有大量**图片**超分条目（图片AI超清、图片AI超清API、AI超清V2、无损放大、画质修复v3、图像画质修复V2、超清人像、图像去噪、文字图表修复……）。**但「视频超清 / 视频AI超清2.0 / Video Super Resolution」确实在视频分类下，属视频超分，不是仅图片。**

### 2.2 已实测确认的真实 API 路由（强证据）

从官方前端 bundle（https://ai.meitu.com/js/app.5cea015c.js ）解析出 API 基址与调用约定：

- **基址**：`https://openapi.mtlab.meitu.com/` + 路径。bundle 内原文：
  `S = function(e,...){ n={url: /https?:\/\//gi.test(e) ? e : "https://openapi.mtlab.meitu.com/"+e, method:a, data:..., params:t, qsFLag:i}; ... }`
- **鉴权**：header `Authorization: Bearer <token>` + `AuthorizationType: 1`；或 query 参数 `api_key` / `api_secret`；token 由 `window.aksign(api_key, api_secret)` 生成。文档站另有《AIGCP-API接口签名算法接入详解》及 Golang/Java/Python/PHP/JS/Kotlin/ObjC/Swift/C# 多语言签名示例。
- 已知图片路由示例（bundle 明文）：`v2/facepoints`、`v3/facefuse`、`v1/beauty`、`v2/denoise`、`v1/night_denoise`、`v2/headreplace`、`v2/segment`。

**网关路由探测**（本次实测）：请求未知路径返回 `{"error_code":1000404,"message":"no route found"}`；请求**已存在**的路径返回 `{"Data":null,"ErrorCode":90002,"ErrorMsg":"GATEWAY_AUTHORIZED_ERROR"}`（路由存在但需授权）。据此确认：

| 路由 | 探测结果 | 判定 |
|---|---|---|
| `v1/videoDenoise` | `GATEWAY_AUTHORIZED_ERROR` | **路由存在** |
| `v1/videoEnhance` | `GATEWAY_AUTHORIZED_ERROR` | **路由存在** |
| `v1/superResolution` | `GATEWAY_AUTHORIZED_ERROR` | **路由存在** |
| `v1/videoSuperResolution` | `no route found` | 不存在 |
| `v1/video_super_resolution`、`v1/videosuperresolution`、`v2/videoSuperResolution`、`v2/videoDenoise`、`v1/video_sr`、`v1/videoSR`、`v1/sr`、`v1/video_process` 等 20+ 命名变体 | `no route found` | 不存在 |
| `v1/BEAUTY` / `v1/Beauty` / `v1/bEaUtY` | 均 `GATEWAY_AUTHORIZED_ERROR` | **网关路由不区分大小写**（故 `v1/superResolution` 与 `v1/superresolution` 为同一路由） |

> ⚠️ `v1/superResolution` 究竟对应**视频**超清还是图片超清，**无法从路由本身判定**（无授权无法读取参数）。`v1/videoEnhance` 与官方条目「视频-画质增强」、`v1/videoDenoise` 与「视频去噪」命名高度对应，但**参数与语义未证实**。

### 2.3 开通与计价

- **开通流程**（官方文档站「接入指南」原文）：`01 注册账号 → 02 申请接口 → 03 价格确认 → 04 订单支付 → 05 正式接入`；联系邮箱 `aigc@meitu.com` / `mtlab@meitu.com`。
- **平台迁移**：官方站显著提示「**平台迁移预告 美图 AI 开放平台即将迁移至 MiracleVision**」→ https://www.miraclevision.com 。新平台为「美图奇想大模型 MiracleVision V6」，含「图像/视频/设计」能力与「模型接入」入口，但**该页面未展示任何 API 文档或价格**。
- **单价**：**官方未公开**。第三方雪球帖称「按调用次数收费：2万次调用 价格为 ￥20,000」【二手：https://xueqiu.com/1909276603/331998659 ，**可信度低**，无法确认适用于视频超清，**不可作为报价依据**】。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分 API | **是**（产品清单明确 + 3 条路由实测存在）；**参数与价格未公开** |
| 产品与接口名 | 产品：视频超清 / 视频AI超清2.0 / Video Super Resolution / 视频-画质增强 / 视频去噪。基址 `https://openapi.mtlab.meitu.com/`；已确认路由 `v1/superResolution`、`v1/videoEnhance`、`v1/videoDenoise`（**其余路由名与全部参数未证实**） |
| 调用形态 | **异步 + 轮询**（文档站有「异步任务查询」「异步任务取消」「API任务查询状态」） |
| 输入限制 | 未证实（文档正文需登录后读取） |
| 计价方式与单价 | 申请制「价格确认」，**官方未公开单价**（二手 ￥20,000/2万次 不可靠） |
| 开通前置 | 注册账号 + 申请接口 + 价格确认 + 订单支付；商务邮箱 aigc@meitu.com |
| 中国大陆节点 | 是（国内厂商，`openapi.mtlab.meitu.com`） |
| 数据出境风险 | 无（国内厂商）；注意官方另有海外版条目（Video Super Resolution / Portrait Enhancement (Overseas)） |

---

## 3. Topaz Labs（含中国代理情况）

**结论：是 —— 调研范围内唯一「公开自助注册 + 公开定价 + 官方 REST API 文档 + 确有视频超分与视频插帧」的厂商。但为美国服务，无中国大陆节点，数据出境风险明确。**

### 3.1 官方 API 存在（https://www.topazlabs.com/api ，页面日期未知）

官方 API 落地页原文要点：
- 标题：**「Image and Video Upscaling & Enhancement API」**；「Upscale, restore, and transform images and video at scale with your app or website.」「**No credit card required.**」
- 「Easily integrate the same industry-leading models in Topaz Photo and Topaz Gigapixel through a **REST API** interface.」
- 包含模型（官方 FAQ 原文）：**「image upscaling, image denoise, image sharpen, video upscaling, and video frame interpolation」**。
- 客户背书：Google、Tesla、Nike、Nvidia（介绍页原文）；Weavy、Krea（引用）。
- 规模（原文）：3M+ requests/month、7.5M+ photos、2.3M+ videos enhanced。

### 3.2 官方 API 定价（https://www.topazlabs.com/api ，页面日期未知）

| 档位 | 价格 | 额度 | 单价 | 备注 |
|---|---|---|---|---|
| Starter | $0/mo（**COMING SOON**） | — | **$0.12 / credit** | 无承诺 |
| Developer | **$50/mo** | 500 credits/mo | **$0.10 / credit** | credits 可结转；含支持 |
| Scale | **$240/mo** | 3000 credits/mo | **$0.08 / credit** | 优先支持、自定义工作流 |
| Enterprise | 「Let's talk」 | — | 量价 | **Volume pricing、on-premise deployment、Dedicated dev support** |

- credit 语义（官方 FAQ 原文）：「Each credit processes a single request **at up to 24 megapixel output size** (e.g. 6000px by 4000px) with the **Enhance endpoint**」。
- ⚠️ 这是**API 网页版定价**；另有面向桌面端的「Cloud Rendering」Video Cloud Credits，价格不同（见 3.4），**两者不可混用**。

### 3.3 官方 API 调用形态与输入限制（开发者文档，GitBook）

文档索引：https://developer.topazlabs.com/llms.txt （页面日期未知）。**该站为 GitBook，每页可加 `.md` 取原文 Markdown**，并支持 `?ask=<question>` 动态问答。视频快速开始页：https://developer.topazlabs.com/getting-started/video-quickstart.md

**视频超分/插帧为异步 + 轮询，四步式**：

1. **创建请求** — `POST https://api.topazlabs.com/video/`，header `X-API-Key: <Your-API-Key>`、`accept: application/json`、`content-type: application/json`。官方示例 body：
```json
{
  "source": { "resolution": {"width": 800, "height": 448}, "container": "mp4",
              "size": 477010, "duration": 4, "frameRate": 24, "frameCount": 97 },
  "output": { "resolution": {"width": 800, "height": 448}, "audioCodec": "AAC",
              "audioTransfer": "Copy", "frameRate": 24,
              "dynamicCompressionLevel": "High", "container": "mp4" },
  "filters": [ { "model": "apo-8", "slowmo": 1, "fps": 60,
                 "duplicate": true, "duplicateThreshold": 0.1 } ]
}
```
   （`filters[].model` 为模型代号，官方示例用 `"apo-8"`（Apollo）；`fps: 60` + `slowmo` 即补帧/变速路径。）
2. **接受并上传** — `PATCH https://api.topazlabs.com/video/{requestID}/accept` → 返回一组 S3 URL；再用
   `curl --request PUT --upload-file "Your-Video-File" --header "Content-Type: video/mp4" "$S3_UPLOAD_URL"` 直传，取回 **eTag**。
3. **确认上传完成** — `PATCH https://api.topazlabs.com/video/{requestID}/complete-upload`，body `{"uploadResults":[{"partNum":1,"eTag":"..."}]}` → 进入排队处理。
4. **轮询状态** — `GET https://api.topazlabs.com/video/{requestID}/status`；完成后响应内含**下载链接**。

**限制（官方「API Restrictions」原文）**：
- 请求体积上限 **500MB**，超限返回 **HTTP 413**。
- 仅接受 **HTTPS**，HTTP 返回 301 跳转。
- 存在**速率限制**，收到 **HTTP 429** 请退避重试（官方建议指数退避）。
- 视频模型处理超时（官方 FAQ 原文）：**GAN 视频模型约 4 小时**（如 Proteus 系列），**生成式视频模型约 17 小时**（如 Starlight、Astra 系列）；图片 GAN 约 90 分钟，生成式图片约 20 分钟。**超时算平台侧失败 → 全额退款（通常 24 小时内）**。
- 中途取消计费公式（原文）：`1.1 × [progress %]`；进度 0% 全额退款，50% 取消则扣 55%、退 45%。
- 输出**全部 C2PA 合规**。
- API Key：https://account.topazlabs.com/manage-api （登录后在 My Account → API Keys 创建，仅创建时可查看一次）。

### 3.4 视频模型与官方积分数（https://developer.topazlabs.com/getting-started/model-pricing.md ，页面日期未知）

官方原文说明：「**Video credit costs are all estimates calculated based on 10s at 1080p 30fps**」。

| 用途 | 模型族 | Credits / 视频（10s @1080p 30fps） |
|---|---|---|
| Precision Upscale（精确超分） | **Proteus** | **4** |
| Generative Upscale（生成式超分） | **Starlight** | **Fast — 6 / Quality — 12** |
| Creative Upscale（创意超分） | **Astra** | **40** |
| Denoise（去噪） | Denoise | Fast — 2 / Quality — 4 |
| Motion（补帧） | **Frame Interpolation** | **Fast — 1 / Quality — 2** |
| Video Utilities | Video Utilities | 2 |

图片档位（同页）：Precision Upscale `Gigapixel` = 24 MP/credit；Generative Upscale `Wonder` = 4 MP/credit；Creative Upscale `Bloom` = 2 MP/credit；Sharpen GAN 24 / Generative 20 MP/credit；Denoise、Removal、Color 均 24 MP/credit。

**视频模型明细**（https://developer.topazlabs.com/getting-started/individual-model-pricing.md ，页面日期未知）：视频侧在册模型含 Proteus / Proteus Natural / Rhea / Theia / Artemis 系列 / Dione 系列 / Gaia 系列 / Iris 系列 / **Starlight Precise 2.5、Starlight HQ、Starlight Mini、Starlight Sharp、Starlight Fast 2** / Astra 1、Astra 2 / **Nyx 系列（去噪）** / **Aion、Apollo、Apollo Fast、Chronos、Chronos Fast（插帧）** / Themis 2（运动去模糊）/ Video Colorization / Hyperion & Hyperion 2（SDR→HDR）。**注意该页表格的 Price 列在抓取到的 Markdown 中为空**，故单价请以 model-pricing 页的族级积分为准。

**基于官方单价的换算（推算，非官方报价）** —— 按 1 分钟 1080p30 视频计：
- **Proteus 超分**：4 credits/10s → 24 credits/min → **$1.92 ~ $2.88 / 分钟**（按 $0.08~$0.12/credit）
- **Starlight 生成式超分 Quality**：12 credits/10s → 72 credits/min → **$5.76 ~ $8.64 / 分钟**
- **Frame Interpolation Fast 补帧**：1 credit/10s → 6 credits/min → **$0.48 ~ $0.72 / 分钟**
- **Denoise Fast**：2 credits/10s → 12 credits/min → **$0.96 ~ $1.44 / 分钟**

### 3.5 桌面端 Cloud Rendering 积分价（https://www.topazlabs.com/cloud-render ，页面日期未知）

**该页为 Topaz Video / Astra / Express 桌面应用的云端渲染积分，非 API**（原文）：
- 一次性购买：20 credits = $5（$0.250/credit）；400 = $78（$0.195）；1000 = $158（$0.158）；3000 = $399（$0.133）；9000 = $999（$0.111）
- 月度订阅：80/mo = $9.99（$0.125）；400/mo = $39.99（$0.100）；1400/mo = $99.99（$0.071）；3000/mo = $199.99（$0.066）；9000/mo = $499.99（$0.055）
- 官方标注「*Credit cost per video depends on the output size」，并给出表：**Starlight / 24fps / 1 min**：1080p = **6 credits**，4K = **24 credits**；另一张 **30fps / 1 min**：1080p = 90，4K = 150（该表未标模型名，两表数值差异大，**建议以前表为准**）。「Cloud rendering currently supports output size up to 16K」。
- 图片云渲染在 Topaz Photo / Gigapixel / Bloom / Topaz Image Web 内「free and unlimited with an active subscription」。

### 3.6 中国大陆可用性与「代理」

- **无中国大陆节点、无中国区站点**。Topaz 自述模型由「our team of PhD researchers in **Dallas, Texas**」研发（https://developer.topazlabs.com/getting-started/introduction.md ）→ **数据出境风险明确（高）**：成片须整片上传至 Topaz 的 S3 上传 URL，属**原始素材出境**。
- **「中国代理」实为桌面软件经销商**：360 搜索命中的 `https://topaz-video.apsgo.com/`、`https://topaz-video.apsgo.cn/` 等自述「官方授权正版软件平台」「正版购买」，内容为**桌面版 Topaz Video 的售卖**，**未见任何 API 代理、转售或国内节点**。【二手/经销商页面，**可信度低**】
- 国内用户实际路径：官网直购桌面版（本地推理、无出境风险）或直连海外 API。
- **品牌变更注意**：官网现为 **Topaz Video**（原 Topaz Video AI）；文档另有「Video AI vs Topaz Video」对照页（https://docs.topazlabs.com/ ）。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧 API | **是**（官方 REST API，自助注册 API Key，公开定价） |
| 产品与接口名 | `POST https://api.topazlabs.com/video/` → `PATCH /video/{id}/accept` → `PATCH /video/{id}/complete-upload` → `GET /video/{id}/status`；模型：Proteus / Starlight / Astra（超分）、Nyx（去噪）、Apollo / Chronos / Aion（插帧） |
| 调用形态 | **异步 + 轮询**（`/status`）；官方未在该页声明 webhook |
| 输入限制 | 单请求 ≤ **500MB**（413）；仅 HTTPS；**无 URL 直传**（须先 accept 取 S3 URL 再 PUT 上传）；429 限流需退避 |
| 计价 | credit 制：Developer $0.10 / Scale $0.08 / Starter $0.12 per credit；Enterprise 量价 + on-premise。视频按 10s@1080p30 计：Proteus 4、Starlight 6/12、Astra 40、Frame Interpolation 1/2 |
| 开通前置 | 注册 Topaz 账号 + 自助创建 API Key（**无需企业认证、无需商务签约**）；Enterprise 才需联系 sales |
| 中国大陆节点 | **无** |
| 数据出境风险 | **高** —— 美国服务，须整片上传海外存储；如需境内合规须走 Enterprise on-premise（价格需谈） |

---

## 4. 阿里云（三条路线）

阿里云在本议题上实际有**三条互相独立**的路线，必须区分：

| 路线 | 产品 | 与本需求关系 | 结论 |
|---|---|---|---|
| A | **百炼 Model Studio · VideoRetalk** | **无关**（是口型替换） | 有 API，0.08 元/秒 |
| B | **智能媒体服务 IMS · 音画增强（AI 超分 SR5）** | **高度匹配**（官方明确针对 AIGC 生成视频超分） | 有 API，按帧计费 |
| C | **视觉智能开放平台 VIAPI · 视频超分辨/综合增强/插帧** | **高度匹配**（文件级、URL 直传） | 有 API，按分钟计费 |

### 4.1 百炼 VideoRetalk —— 有 API，但是「口型替换」，不是超分

- 文档：https://help.aliyun.com/zh/model-studio/videoretalk （标题：**声动人像VideoRetalk,视频口型替换-大模型服务平台百炼(Model Studio)-阿里云帮助中心**，页面日期未知）
- 官方原文：
  - 「声动人像 VideoRetalk 是一个人物视频生成模型，可基于人物视频和人声音频，生成人物讲话口型与输入音频相匹配的新视频。」
  - 「重要 本文档仅适用于**华北 2（北京）**地域，且必须使用该地域的 API Key。」
  - 「目前**仅支持通过 API 调用**，不支持在阿里云百炼的控制台在线体验。」

**官方资费与限流（原文表格）**：

| 模型名称 | 单价 | 免费额度 | 任务下发接口 RPS 限制 | 同时处理中任务数量 |
|---|---|---|---|---|
| `videoretalk` | 后付费，按生成视频的时长计费：**0.08 元/秒** | **1800 秒** | **1** | **1**（同一时刻只有 1 个作业实际运行，其余排队） |

- 相关页：API 参考 https://help.aliyun.com/zh/model-studio/videoretalk-api ；快速开始 https://help.aliyun.com/zh/model-studio/developer-reference/videoretalk-quick-start ；提高 RPS 需邮件 `modelstudio@service.aliyun.com`。
- **结论：VideoRetalk 确实已在百炼上提供 API（0.08 元/秒 ≈ 4.8 元/分钟），但用途是「视频口型替换/唇形同步」，与超分/去噪/补帧无关。**

### 4.2 IMS 音画增强 AI 超分（SR5）—— 官方为 AIGC 生成场景背书

- 官方实践教程：https://help.aliyun.com/zh/ims/use-cases/enhance-aigc-generated-videos-with-audio-visual-super-resolution （标题：**用音画增强为 AIGC 生成视频超分增强-智能媒体服务(IMS)**，页面日期未知）
- 官方原文（**几乎是为 AIGC 生成平台量身写的**）：
  - 「AIGC 模型直接生成 1080P/4K 视频成本高、耗时长。更经济的做法是先用模型生成 **720P** 等较低分辨率视频，再通过智能媒体服务（IMS）的音画增强能力，用 **AI 超分（Super Resolution）**放大并修复为 1080P/4K 成片。」
  - 主打场景：**AIGC 视频降本增效**、**AIGC 成片画质打磨**（边缘模糊、纹理不足、轻微压缩失真）、**老片高清重制**、**低质量片源修复**。
- **预置模板（官方表格原文，均基于 SR5 第 5 代超分能力）**：

| 模板名 | 模板 ID | 输出分辨率 | 码率 | 编码 | 封装 | 适用场景 |
|---|---|---|---|---|---|---|
| `MP4-HD-UHD-SR5` | **`S00000004-401040`** | 宽（自适应）× 高 **1080** | 6000 Kbps | H.264 | MP4 | **720P → 1080P** |
| `MP4-4K-UHD-SR5` | **`S00000004-401070`** | 宽（自适应）× 高 **2160** | 14000 Kbps | H.264 | MP4 | **1080P → 4K** |

  - 说明（原文）：「超分模板中，**超分开关默认开启，放大倍率为 2 倍**，输出宽度自适应、高度固定（1080/2160）。」「还可按需组合 **去压缩失真、多帧降噪、色彩与对比度增强、SDR 转 HDR** 等能力。」预置模板仅支持查看，不可编辑或删除。
- **API 调用（异步 + 轮询/回调）**：
  - 提交：**`SubmitMediaConvertJob`**（异步，返回 **JobId**）；查询：**`GetMediaConvertJob`**；或回调 **`MediaConvertComplete`**（官方建议「超分（尤其 4K）任务计算量较大……建议通过**回调**而非高频轮询获取结果」）。
  - 权限：`ice:SubmitMediaConvertJob`（RAM）。前置：已开通 IMS、已开通 OSS、待处理视频**已在 OSS**、输出亦须在 OSS。
  - 核心是把模板 ID 填入 `Config` 每个 `Output` 的 **`TemplateId`** 字段。官方示例：
```json
{
  "Inputs": [ { "InputFile": { "Type": "OSS", "Media": "oss://your-bucket/input/aigc-video.mp4" } } ],
  "Outputs": [ { "OutputFile": { "Type": "OSS", "Media": "oss://your-bucket/output/aigc-video-1080p-sr5.mp4" },
                 "TemplateId": "S00000004-401040", "Name": "sr5-1080p" } ]
}
```
  - CLI：`aliyun ice SubmitMediaConvertJob --region cn-shanghai --Config '...'` → `{"RequestId":"...","JobId":"88c6ca184c0e47098a5b665e2a12****"}`。可选 `PipelineId`、`UserData`。
  - 常见问题（原文）：超分输出固定为 1080P 或 4K（**不是**按倍率无限放大）。
- **官方定价**（https://help.aliyun.com/zh/ims/on-demand-media-processing-3 ，标题「点播媒体处理如何计费」，中国内地，页面日期未知）：
  - 开通前置（原文）：「如果您需要开通**音画增强**功能，请**提交工单**联系阿里云客服咨询。」→ **音画增强非自助开通，需工单**。
  - 计费规则（原文）：「对媒体文件进行音频增强、视频增强处理时，按照音频增强类型及视频增强输出规格计费。**如处理失败，则不收取费用**。」
  - 音频增强：**虚拟环绕声 2.0 元/分钟**；**音效增强 2.0 元/分钟**。
  - **超分标准版定价（元/帧）**：8K 及以下 **0.049**；4K 及以下 **0.014**；2K 及以下 **0.007**；**HD (1920×1080) 及以下 0.003255**。
  - **超分专业版定价（元/帧）**：8K **0.42**；4K **0.12**；2K **0.08**；HD 及以下 **0.05**。
  - **HDR 标准版定价（元/帧）**：8K 0.032667；4K 0.0093；2K 0.0047；HD 0.00217。
  - 官方计费示例（原文）：「SD（1280×720）→ HD（1920×1080），H.264，**25fps**，**200 分钟**，**超分标准版**：200 × 60 × 25 × **0.003255 元/帧 = 976.5 元**。」
  - 超分专业版说明（原文）：「通常是**包含超分、修复等综合能力**，应用在**影视后期制作**场景；超分这类服务需要**根据片源和预期效果进行算法定制调优**。」
  - **基于官方单价的换算（推算，非官方报价）** —— 超分标准版、输出 1080p：25fps → **约 4.88 元/分钟**；30fps → **约 5.86 元/分钟**；24fps → **约 4.69 元/分钟**。超分专业版 1080p 25fps → **约 75 元/分钟**。
  - 另需承担 **OSS 存储与流量费用**；音画增强表仅「以中国内地为例」。转码插件另计（元信息/水印 0.10 元/千次、截图 0.10 元/千张）。

### 4.3 视觉智能开放平台 VIAPI —— 文件级、支持 URL 直传、按分钟计费

平台入口：https://vision.aliyun.com/ （标题「通义实验室视觉智能开放平台」）。官方能力条目（抓取自 https://vision.aliyun.com/experience/detail?tagName=videoenhan&children=SuperResolveVideo ，页面日期未知）：

**「视频增强解决方案」官方描述原文**：「从视频分辨率、帧率、色彩等维度全面提升，实现视频的画质增强。」——关联能力：**视频综合增强 `EnhanceVideoQuality`**、**视频超分辨 `SuperResolveVideo`**、**视频人像增强 `EnhancePortraitVideo`**。

#### 4.3.1 视频超分辨 `SuperResolveVideo`

- 官方 API 文档：https://help.aliyun.com/document_detail/159118.html （标题「视频超分辨API参考与调用示例-视觉智能开放平台-阿里云」，「更新时间」字段为空）
- 功能（原文）：「视频超分辨能力可以将输入视频**放大 2 倍尺寸**输出，并基于细节推断增强输出视频画质，输出视频为 **h264 编码、MP4 格式**。」
- 应用场景（原文）：「旧视频翻新」「网络视频播放」。
- 特色优势（原文）：「基于深度学习算法，推理出的视频细节更真实。」「以原视频两倍尺寸输出。」
- **输入限制（官方原文，关键）**：
  - 视频格式：**MP4、AVI、MKV、MOV、FLV、TS、MPG、MXF**
  - 视频大小：**不超过 1 GB**
  - 视频分辨率：**大于 360×360 像素，小于 1920×1080 像素**
  - URL 地址中不能包含中文字符
  - → **支持 URL 直传**（`VideoUrl` 参数）；「推荐使用上海地域的 OSS 链接」
- **调用形态（官方原文，异步两步）**：「第一步调用 `SuperResolveVideo` 接口提交任务，请求成功后，得到一个任务 ID。第二步调用 **`GetAsyncJobResult`** 接口查询结果……当同一个任务还未处理完时，建议不要重复提交任务。」
- 请求参数：`Action`（必选，取值 `SuperResolveVideo`）、`VideoUrl`（必选）、`BitRate`（可选，单位 Mbps，**默认 10，取值范围 1~20**）
- Endpoint：`http(s)://videoenhan.cn-shanghai.aliyuncs.com/`
- 返回 `VideoUrl` 为**临时地址，有效期 30 分钟**（官方原文），需及时转存
- 接入前置（原文）：注册阿里云账号 → **开通「视频生产服务」** → 创建 AccessKey（子账号需 `AliyunVIAPIFullAccess`）→ SDK 调用；支持 Web 前端 / 小程序 / Android / iOS 直接调用
- ⚠️ **对 libtv 的关键限制**：输入须 **< 1920×1080** 且输出**仅 2 倍**。480p（如 854×480）→ 约 1708×960，**达不到标准 1080p**；若要 1080p 成片需配合其他放大步骤。

#### 4.3.2 视频综合增强 `EnhanceVideoQuality`

- 官方描述（原文）：「视频综合增强，可以对输入的 SDR 视频、基于 AI 深度学习算法，进行**插帧、超分辨率SR、SDR转HDR综合增强**处理。」（条目 `nlgcDesc`：「插帧、超分辨率综合增强」）
- 文档：https://help.aliyun.com/document_detail/193282.html
- 特色优势（原文）：真实细节/HDR 体验、**更流畅的画面**（「可推理出原视频帧间的动作变化，加入更多视频帧」）、**更高的分辨率**（「优化画面细节、纹理和锐度等，同时**抑制块噪声和压缩噪声**」）——**恰好覆盖 libtv 的去块/去噪诉求**
- 场景（原文）：高清视频播放系统、家庭视频增强

#### 4.3.3 视频插帧 `InterpolateVideoFrame`

- 官方描述（原文）：「视频插帧基于深度学习的**帧率上变换**，通过插帧网络合成任意时刻的视频帧，从而优化解决视频中卡顿、抖动等画质问题。」
- 文档：https://help.aliyun.com/document_detail/197027.html

#### 4.3.4 官方定价（https://help.aliyun.com/document_detail/202487.html ，标题「视频生产费用-视觉智能开放平台(VIAPI)-阿里云帮助中心」，页面日期未知）

**计费口径（三个能力通用，官方原文）**：「分辨率按照**输入**视频的分辨率，帧率按照**输出**视频的帧率，时长按照**输出**视频的时长进行计费，时长最小计量单位为秒，时长不足 1 秒按照 1 秒进行计费。」「该能力为异步能力，**调用失败不计费**，通过 RequestId 查询结果不计费。」

**按量付费（元/分钟）**：

| 能力 | 分辨率 ≤720P (≤30帧) | 720P<≤1440P (≤30帧) | 1440P<≤2160P (≤30帧) |
|---|---|---|---|
| **视频超分辨** `SuperResolveVideo` | **0.4** | **0.8** | **2.4** |
| **视频插帧** `InterpolateVideoFrame` | **3** | **6** | **18** |
| **视频综合增强** `EnhanceVideoQuality` | **4** | **8** | **24** |

（各能力完整三档帧率表：超分辨 0.4/0.8/1.6、0.8/1.6/3.2、2.4/4.8/9.6；插帧 3/6/12、6/12/24、18/36/72；综合增强 4/8/16、8/16/32、24/48/96）

**同页其它视频能力按量价**：视频校色 **0.4 元/分钟**、视频字幕擦除 **0.4 元/分钟**、视频画幅变换 **0.4 元/分钟**、视频标志擦除 **0.8 元/分钟**、通用视频生成 **0.8 元/分钟**。

**通用预付费资源包**（有效期 1 年，可叠加购买，耗尽后转按量）：视频超分辨 分辨率≤720P/≤30帧 → **40 点/分钟**（5,000 点 = 50 元 = 125 分钟，**2QPS**）。注意（原文）：「视频类通用预付费资源包**不可与图像类预付费资源包跨类目使用**」。

**对 libtv 的参考总价（推算）**：480p（854×480，属 ≤720P 档）→ 超分辨 **0.4 元/分钟**；若叠加插帧到 60fps → 插帧按**输出帧率** 30<≤60 档 = **6 元/分钟**；若用综合增强一次搞定超分+插帧+HDR → 输出 60fps、输入 ≤720P 档 = **8 元/分钟**。

### 4.4 Aliyun 三条路线小结

| 路线 | 开放 API | 接口名 | 调用形态 | 输入 | 单价 |
|---|---|---|---|---|---|
| 百炼 VideoRetalk | 是（但功能无关） | `videoretalk` | 异步（RPS=1，并发=1） | 人物视频 + 音频 | **0.08 元/秒**（≈4.8 元/分钟）；免费 1800 秒 |
| IMS 音画增强 | **是** | `SubmitMediaConvertJob` → `GetMediaConvertJob` / 回调 `MediaConvertComplete`；模板 `S00000004-401040`/`401070` | 异步 + 轮询/回调 | **须在 OSS**；输出固定 1080P/4K | 超分标准版 1080p **0.003255 元/帧**（≈4.88 元/分钟@25fps）；专业版 **0.05 元/帧** |
| VIAPI 视频增强 | **是** | `SuperResolveVideo` → `GetAsyncJobResult`；`EnhanceVideoQuality`；`InterpolateVideoFrame` | **异步 + 轮询**（`GetAsyncJobResult`） | **URL 直传**；≤1GB；格式 MP4/AVI/MKV/MOV/FLV/TS/MPG/MXF；输入须 >360×360 且 <1920×1080；输出**仅 2 倍** | 超分辨 ≤720P **0.4 元/分钟**；综合增强 ≤720P **4 元/分钟**；插帧 ≤720P **3 元/分钟** |

中国大陆节点：**三条路线均为境内**（示例 region `cn-shanghai`、华北2 北京）→ **无数据出境风险**。

---

## 5. 牛学长 / 牛小影（深圳牛学长科技有限公司，HitPaw 中文站）

**结论：API「有入口但未公开」——官方明确提供「视频分辨率提升API」与「私有化部署」，但接口路径、参数、单价全部需商务咨询，属未证实。**

- 官方页：https://www.niuxuezhang.cn/video-resolution-improvement-api.html （标题：**视频分辨率提升API合作页面_视频分辨率提升_视频分辨率提升api接口合作**，页面日期未知）
- 官方原文要点：
  - 「通过视频分辨率提升API，利用机器学习技术，**AI 智能将低画质的视频分辨率提升至 4K 或者 8K**。」「调用此 API，将技术集成到您的应用程序中，增强视频分辨率。」
  - 「智能超分辨率算法，可将**低清转高清、高清转 2K、4K，4K 转 8K**。」
  - 三种接入方式（原文）：**「API接口」**（「提供图像超分辨/超清晰化技术……**快速接入**」）、**「私有化部署」**（「企业部署指定服务器，所有数据本地化私有，安全放心」）、**「咨询服务」**。
  - 技术优势（原文）：视频超分技术、人脸细节高度还原、去除各类噪点、**高效 GPU 服务器计算**、多线程处理、完备的鉴权方案、多节点部署与备份。
  - 合作表单可勾选能力：**视频分辨率提升 / 视频变清晰 / 老照片修复 / 视频黑白上色 / 视频提亮 / AI 变声 / AI 抠图**。
  - 所有入口均为「**立即咨询**」与「**VIP接口申请合作**」表单（姓名/手机/邮箱/公司/官网/感兴趣API-SDK/验证码）。
- 官网同时链出在线工具入口 `https://nxy.hitpaw.cn/video/enhance-image-online/config`；主形态为桌面软件**牛小影（HitPaw Video Enhancer）**（官网自述「AI 智能将低画质的视频分辨率提升至 4K 或者 8K」「智能修复视频卡顿和抖动」）。
- 官网自述规模：8500 万+ 用户、1 亿+ 下载量（页面日期未知）——【官方宣传口径】。
- 公司实体：**深圳牛学长科技有限公司**，深圳市宝安区；备案 粤ICP备2024188267号；客服 400-128-2618。（页脚原文）

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分 API | **未证实**（官方宣称有「视频分辨率提升API」与私有化部署，但无任何公开接口文档） |
| 产品与接口名 | 产品名：**视频分辨率提升API**、**牛学长图片增强API**。**接口路径/参数/回调未公开 → 未证实** |
| 调用形态 | 未证实（宣称支持 API 接口接入） |
| 输入限制 | 未证实 |
| 计价方式与单价 | **未公开**（须填表咨询） |
| 开通前置 | **商务咨询 / VIP接口申请合作表单**；可选私有化部署 |
| 中国大陆节点 | 是（深圳，国内厂商） |
| 数据出境风险 | 无；私有化部署可完全本地化 |

---

## 6. 微帧科技 Visionular（补充候选）

**结论：有公开 REST API 文档，但只覆盖转码与直播；其 AI 超分/插帧产品（「帧彩视界」）为商务咨询制，未见公开超分 API 端点 → 未证实。**

- 产品页：https://visionular.com/ultrahd/ （标题：**AI 超高清处理引擎｜4K/8K 智能超分帧彩 HDR 画质增强 - 微帧 Visionular**，页面日期未知）
- 官方原文要点（AI超高清处理引擎「帧彩视界」）：
  - 四大方案：**超高清视频生产**（「分辨率上采样，将低分辨率转至高分辨率，4K 和 8K 超高清资源生产……提供传统算法和深度学习算法两种方案」）、**帧彩HDR处理**、**影片增强修复**、**直播实时增强**（「支持直播流实时超分、画质增强修复、HDR、色彩增强处理，直播延时可控制在 **1S 以内**」）。
  - **核心能力（原文）**：**智能超分辨率**、**画质修复**（「融合**去噪、锐化、增强、修复**等技术」）、帧彩HDR、智能色调映射、**ROI 区域增强**（「例如人脸肤色保护、物体增强、纹理增强」）、**智能插帧**（「高效提升视频帧率，实现**最高 120fps** 高刷帧率插帧」）。
  - **应用场景**：短视频增强、**短剧增强**（「统一并提升全片画质，进行**降噪、锐化和色彩风格化**处理」）、**经典老片增强**（「**去噪、去划痕、去抖动、色彩校正、分辨率提升（至4K/8K）**」）、体育赛事直播、卫星图像增强、监控画面增强。
  - 另有 **AIGC 平台**（https://visionular.com/AIGC.html ）与 **短剧场景**（https://visionular.com/shortdrama.html ）页。
- **公开 API 文档的边界（关键反证）**：https://docs.visionular.com/ 存在，但仅覆盖两款**转码/直播**产品：
  - **AuroraCloud VOD**（https://docs.visionular.com/auroracloud ）——官方原文：「an audio and video media processing service based on the intelligent encoding … provides … cloud service for **transcoding** media files」。功能列表为 Intelligent HD、Fast transcoding、Workflow、Adaptive multi-bitrate、Video watermark、Customized transcoding templates、Notifications、Thumbnails、HLS with AES-128 Encryption、DRM Packaging —— **无超分/插帧/画质修复**。
  - **AuroraLive**（https://docs.visionular.com/auroralive ）——直播（RTMP/RTMPS/SRT 入，HLS/LL-HLS/WebRTC 出，<5s 延时）。
  - 其 **API Reference** 页（https://docs.visionular.com/auroracloud/api ）正文为 JS 动态加载；抓取到的 HTML 中检索 `superres|super-resolution|upscal|enhance|denoise|interpolat` **命中数为 0**。
- 官网入口均为「**申请试用**」「**立即咨询**」，**无公开单价**。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧 API | **未证实**（超分/插帧能力官方有明确产品描述，但公开文档中无对应端点；转码/直播 API 确为公开 REST API） |
| 产品与接口名 | 产品：**AI超高清处理引擎「帧彩视界」**、**智能终端影像**、**Cloud云服务**。公开 API 仅见 **AuroraCloud VOD**、**AuroraLive**（端点路径未在抓取到的静态 HTML 中证实） |
| 调用形态 | 未证实（转码侧文档提及 Notifications/webhook 与任务式流程） |
| 输入限制 | 未证实 |
| 计价方式与单价 | **未公开**（申请试用/立即咨询） |
| 开通前置 | 商务咨询 / 申请试用 |
| 中国大陆节点 | 是（国内厂商） |
| 数据出境风险 | 无 |

---

## 7. 腾讯云媒体处理 MPS（含「漫剧场景」大模型增强）

**结论：是 —— 腾讯云 MPS 音视频增强提供对外开放、公开定价的文件级 API，并且官方预置模板中**直接存在「漫剧场景-大模型增强」**系列（与 libtv 场景完全对应）。**

### 7.1 官方能力与「漫剧场景」模板（本轮最贴合 libtv 的发现）

文档：https://cloud.tencent.com/document/product/862/118703 （标题「音视频增强接入-腾讯云」，「最近更新时间：**2026-09-30**」，「本文档已由 AI 辅助审校」）

- 功能概述（原文）：「音视频增强功能依托 MPS 业界领先的音视频 AI 处理模型和丰富的业务数据积累，提供专业级音视频增强解决方案。该功能支持分布式实时画质增强，包含**视频去毛刺、降噪、色彩增强、细节增强、人脸增强、SDR2HDR、大模型增强**等功能……广泛应用于 OTT、电商、赛事等场景。」
- 技术优势（原文）：「全场景 AI 增强算法：针对游戏、UGC 内容、PGC 高清影视、在线教育、秀场、电商、**老旧片源**等不同场景定制算法。」
- **预设增强模板 ID（官方表格原文）**：

| 预设模板 ID | 预设模板名称 | 说明 | 计费 |
|---|---|---|---|
| 327001 / 327003 / 327005 / 327007 | 真人场景-大模型增强-720P / 1080P / 2K / 4K | 大模型增强，适用真人场景 | 收取「大模型视频增强」+「极速高清转码」费用 |
| 327025 / 327026 / 327027 / 327028 | 真人场景-大模型增强-**小脸优化**-720P / 1080P / 2K / 4K | 针对远景小脸加强增强 | 同上 |
| **327002 / 327004 / 327006 / 327008** | **漫剧场景-大模型增强-720P / 1080P / 2K / 4K** | **大模型增强，适用漫剧场景** | 同上 |
| **327029 / 327030 / 327031 / 327032** | **漫剧场景-大模型增强-小脸优化-720P / 1080P / 2K / 4K** | **漫剧场景 + 远景小脸加强** | 同上 |
| 327021 / 327022 / 327023 / 327024 | 老片/低清场景-大模型修复-720P / 1080P / 2K / 4K-帧率随源 | 适用画质特别差损失严重的视频 | 收取「大模型视频修复」+「极速高清转码」费用 |

  - 官方提示（原文）：「为确保效果并避免因配置错误导致不合预期的结果，**建议优先使用预设模板**或直接联系我们进行优化配置。」

### 7.2 调用形态与输入（官方原文）

**调用 `ProcessMedia` API**，在 `MediaProcessTask -> TranscodeTaskSet -> Definition` 传入模板 ID。官方示例（节选）：
```json
{
  "InputInfo": { "Type": "URL", "UrlInputInfo": { "Url": "xxxxx" } },   // 输入支持 COS、URL 等来源
  "OutputStorage": { "Type": "COS", "CosOutputStorage": { "Bucket": "xxx", "Region": "xxx" } },
  "OutputDir": "/output/",
  "MediaProcessTask": {
    "TranscodeTaskSet": [ { "Definition": 327003, "OverrideParameter": { ... },
                            "OutputObjectPath": "{inputName}_transcode_{definition}.{format}" } ]
  },
  "TaskNotifyConfig": { "NotifyType": "URL", "NotifyUrl": "xxx" }        // 回调，可选
}
```
- **输入支持 URL 直传**（`"Type":"URL"`）或 COS；输出支持 COS / VODPro。
- **查询结果**：`DescribeTaskDetail`（传 TaskId）；或 `TaskNotifyConfig` + `ParseNotification` 解析事件通知。官方推荐用 **API Explorer** 在线调试。
- **第三种发起方式**：COS 上传文件后自动触发（离线编排），启用后 **3-5 分钟生效**。
- **接入前置（原文）**：腾讯云账号注册/登录、**开通 MPS 产品**、**完成服务角色授权**；子账号需有足够权限。
- 计费 FAQ（原文）：「音视频增强基于转码实现，因此发起一次音视频增强任务，将收取 **音视频增强 + 音视频转码两笔费用**。」
- 常见问题（原文）：增强模板支持选择**极速高清转码（推荐）**或普通转码，可配置码率/GOP 等。

### 7.3 官方定价（https://cloud.tencent.com/document/product/862/36180 ，标题「按量计费-腾讯云」，**最近更新时间：2026-09-24**）

计费单位：人民币，**元/分钟**；「按照**音视频增强后的时长**收费，根据不同分辨率、不同帧率进行收费」；「按计费周期累计总秒数后换算分钟，向上取整」。

**视频增强（官方表格原文）**：

| 增强类型 | 计费项名称 | 分辨率 | 帧率 ≤30帧 | ≤60帧 | ≤120帧 |
|---|---|---|---|---|---|
| 基础画质增强 | 去毛刺 | 高清 HD（短边≤720px） | 0.1 | 0.2 | 0.4 |
| | | 全高清 FHD（短边≤1080px） | 0.2 | 0.4 | 0.8 |
| | | 2K（短边≤1440px） | 0.4 | 0.7 | 1.4 |
| | | 4K（短边≤2160px） | 0.8 | 1.6 | 3.2 |
| | 综合增强 | 高清 HD（≤720px） | **0.8** | 1.6 | 3.2 |
| | | 全高清 FHD（≤1080px） | **1.8** | 3.6 | 7.2 |
| | | 2K / 4K / 8K | 3.2 / 7.2 / 28.8 | 6.4 / 14.4 / 57.6 | 12.8 / 28.8 / 115.2 |
| | **大模型视频增强** | 高清 HD（≤720px） | **1.3** | 2.5 | 5.2 |
| | | **全高清 FHD（≤1080px）** | **2.9** | 5.8 | 11.6 |
| | | 2K / 4K / 8K | 5.2 / 11.6 / 46.4 | 10.3 / 23.2 / 92.8 | 20.7 / 46.4 / 185.6 |
| | **大模型视频修复** | 高清 HD（≤720px） | **2.5** | 4.9 | 10 |
| | | **全高清 FHD（≤1080px）** | **5.6** | 11.2 | 22.4 |
| | | 2K / 4K / 8K | 10 / 22.4 / 89.6 | 19.9 / 44.8 / 179.2 | 39.9 / 89.6 / 358.4 |
| | **大模型视频增强-专业版** | 高清 HD（≤720px） | **5.5** | 10.7 | 22 |
| | | **全高清 FHD（≤1080px）** | **12.3** | 24.6 | 49.2 |
| | | 2K / 4K / 8K | 22 / 49.2 / 54.12 | 43.7 / 98.4 / 108.24 | 87.7 / 196.8 / 216.48 |
| 扩展增强能力 | SDR 2 HDR | — | **0.4** | | |
| | **插帧** | 高清 HD（≤720px） | **0.6** | 1.2 | 2.4 |
| | | 全高清 FHD（≤1080px） | **1.35** | 2.7 | 5.4 |
| | | 2K / 4K / 8K | 2.4 / 5.4 / 21.6 | 4.8 / 10.8 / 43.2 | 9.6 / 21.6 / 86.4 |
| | **超分** | 高清 HD（≤720px） | **0.3** | 0.5 | 1.1 |
| | | **全高清 FHD（≤1080px）** | **0.6** | 1.2 | 2.4 |
| | | 2K / 4K / 8K | 1.1 / 2.4 / 9.6 | 2.1 / 4.8 / 19.2 | 4.3 / 9.6 / 38.4 |
| | 降噪 | 高清 HD（≤720px） | 0.2 | 0.4 | 0.9 |
| | | 全高清 FHD（≤1080px） | 0.5 | 1.0 | 2.0 |
| | 色彩增强 | 高清 HD（≤720px） | 0.1 | 0.2 | 0.4 |
| | | 全高清 FHD（≤1080px） | 0.2 | 0.4 | 0.8 |

**转码单价（同页，中国大陆，元/分钟）** —— 增强任务须叠加一笔转码费：

| 转码类型 | H.264 SD(≤480px) | H.264 HD(≤720px) | H.264 FHD(≤1080px) | H.264 2K | H.264 4K |
|---|---|---|---|---|---|
| 普通转码 | 0.016 | 0.0325 | 0.063 | 0.136 | 0.278 |
| **极速高清转码**（推荐） | 0.066 | **0.099** | **0.195** | 0.42 | 0.84 |

**对 libtv 的组合成本（推算，非官方报价；按 480p 输入、24-30fps 输出计）**：
- **480p → 720p，用「漫剧场景-大模型增强-720P」(327002)**：大模型视频增强 HD ≤720px ≤30帧 **1.3** + 极速高清转码 HD **0.099** ≈ **约 1.40 元/分钟**
- **480p → 1080p，用「漫剧场景-大模型增强-1080P」(327004)**：大模型视频增强 FHD ≤1080px ≤30帧 **2.9** + 极速高清转码 FHD **0.195** ≈ **约 3.10 元/分钟**
- **老片/低清（画质差）用「大模型修复」(327022)**：修复 FHD **5.6** + 转码 **0.195** ≈ **约 5.80 元/分钟**
- **若只要超分不要大模型**：「超分」FHD（≤1080px）**0.6** + 极速高清 **0.195** ≈ **约 0.80 元/分钟**
- **叠加插帧到 60fps**：「插帧」FHD 30<≤60帧 = **2.7 元/分钟**（额外）
- 计费周期：**日结（默认）**，后付费，不足一分钟按一分钟计（按日累计总秒数换算分钟、向上取整）；可改月结（联系商务）

### 7.4 MPS 增强能力清单与「短剧」场景预设

文档：https://cloud.tencent.com/document/product/862/77171 （「音视频增强模板」，「最近更新时间：**2026-07-31 18:13:34**」）

**基础画质增强（四选一，画质提升排序：大模型修复 > 大模型增强 > 综合增强 > 去毛刺增强）**：

| 配置项 | 官方描述（节选） | 计费 |
|---|---|---|
| **大模型修复** | 「基于 **Diffusion 大模型**的修复能力，**内置超分辨率**，针对**老片/低清素材修复效果最佳**」 | 转码费 + 「大模型视频修复」费 |
| **大模型增强** | 「基于 Diffusion 大模型，利用其强大的 AI 生成能力，显著提升视频画质修复效果，效果远超常规方法」 | 转码费 + 「大模型增强」费 |
| **综合增强** | 「在**去除压缩伪影和毛刺**的同时增强关键细节」 | 转码费 + 「综合增强」费 |
| **去毛刺增强** | 「通过分析编码信息，智能去除伪影，**修复画面毛刺、模糊或颜色不自然问题**」 | 转码费 + 「去毛刺」费 |

**扩展增强能力**：**智能插帧**（「若设置的插帧帧率比源文件帧率高，将通过分析相邻帧之间的运动，**智能生成中间帧**」；**插帧帧率限制在 [1, 120]**）、**超分辨率**（「识别视频的内容与轮廓，高清重建视频的细节与局部特征」；支持**低清晰度模型 / 高清晰度模型（默认）**）、**HDR**（支持 **HDR10、HLG**；**仅 H.264/H.265 可开启**）、**低光照增强**、**色彩增强**、**视频降噪**、**去划痕**（「修复视频中的划痕和雪花点等被破坏的内容」）、人脸增强、字体增强（**字体增强自 2025 年 12 月起下线**，能力已整合至综合增强/大模型视频增强）。

> ⭐ **「视频场景」是官方一等配置项**（原文）：「我们为 **AIGC、短剧、短视频、游戏视频、高清影视剧**等场景预设了推荐参数。点击不同场景，MPS 将为您自动配置增强能力，并调整底层处理模型。」→ **「短剧」场景已被官方内置，对本项目直接可用。**
> 官方警告（原文）：「**请勿开启所有功能或叠加视频实际不需要的能力，以免产生负面影响**」（增强能力会互相干扰）。

**⚠️ 两处「未证实 / 未完全证实」，如实标注**：
1. 该页 `CreateTranscodeTemplate` 示例在 `"En…` 处被抓取截断，**增强参数在 `VideoTemplate` 内的确切 JSON 字段名（超分/插帧/大模型修复的字段键名）未抓全 → 未证实**。完整 API 文档疑在 `https://cloud.tencent.com/document/api/862/37605`（本次未抓正文）。
   → **绕开方式**：先用**控制台**创建增强模板拿到 **TemplateId**，再用 `ProcessMedia` 按 `Definition` 传模板 ID 提交任务 —— 该路径不依赖未知字段名。
2. **转码单价另见 7.3**（MPS 增强须叠加一笔转码费）。

**⚠️ MPS 图片超分务必区分（元/张，非视频）**：同页图片处理章节的「超分辨率 / 图像超分」= 720P **0.02**、1080P **0.04**、2K 0.08、4K 0.16、8K 0.32 **元/张**；「画质增强&超分」（综合增强/低光照/色彩/智能降噪/美颜滤镜）与之同价。页内说明：「画质增强、超分、智能编辑功能均基于**图像压缩**能力实现。发起上述任一功能任务时，将同时收取「任务费用」与「图像压缩费用」两笔费用」。**不要与「视频超分 0.6 元/分钟（1080p/≤30帧）」混淆。**

**对本项目的直算（MPS，中国大陆，H.264 输出 1080p/30fps）**：
- 「超分」0.6 + 普通转码 FHD 0.063 ≈ **0.663 元/分钟**
- 「综合增强」1.8 + 转码 0.063 ≈ **1.863 元/分钟**（去压缩伪影，性价比之选）
- 「大模型视频修复」5.6 + 转码 0.063 ≈ **5.663 元/分钟**（老片/低清质感最好，**托管方案中画质上限最高**）
- 补帧到 60fps：再加「插帧」**2.7**（FHD/≤60帧档；档位按**输出**帧率判定）

### 7.5 企业版 MPSE（私有化）

- 产品页：https://cloud.tencent.com/product/mpse （标题「媒体处理企业版_媒体处理_专有云_私有化_视频处理_视频AI」）
- 官方原文：**「媒体处理企业版（Media Processing Service for Enterprises，MPSE）是一款针对企业级在线、离线视频提供媒体处理服务的产品，支持专有云方式灵活部署」**；「支持SDK集成、平台直接使用、**API调用**等多种使用方式，支持**专有云、公有云**等部署方式」；「支持实时直播流及离线文件高清低码、**音画增强**、截图、内容理解等媒体处理能力。开放模板能力，支持用户自定义。」
- 场景与案例（原文）：广电行业；客户案例含**央视网**（8K 超高清直播频道实时转码）、**虎牙**（「对视频进行增强处理，自动检测并修复视频中的噪点、抖动和模糊等问题」）、**斗鱼**（色彩增强）。
- **流程（原文）**：`1 提交接入申请（工单）→ 2 业务需求评估 → 3 个性化解决方案（含报价）→ 4 产品交付` → **报价为定制、不公开；走商务/私有化**。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **是**（MPS 音视频增强，公开文档 + 公开定价 + 预置模板 ID；**含「漫剧场景」模板**） |
| 产品与接口名 | 产品：**媒体处理 MPS · 音视频增强**。接口：**`ProcessMedia`**（提交，`MediaProcessTask.TranscodeTaskSet[].Definition` 传模板 ID）、**`DescribeTaskDetail`**（查询）、`ParseNotification`（回调解析）；模板：**327002/327004/327006/327008（漫剧·大模型增强）**、327029-327032（漫剧·小脸优化）、327021-327024（老片·大模型修复）、327001/327003/327005/327007（真人） |
| 调用形态 | **异步 + 轮询或回调**（`TaskNotifyConfig`）；另有 COS 上传自动触发（离线编排，3-5 分钟生效） |
| 输入限制 | **支持 URL 直传**（`InputInfo.Type=URL`）或 COS；输出为 COS/VODPro；模板可覆盖 Container/音视频参数；**时长/大小上限未证实** |
| 计价 | **按增强后时长、元/分钟**：大模型视频增强 FHD ≤1080px ≤30帧 **2.9**、720px **1.3**；大模型视频修复 FHD **5.6**；专业版 FHD **12.3**；超分 FHD **0.6**；插帧 FHD(30-60帧) **2.7**；降噪 FHD 0.5；去毛刺 FHD 0.2。**须另加一笔转码费**（极速高清 H.264 FHD 0.195 / HD 0.099）。失败不计费 |
| 开通前置 | 注册腾讯云 + **开通 MPS** + 完成服务角色授权（**无需商务签约**）；企业版 MPSE 需工单+商务报价 |
| 中国大陆节点 | **是** |
| 数据出境风险 | 无（境内） |

---

## 7.5 RunningHub（国内 AI API 聚合平台，含 Topaz / 火山画质增强）

**结论：是 —— 境内平台，标准 REST API，官方文档给出完整的「视频超分」「视频帧率增强（补帧）」接口与参数，且同时转售 Topaz 视频增强系列与火山引擎画质增强；单模型具体单价需在平台「价格」页交互查看，静态抓取未证实。**

- 平台：https://www.runninghub.cn/call-api （标题「RunningHub AI API｜全模态模型API与AI应用开发平台」，页面日期未知）
- 规模（官方原文）：**「视频 生成与处理 API 322 模型」「图像 生成与处理 API 189 模型」「音频 47」「3D 16」**，**「单一接口直连 400+ 主流大模型」**；能力含「**工作流托管** —— ComfyUI 工作流免运维托管，支持通过标准接口直接调用」与「**弹性按需计费** —— 消除服务器闲置成本，采用按需弹性计量，仅为实际调用付费」。

### 7.5.1 已确证的视频超分/补帧/增强接口（含端点路径）

来源：官方 API 文档站 https://www.runninghub.cn/runninghub-api-doc-cn （页面日期未知）。以下**模型 ID 与端点路径均为文档内嵌数据原文**（共解析出 **363 个 API 条目**）：

| 模型 ID | 名称 | 端点路径 |
|---|---|---|
| **448183177** | **RH视频超分** | **`/openapi/v2/rhart-video/video-upscaler`** |
| **448183176** | **RH视频帧率增强**（补帧） | **`/openapi/v2/rhart-video/video-fps-increaser`** |
| 521039271 | RH Upscale | `/openapi/v2/rhart-video/rh-upscale/enhance-frame` |
| 498749510 | FLUX 3 Video 草稿增强 | `/openapi/v2/rhart-video-flux3/draft-enhance` |
| **516250202** | **DetailX/视频超分补帧** | **`/openapi/v2/arklin/video-super-resolution`** |
| **495680115** | **topazlabs视频增强Proteus** | **`/openapi/v2/topazlabs/video-proteus`** |
| **495680114** | **topazlabs视频增强Starlight** | **`/openapi/v2/topazlabs/video-starlight`** |
| **495680112** | **topazlabs视频放大Astra** | **`/openapi/v2/topazlabs/video-astra`** |
| **495680113** | **topazlabs视频降噪Denoise** | **`/openapi/v2/topazlabs/video-denoise`** |
| **495680116** | **topazlabs视频补帧Frame Interpolation** | **`/openapi/v2/topazlabs/video-frame-interpolation`** |
| 495680107 / 108 / 109 / 110 / 111 | topazlabs图像放大 High Fidelity v2 / Art and CGI / **High Fidelity V3** / Low Resolution v2 / Standard v2 | `/openapi/v2/topazlabs/image-gigapixel-*`、`/openapi/v2/topazlabs/image-upscale-high-fidelity-v3`（**图片**） |
| **516012532** | **火山画质增强-极速版** | **`/openapi/v2/volc-enhance-fast/video`** |
| **516012533** | **火山画质增强-标准专业版** | **`/openapi/v2/volc-enhance/video`** |
| **516012534** | **火山画质增强-大模型版** | **`/openapi/v2/volc-enhance-generative/video`** |
| 517147132 | 即梦智能超清 | `/openapi/v2/bytedance/jimeng-seed3-tilesr/image-upscale`（**图片**） |

> ⚠️ **重要含义**：**Topaz 的视频超分/补帧/降噪模型，可以通过这家境内平台以 `/openapi/v2/topazlabs/video-*` 端点调用** —— 对「想用 Topaz 效果但又担心数据出境/海外账号」的场景，这是唯一被我抓到的**境内合规替代路径**。（该路径的**数据留存与合规条款、以及是否真在境内推理，官方文档未说明 → 未证实**，必须商务确认。）

### 7.5.2 `RH视频超分` 官方接口详情（最贴合 libtv）

官方文档页：https://www.runninghub.cn/runninghub-api-doc-cn/api-448183177 （页面日期未知）

- **官方功能描述（原文）**：「全球先进的 **AI 视频超分模型**，支持将低清视频**无损放大至 720p、1080p、2K 及 4K** 画质。模型具备卓越的**帧间一致性**，能有效消除**画面闪烁与伪影**，精准还原**发丝、织物**等复杂纹理；同时搭载**运动感知增强技术**，确保动态场景流畅自然。**单次接口调用最高支持 10 分钟长视频处理。**」
  - → 「帧间一致性 + 消除闪烁/伪影」正是 **AI 生成视频（漫剧/短剧）超分最关键的痛点**，且 **单次 10 分钟**覆盖整集。
- **请求**：`POST https://www.runninghub.cn/openapi/v2/rhart-video/video-upscaler`，Header `Authorization: Bearer [Your API KEY]`、`Content-Type: application/json`
- **Body 参数（官方示例原文）**：
```json
{ "videoUrl": "https://...mp4", "targetResolution": "1080p" }
```
- **调用形态：异步 + 轮询**。提交返回 `{"taskId":"2013508786110730241","status":"RUNNING",...}`；**任务结果查询接口 `/openapi/v2/query`**。
- **单价：未证实** —— 平台按模型展示 ￥ 计价（`call-api` 页可读到 `￥0.07/千 tokens`、`￥0.3/张`、`￥0.5/秒` 等其它模型价），但**该接口的价格在其交互式「价格」标签页内异步加载，静态抓取未取到**。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧 API | **是**（官方文档给出端点与参数；含 Topaz / 火山 画质增强的境内端点） |
| 产品与接口名 | `RH视频超分` `POST /openapi/v2/rhart-video/video-upscaler`；`RH视频帧率增强` `POST /openapi/v2/rhart-video/video-fps-increaser`；查询 `/openapi/v2/query` |
| 调用形态 | **异步 + 轮询**（taskId → `/openapi/v2/query`） |
| 输入限制 | `videoUrl`（**URL 直传**）+ `targetResolution`（官方示例 `1080p`；可选值枚举**未证实**）；**单次最高 10 分钟** |
| 计价方式与单价 | 平台为**按量弹性计费**（元）；**本接口具体单价未证实**（价格标签页异步加载） |
| 开通前置 | 注册 + 获取 API Key（`Authorization: Bearer`）；页脚有「获取密钥 / 联系销售」入口；**企业认证要求未证实** |
| 中国大陆节点 | **是**（域名 `www.runninghub.cn`，国内平台） |
| 数据出境风险 | **未证实** —— 平台为境内主体，但 Topaz 模型是否在境内推理、生成媒体留存策略**官方文档未说明**，需商务确认 |

---

## 8. 影谱科技 Moviebook

**结论：未证实 —— 官网/文档站全部不可访问，无任何可查的官方来源。**

### 8.1 域名与站点实测（本机时钟 2026-10-04，大陆·杭州联通网络视角）

| 域名 | DNS | HTTP 实测 | 结论 |
|---|---|---|---|
| `moviebook.cn` / `www.moviebook.cn` / `ai.moviebook.cn` | **SERVFAIL（不解析）** | 无法连接 | 官网域名当前**无解析记录** |
| `moviebook.com` / `www.moviebook.com` / `ai.moviebook.com` | 151.245.195.209 | **HTTP 403 Forbidden**（33 字节，无内容） | 无可用内容 |
| `moviebook.com.cn` / `www.moviebook.com.cn` | 38.181.19.158 | HTTP 200，但页面是「桑拿网\|品茶工作室…」 | **域名已被他人占用，与影谱无关** |
| `moviebook.ai` | 52.60.87.163 | HTTP 200，标题 `Future home of moviebook.ai` | **停放页（parked）** |
| `www.moviebook.tv`（历史官网，见二手档案） | 23.234.15.197 | HTTP 403 + 一段 JS 跳转，无可读内容 | 已废弃 |

- `whois moviebook.cn`：`status: ACTIVE`，Sponsoring Registrar **GoDaddy.com,LLC**，Expiration Time **2027-11-13** → 域名**仍在注册有效期内，但无解析、站点下线**。
- **开放 API 核实结论：未证实。** 检索不到任何影谱科技的「开放平台 / API 文档 / 定价页 / 开发者中心」页面。**没有官方来源可依据，因此不做任何接口名、参数的推测。**

### 8.2 公开可见的业务形态（均为二手来源，**可信度低**）

- 投资界项目档案：领域「影视视频」，官网 `www.moviebook.tv/?p=index`，所属公司「北京影谱互动传媒科技有限公司」—— https://newseed.pedaily.cn/data/project/54786 （页面日期未知）
- 「影谱科技中标联通在线 AI 视频项目」—— http://finance.sina.com.cn/stock/relnews/hk/2021-02-20/doc-ikftpnny8611843.shtml （**2021-02-20**）→ 项目制/客户定制交付，**未见 API 化销售**
- 影谱科技曾推「Moviebook SAiDT」赛事内容生成方案、「影宙」元宇宙活动平台等 → 均为**项目/私有化**形态（多篇 2022 年前后媒体报道，页面日期未知）
- 360 百科：北京影谱科技股份有限公司（Moviebook），成立于 2009 年，「致力于智能影像生产领域的视觉技术企业」—— https://baike.so.com/doc/26433065-31655036.html （页面日期未知）
- 「影谱科技发布 **Video AI 生产引擎**」—— https://www.toutiao.com/article/6647713943445832206/ （**2019-01-18**）
- 「外媒：影谱科技发布 **Video AI 平台**」—— https://baijiahao.baidu.com/s?id=1622706833140693780
- https://www.36kr.com/p/1723680735233
- **上述资料描述的是视频自动化生产/智能影像生产平台（内容生成与植入方向），没有任何材料表明其对外开放「视频超分/修复/插帧」API。**

> ⚠️ **重要同名区分（易踩坑）**：`filmspectrum.com`「影谱 \| 汉语电影AI辅助创作平台」的页面 JSON-LD 明确写 **`"legalName": "西安电影制片厂"`**、`"description": "影谱是由西影自主研发的汉语电影AI辅助创作平台"` —— 这是**西影（西安电影制片厂）**的产品，**不是**影谱科技（Moviebook，北京影谱）。该站是**剧本创作 AI（编剧助手）**，**无任何视频超分能力**，也无 API 文档。来源：https://filmspectrum.com/ （页面日期未知）

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **未证实**（无官方来源可得） |
| 产品与接口名 | **未证实** |
| 调用形态 / 输入限制 / 计价 / 开通前置 | **均未证实**（历史业务形态为项目制/私有化，来源为二手） |
| 中国大陆节点 | 不适用（**无可用服务入口**） |
| 数据出境风险 | 不适用 |

---

## 9. 万兴科技 Wondershare / Media.io

**结论：万兴确实有一个真正对外开放的 API 平台「天幕多媒体创作引擎 API」，但其超分/清晰化能力全部是「图片」级，视频类只有生成/换脸/去水印 —— 文件级「视频」超分/插帧/修复 API = 否。**

> 一句话区分：**有图，无影** —— 天幕有 `2倍图像超分`，但**没有任何视频超分/插帧/修复**接口。

### 9.1 万兴天幕多媒体创作引擎 API（官方开放平台）

- 文档站：https://ailab.wondershare.cn/doc/ （标题「天幕多媒体创作引擎API文档」）；接入文档「获取请求凭证」https://ailab.wondershare.cn/doc/start/GetAPIKEY.html （**页面最后更新时间 4/23/2024**）
- **API 基础路径（官方明文）**：**`https://wsai-api.wondershare.cn`**
- **认证（官方明文）**：Header `Authorization: Basic xxxxxxxxx`，值为 **`base64(appkey:appsecret)`**；`Content-Type: application/json`
- **开通流程（官方明文）**：注册/登录账号 → 「应用管理」创建应用 → 自动生成 **APPKEY 与 APPSecret** → 即可调用。**文档未要求企业认证或商务签约（自助开通）**
- **调用形态：全部「异步任务 + 轮询」** —— 创建 `POST /v3/pic/xxx/batch` → 返回 `data.task_id`；取结果 `GET /v3/pic/xxx/result/{task_id}`，轮询 `status`（各接口状态码定义 1–8，含「余额不足」），并返回 `wait_time`（建议下次请求前等待秒数）与 `result`（结果 URL）

**已核实的算法清单与准确接口路径（均为官方文档页）**：

| 类别 | 算法 | 创建（POST） | 取结果（GET） | 文档页更新时间 |
|---|---|---|---|---|
| 图像质量提升 | **2倍图像超分** | **`/v3/pic/fsr/batch`** | `/v3/pic/fsr/result/{task_id}` | 4/23/2024 |
| 图像质量提升 | 图像清晰化 | `/v3/pic/epe/batch` | `/v3/pic/epe/result/{tasi_id}` ⚠️文档原样拼写 `tasi_id`，疑为官方笔误 | 4/23/2024 |
| 图像质量提升 | 人脸清晰化 | `/v3/pic/det/batch` | `/v3/pic/det/result/{task_id}` | 4/23/2024 |
| 图像生成 | AI绘画 / 神奇涂抹 / 年龄变换 | `/v3/pic/aigc-novel/batch` 等 | `/v3/pic/aigc-novel/result` 等 | 4/23/2024 / 未知 |
| 智能抠图 | 前景分割 | 见文档页 | 见文档页 | 未知 |
| 音频 | 音频转场 / AI语音增强 / 语音降噪 | 见文档页 | 见文档页 | 未知 |
| **大模型/视频** | **文生视频** | **`/v3/pic/t2v/batch`** | `/v3/pic/t2v/result/{task_id}` | 7/27/2024 |
| **大模型/视频** | **视频换脸** | **`/v3/pic/vfs/batch`** | `/v3/pic/vfs/result/{task_id}` | 7/23/2024 |
| **大模型/视频** | **视频去水印** | **`/v3/pic/vrw/batch`** | `/v3/pic/vrw/result/{task_id}` | 7/23/2024 |
| **大模型/视频** | **数字人** | **`/v3/pic/virtual_human/batch`** | `/v3/pic/virtual_human/result/{task_id}/{task_id}` ⚠️task_id 重复写两次，疑为官方笔误 | 7/24/2024 |

> **核实方式与置信度**：文档站侧边栏为折叠渲染，且其 JS bundle 被服务端错误地返回主站 HTML（无法读取侧边栏配置），故通过对官方文档 URL 逐一探测（**700+ 候选路径**，命中即校验 `<title>` 含「API接入」）得到上表。**上表为「已确认存在」，不代表官方能力清单的全部**；另经 **90 个「视频超分/增强/插帧/修复/降噪/防抖」类关键词探测 → 0 命中**。

**输入限制（官方文档明文）**：
- **图像**（AI绘画/人脸清晰化/图像清晰化/2倍图像超分）：格式 **PNG/JPG/JPEG/BMP**；体积 **≤50 MB**；分辨率 **>256×256 且 <5000×5000**（2倍图像超分文档写作「小于 4k」）；**纵横比 ≤4:1**；单次 **最多 20 张**
- **URL 直传：支持**（官方原话）—— `images` = 「待处理图片，最多20张（**oss uri, 可下载文件链接地址**）」；视频去水印 `file_link` = 「待去水印的视频**可下载地址**」；数字人 `audio_url` = 「语音链接, 传入**可下载链接**」
- **视频**：FAQ 原文「支持的视频格式包括：mov、mp4、avi、m4v和其他主流视频格式」；**未发现官方公开的视频时长/分辨率/体积上限说明**。文生视频 `duration` = 「生成的视频时长 **5~60s**」；数字人输入音频 **mp3，不超过 10s**

**计价**：官方 FAQ（https://ailab.wondershare.cn/doc/guide/Question.html ，**页面最后更新 6/27/2025**）原文：「目前API调用服务是需要付费的，您可以在【购买页】进行购买」；错误码含 **`490027: 余额不足错误`** → **预充值/余额扣费**模式。**单价未证实** —— 购买页在登录后控制台内，公开站点 `/price`、`/pricing`、`/buy`、`/console`、`/api` **均 404**。

**大陆节点与数据出境**：**支持大陆节点** —— API 域名 `wsai-api.wondershare.cn`；官网页脚备案 湘ICP备2020020133号-9；官方文档示例中上传/回调文件使用**深圳 OSS**（`https://ailab-storage-alisz.oss-cn-shenzhen.aliyuncs.com/...`）→ **数据出境风险低**。

### 9.2 Media.io —— 未证实（且大陆不可直连）

- **大陆可达性实测（本环境）**：`media.io` → `210.209.84.142`（直连 80/443 **超时**）；`www.media.io` → `31.13.95.48`（**Meta 网段**）、`api.media.io` → `208.43.170.231`、`docs.media.io` → `104.244.43.231`、`help.media.io` → `108.160.172.208` —— 这些是**典型的 DNS 污染 IP 段**（Meta/Twitter/Dropbox 等）。→ **从中国大陆网络完全无法抓取 media.io 任何页面**（含 `/video-enhancer.html`、`/video-upscaler.html`）。
- 官方（wondershare.com，可访问）对 Media.io 的定位：产品导航写「Media.io — **AI Video, Image, Music Generator**」；站内注释文案 `modalText: "All-in-One AI Creation Studio"`、`modalContentList: ['Create videos, images, music with AI','Use Sora 2, Veo 3, Kling & Nano Banana','5,000+ trending AI effects and filters']` → **形态为网页端创作工具**，而非对外 API 服务。
- **是否有官方 REST API：未证实**。依据：① media.io 及 `api./docs./help.` 子域在大陆全部不可达；② wondershare.com 全站**无 Media.io 的 API/开发者文档入口**（`/api/`、`/developer/`、`/enterprise/` 均 404）；③ 百度索引检索「media.io API/开发者/接口文档」**无任何官方 API 文档结果**。→ **不能**仅凭「有在线 video enhancer 工具」就推断可 API 化。
- **数据出境风险：高** —— 即使有 API，从中国大陆也无法直连，**不适合作为大陆节点调用**。

### 9.3 Filmora / 万兴喵影（含 Virbo）—— 否

- **AI 视频增强确实存在，但是桌面客户端功能**。官方页 https://filmora.wondershare.com/ai-video-enhancer.html （标题「AI Video Enhancer - Upscale & Improve Video Quality to 4K」，页面日期未知）：
  - 能力：**Upscale 最高 4K**、Generative 细节重建、夜景模式、去噪、压缩伪影修复；AI 模型 `Enhance`、`Generative Enhance`、`Bright Night View`、`Dark Night View`、**`Topaz Starlight`**（集成的生成式超分模型）
  - **官方 FAQ 原文**：「Enhance: **No time limit** for local processing; supports videos up to **4K**」；「Generative Enhance / Bright Night View / Dark Night View: **Up to 3 minutes**; supports videos up to 4K」
  - **官方 FAQ 原文**：「If your computer has an **NVIDIA RTX 30 series GPU or higher** with compatible drivers, Filmora can run the Enhance model **locally with no AI credits required**. If local AI processing isn't supported on your device, Filmora will **use cloud-based enhancement instead**, subject to the time, resolution, and **AI credit** limits of the selected model.」→ 即**有云侧算力，但只服务自家客户端**，**不是**对外 API
- **没有对外 API/SDK（实测 404）**：`www.wondershare.com/api/`、`/developer/`、`/enterprise/` 均 404；`virbo.wondershare.com/api/`、`/sdk/`、`/business/api.html`、`/enterprise/` 均 404 或连接失败。企业版页 https://www.wondershare.com/business/enterprise.html 仅提供「Request a Demo / Buy Now」表单，文案含「Built for any team, cloud or on-premise」，**全文无 API 字样**。
- → **结论：否**。做 480p→1080p 成片清晰化**不能**通过 Filmora 的 API 实现。

### 9.4 万兴小结

| 项目 | 结论 |
|---|---|
| 对外开放**文件级视频**超分/插帧/修复 API | **否**（视频类只有文生视频/换脸/去水印/数字人；**无视频超分/插帧/修复**） |
| 对外开放**图片**超分 API | **是** —— `2倍图像超分` `/v3/pic/fsr/batch`、`图像清晰化` `/v3/pic/epe/batch`、`人脸清晰化` `/v3/pic/det/batch`（base `https://wsai-api.wondershare.cn`） |
| 调用形态 | **异步 + 轮询**（`task_id` → `result`） |
| 输入限制（图片） | ≤50MB；>256×256；<4K/5000px；纵横比 ≤4:1；单次 ≤20 张；**支持可下载 URL 直传** |
| 计价 | 付费，**单价未公开（未证实）**；余额制（错误码 490027） |
| 开通前置 | 注册 + 创建应用取 APPKEY，**自助开通**（无企业认证要求） |
| 中国大陆节点 | **是**（.cn 域名 + 深圳 OSS） |
| 数据出境风险 | 低 |

> **对 libtv 的用途**：若只需「封面图/关键帧图片清晰化」，`/v3/pic/fsr/batch` 是可用候选；**成片视频清晰化不适用**。

---

## 10. 出门问问 / 深言科技

### 10.1 出门问问 Mobvoi —— 否 / 未证实

- 开放平台：**序列猴子开放平台** `https://openapi.mobvoi.com/` （Vue SPA）。`robots.txt` 指向 `https://www.dupdub.com/sitemap.xml` → 与「魔音工坊 dupdub」同源。
- 架构链路：`openapi.mobvoi.com` → `prd-tc-cn-nj-entrance.mobvoi.com` → `clb.nj-tencentclb.cloud`（**腾讯云南京 CLB → 中国大陆节点**）
- **从官方前端 bundle 提取的能力清单**（`https://tc-nj-backend-ms-pub-cdn.mobvoi.com/open-api-platform-prd/js/2026-09-15-03-07-07/index.22c3826a11fac5c8.js`，构建目录时间 **2026-09-15**）：
  - 路由（节选）：`/llm`、`/largemodel-introduce`、`/image-introduce`、**`/video-introduce`（视频合成）**、**`/faceclone`、`/faceclone-introduce`**、**`/digtalHuman`**、**`/realtime-digital-man`**、`/speech-synthesis-online`、`/speech-recognition`、`/voiceclone`、`/billManagement`、`/usage`
  - 官方文案：「一站式API，包含**语音合成、视频合成**等」「…语音理解、语音识别、语音合成、**3D人脸识别、人脸视频合成、肢体动作合成、语音驱动口唇**等多项核心…」
  - 形象克隆素材要求字段：`videoClips`、`greenScreenVideo`、`videoTalking`、`resolutionRatio`、`frameRate`、`dataFps`、`durationVal`
- **⚠️ 关键反证**：「**超分 / 画质 / 画质增强 / 修复 / 插帧**」在 `index.*.js` 与 `chunk-vendors.*.js` **全文检索 0 命中**（仅命中「分辨率/时长/帧率」等素材要求字段）。
- 价格（bundle 内官方文案）：「1.克隆声音的API调用价格为 **100元/100w字符**」；另出现「999元」套餐类文案。⚠️ **这是声音克隆相关价格，与视频增强无关**；文档正文需登录，**接口路径与各能力单价未证实**。
- **结论：否 / 未证实** —— 视频相关能力是**「数字人视频合成」「人脸克隆」**（生成类），**不是**修复/超分类。

### 10.2 深言科技 DeepLang —— 否

- 官网 https://www.deeplang.ai/ （页脚 ©2025，页面日期未知）：导航仅「首页/关于我们/我们的产品/核心优势/发展历程/获得荣誉/创始人介绍/加入我们」→ **无「开放平台 / API / 开发者」入口**。
- 产品只有两个，**均为文本类**：**语鲸**（信息获取助手，https://lingowhale.com ）、**深言达意**（找词找句的智能写作工具，https://www.shenyandayi.com ）。
- 定位原文：「旨在打造基于大规模预训练模型的新一代**智能文本信息处理**引擎，涵盖AIGC文本生成、信息抽取聚合、语义检索等功能」；商务邮箱 `bd@deeplang.ai`。
- **结论：无任何视频/图像超分、修复、插帧能力与对外 API（否）。**

| 项目 | 出门问问 Mobvoi | 深言科技 DeepLang |
|---|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **否 / 未证实** | **否** |
| 产品与接口名 | 开放平台 `openapi.mobvoi.com`（视频合成/数字人/人脸克隆；**接口路径未证实**） | 无开放平台（仅文本产品：语鲸、深言达意） |
| 调用形态 | 未证实 | — |
| 输入限制 | 未证实 | — |
| 计价 | 仅见「克隆声音 API 100元/100w字符」（**与本需求无关**） | — |
| 开通前置 | 未证实（文档需登录） | — |
| 中国大陆节点 | **是**（腾讯云南京 CLB） | 不适用 |
| 数据出境风险 | 低 | — |

**A 组失败/受限 URL 要点**：`moviebook.cn`/`www.moviebook.cn`/`ai.moviebook.cn` **SERVFAIL**；`ai.mobvoi.com`、`mediaio.io` **NXDOMAIN**；`media.io` 全系**不可直连**（DNS 污染 + 超时）；`www.moviebook.com`、`ai.moviebook.com`、`www.moviebook.tv` **403**；`moviebook.ai` **停放页**；`moviebook.com.cn` **已被「桑拿网」占用**；`ailab.wondershare.cn/doc/assets/js/*.js` **被服务端返回主站 HTML**；`openapi.mobvoi.com/document` SPA + 需登录；**百度主站触发「百度安全验证」，改用 `m.baidu.com/s?word=` 可用**；搜狗验证码拦截。

> ⚠️ **重要同名区分（易踩坑）**：`filmspectrum.com`「影谱 | 汉语电影AI辅助创作平台」的页面 JSON-LD 明确写 `"legalName": "西安电影制片厂"`、`"description": "影谱是由西影自主研发的汉语电影AI辅助创作平台"` —— 这是**西影（西安电影制片厂）**的产品，**不是**影谱科技（Moviebook，北京影谱）。该站是剧本创作 AI（编剧助手），**无任何视频超分能力**，也无 API 文档。

## 11. 相芯科技 FaceUnity

**结论：否（未发现任何超分/增强类接口）**

- 官网 https://www.faceunity.com/ ｜ 开发者中心 https://www.faceunity.com/developer/ （页面日期未知；页脚版权 `©2016-2023`，新闻更新至 2026.09）。抓取时间戳：服务器响应 `Date: Sun, 04 Oct 2026 08:14:22 GMT`。
- 官网全站（含 sitemap.xml 全量 URL）与开发者中心目录中，**未出现任何「视频超分 / 超分辨率 / 插帧 / 视频修复 / 画质增强」产品、文档或接口**。
- 官网首屏「产品方案」仅三条线：**智能终端解决方案 / AR 视频特效解决方案 / AI 数字人直播解决方案**。
- 「核心技术」页（https://www.faceunity.com/coretech/ ）声明 `"5+1+1"` 能力：5 大算法模块（弱输入智能建模、多要素角色动画、多模态自然交互、轻量化实时渲染、**智能化人像处理**）+ 自研渲染引擎 CUbic + 2 套硬件扫描仪。
  - ⚠️ 该页「技术赋能-手机行业」出现 **「影像质量增强」** 一词，原文「打造**人像美化、影像质量增强**、虚拟数字化身等模块的全套手机行业解决方案」——**这是手机端人像影像模块描述，不是视频超分 API**。
- 开发者中心交付形态：**AvatarX**（云平台 API 文档 + Android/iOS/Unity/Web SDK + PC 工具）、**Cubic AI SDK**（AI Human / AI Face）、**AR 视频特效**（Android/iOS/PC-Mac/Unity/UniApp/HarmonyOS/Web 七端，均为示例+集成文档+SDK 下载）。咨询表单「产品」下拉为：**美颜SDK / 数字人直播软件 / 数字人SDK/API**。
- **唯一的云 API 是 AvatarX 数字人云平台**，与会话/超分无关；其文档托管飞书 Wiki（`k2i32i19ow.feishu.cn/wiki/...`），抓取时返回 `{"code":5,"msg":"Login Required"}` → **接口路径/能力清单未证实**。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **否** |
| 产品与接口名 | 无此类产品；云侧仅 AvatarX 数字人云平台（接口未证实） |
| 调用形态 | 客户端/离线 SDK 授权为主（Android/iOS/鸿蒙/Mac/Windows/Unity/UniApp/Web） |
| 输入限制 | 不适用 |
| 计价方式与单价 | **未证实**（无定价页，仅「免费试用」申请表单） |
| 开通前置 | 提交「免费试用」申请表单 → 销售跟进（**商务签约制**）；`marketing@faceunity.com` / 0571-89774660 |
| 中国大陆节点 | 是（杭州；`浙ICP备16022736号`） |
| 数据出境风险 | 无 |

**失败/受限 URL**：`www.faceunity.com/developer/axwendang/{10639,10640,10641,10642,11435}.html`、`.../namawendang/10632.html` → HTTP 200 但响应体 **2 字节空**；`docs.faceunity.com` 无响应；飞书 Wiki 需登录。

---

## 12. 虹软 ArcSoft

**结论：否 —— 确实拥有影像增强技术，但形态是端侧 ISP 级嵌入式离线 SDK，不是对外开放的文件级视频超分云 API；且其「AI 开放平台」只开放人脸能力。**

- 官网 https://www.arcsoft.com.cn/ ｜ 视觉开放平台 https://ai.arcsoft.com.cn/ （版权 `© 2026 虹软科技股份有限公司`）
- **强反证**：百度 `site:arcsoft.com.cn 超分` → **「抱歉，未找到相关结果」**。（搜索快照，二手，但为站内无该内容的旁证）
- 官网技术目录开放能力清单中**无视频超分**：AI 影像增强与全景立体成像（暗光高清、防抖、HDR、全景、3D 建模/立体成像）、AI 人脸与人体分析、AI 视觉认知、AI AR/VR、AI 图像深度恢复。
- **暗光高清拍摄技术页**（https://www.arcsoft.com.cn/technology/low-light.html ）原文关键限定（证明其端侧/ISP 嵌入式属性）：
  - 「**结合平台 ISP 的特性**，优化去噪算法和参数，再通过虹软专利的多帧对齐智能合成算法生成高亮度、低噪点、真色彩、有细节的结果图」
  - 「针对视频提供算法方案，并且在**主流中端平台上可达到 1080p, 30fps 实时性能**」← 是**实时处理**，不是离线 480p→1080p 超分
  - 「利用平台快速连拍功能的特性（比如**高通平台的 ZSL 或者联发科平台的 ZSD**）」
  - 「广泛应用于**智能手机、DSC、电视、平板、机器人、智能家居、智能终端**等领域」
- **AI 开放平台**（https://ai.arcsoft.com.cn/ ）页面标题原文即为「虹软视觉开放平台—**以免费人脸识别技术为核心**的人脸识别算法开放平台」。开放技术：人脸检测/跟踪/比对/查找/属性、IR/RGB 活体检测、图像检测、大面积遮挡识别；开放产品：人脸识别 SDK、人证核验 SDK、活体检测 SDK；终端 SDK 标注「**离线激活、永久授权**」「**免费产品不限期**」；应用套件「门禁软件·**免费下载**·**开放源码**」。
- **商拍摄影云工作室 PhotoStudio AI**（https://photostudio.arcsoft.com.cn ）meta 描述原文：「致力于极低成本、极高效率满足**商业拍摄**需求……专业**电商行业AI作图工具**」→ **电商 AI 作图（图片生成）**，与视频超分无关。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **否** |
| 产品与接口名 | 无云 API；端侧 ISP 级影像增强算法 SDK（暗光高清/HDR/防抖/去噪） |
| 调用形态 | **离线 SDK 授权**（含离线激活）；**未发现任何云 REST 视频处理 API** |
| 输入限制 | 不适用 |
| 计价方式与单价 | 官网明确「**免费、支持离线**」「免费产品不限期」；**增值版/LINUX PRO/ARM PRO 授权单价未证实** |
| 开通前置 | 注册开放平台账号；免费 SDK 一键申请，增值版需商务沟通 |
| 中国大陆节点 | 是（杭州滨江区；`浙ICP备17021791号-3`）；**离线运行，本身不涉及数据上传** |
| 数据出境风险 | 无 |

**失败/受限 URL**：`ai.arcsoft.com.cn/{doc,documentCenter,docCenter,developer,openapi,sdk,product}` 及 `/algorithms/index.html` 等 → 全部「服务器崩溃了」或 404；`/manual/docs` 仅 JS 壳；`photostudio.arcsoft.com.cn` 仅 JS 壳。

---

## 13. 中科视语 VISIQUEST

**结论：未证实（且任务给定的官网域名已失效）**

- ⚠️ **首要发现：`visiquest.cn` 域名不存在**。本机 DNS、Google DNS 8.8.8.8、Cloudflare 1.1.1.1 **全部 NXDOMAIN**；`http://`、`https://`（含/不含 www）全部 `HTTP:000`。
- **实际官网已确认为 `www.objecteye.com`**（百度官方结果跳转 `Location: https://www.objecteye.com/`）。但该站 **HTTPS 全程不可用（HTTP:000）**，仅 HTTP 可用（200，1816 字节，DNS → `182.92.193.9` 阿里云杭州）。
- 首页 description 原文：「中科视语孵化自**中科院自动化研究所模式识别国家重点实验室**，由知名风险投资机构**金沙江创投**与中科院联合投资成立……在**智慧交通、智慧能源、智慧监管、智慧制造**等领域深层次布局。」导航：车文识别、智能监管、智能纺织机器人、智能制造。站点为 Vue SPA。
- **强反证**：
  - (a) 已下载并检索 4 个前端 bundle（共约 2.3 MB），对 `超分 | 超分辨率 | 画质增强 | 视频增强 | 图像增强 | 视频修复 | 插帧` 逐词 grep → **全部 0 命中**。
  - (b) 后端 API（`/api/article|nav|product|solution|index|menu|category`）→ **全部返回同一张「维护中...」页**（`<div class="weihu">维护中...</div>`）。
  - (c) `/sitemap.xml`、`/robots.txt` → 同为「维护中...」页。
- 公开技术方向（二手来源，未直接抓取原文）：智慧交通/能源/监管/制造、与华为昇腾合作车路协同、**道路病害识别分析一体机**、CVPR2025 **PhysVLM** → 方向为**视频结构化/目标识别/行业解决方案与一体机**，**未出现任何视频超分/增强产品**。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **未证实**（无任何证据表明存在） |
| 产品与接口名 | 未证实 |
| 调用形态 | 未证实；已知形态为行业解决方案 + 软硬一体一体机（私有化项目制） |
| 输入限制 | 未证实 |
| 计价方式与单价 | 未证实 |
| 开通前置 | 未证实（从业务形态看为项目制商务签约/私有化） |
| 中国大陆节点 | 是（服务器阿里云杭州） |
| 数据出境风险 | 无 |

**失败/受限 URL**：`visiquest.cn` 全变体 NXDOMAIN/HTTP:000；`https://www.objecteye.com/` HTTP:000；objecteye 全部 `/api/*` 与 sitemap/robots 为维护页；Wayback CDX 查询**超时无响应**。

---

## 14. 海康威视 Hikvision

**结论：否 —— AI 开放平台全量商品 27 项已枚举，零项超分/增强；路线为「训练算法 → 部署到自家设备/边缘盒子」，强硬件绑定。**

- 开放平台 https://open.hikvision.com/ ｜ AI 开放平台 https://ai.hikvision.com/ ｜ 官网 https://www.hikvision.com/cn/
- **抓取注意（对 Go 后端集成测试有意义）**：`https://open.hikvision.com/` 用普通 UA 返回 **HTTP 403 Forbidden（Server: openresty，WAF 拦截）**，须带完整浏览器请求头（Accept / Accept-Language / Sec-Fetch-* / sec-ch-ua）才 200。
- 「五大开放」（原文结构）：**应用能力开放**、**平台能力开放**（含 **AI开放平台**）、**数据能力开放**、**基础能力开放**、**设备能力开放**（设备集成 API/SDK/网关、音视频集成）。规模宣称「**4 个开发框架、1500+ 开放接口、1100+ 共性组件**……共 **278 个软件平台产品**」→ **五项开放中没有任何「视频增强/超分」条目**。
- **AI 开放平台商品目录全量枚举（最硬证据）** —— 调用其公开 JSON 接口（无需登录）：
```
POST https://ai.hikvision.com/api/ai-portal/portal/v1/goods-info/front-query
Content-Type: application/json
{"pageNo":1,"pageSize":100,"sortType":1}
→ {"code":"0","msg":"success","data":{"page":{"total":27,...},"dataList":[...]}}
```
  **`total: 27`，全部为检测/识别类算法模型（模型交付）+ 硬件（硬件交付）+ 解决方案（人工交付）**，例如：融合 HOG+SVM 安全帽识别模型、鼠患检测、制服检测、佩戴口罩检测、明厨亮灶后厨事件分析、佩戴帽子检测、安全帽识别、刀闸状态识别、挂空悬浮物识别、垃圾桶未上盖检测、跑冒滴漏识别、压板状态识别、表计智能读数、隔离开关状态识别、指示灯状态识别、车辆物料状态识别，以及 **AI开放平台智能服务器 / 筒机相机 / 超脑 / 半球相机**。**零项视频超分/画质增强/插帧。**
- 主 bundle 与 goods 相关 chunk 对 `超分|超分辨率|画质增强|图像增强|视频增强|视频修复|插帧` 检索 → **全部 0 命中**。
- **交付形态自证硬件绑定**（商品描述原文）：「AI开放平台智能服务器是**一站式训练平台配套服务器系列**……提供**边缘和数据中心级载体**」「AI开放平台摄像机是……**配套摄像机系列**……提供**端侧运算载体**」「AI开放平台超脑是海康威视AI开放平台**配套智能NVR系列**……提供**边缘运算载体**」。
- 「在线推理验证」接口 `/api/ai-inference/open-inference/v1/*` 实测返回 `{"msg":"授权错误","code":2}`（需 AK/SK），用于算法模型在线验证，**不是文件级视频增强接口**。
- 海康确有「视觉大模型」「观澜大模型」体系，但**落在摄像头等硬件产品上**（「视觉大模型系列摄像机」等）→ 属产品能力，**非对外可调用 API**。【二手：媒体稿，可信度中】HEOP 为「嵌入式在设备上运行第三方应用」的开放框架，**硬件绑定**路线。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **否** |
| 产品与接口名 | 无；AI 开放平台为算法训练 + 模型/硬件交付 |
| 调用形态 | 算法训练→部署到自有设备的模式；推理接口需 AK/SK，非文件级增强 |
| 输入限制 | 不适用 |
| 计价方式与单价 | **未证实**（无公开定价页） |
| 开通前置 | 需注册/登录；合作伙伴需加入「合作伙伴计划」并经「认证中心」认证 → **企业认证 + 商务签约 + 强硬件/生态绑定** |
| 中国大陆节点 | 是（杭州；`浙ICP备05007700号`） |
| 数据出境风险 | 无 |

**失败/受限 URL**：`open.hikvision.com/`（普通 UA）403；`/ai`、`/aiplatform` 链接不存在；`/documentCenter`、`/resource-center/document-center` 404；多个 portal API 405 或「授权错误 code:2」；`www.hikvision.com/cn/search` 结果 JS 加载不可读。

---

## 15. 大华股份 Dahua

**结论：否 —— 云平台确实真开放且公开计价，但计价维度是路数/带宽/流量，唯一视频处理项是「转码」，无任何超分/增强条目。**

- 大华的**五个易混开放平台**：

| 平台 | URL | 定位 |
|---|---|---|
| 大华万象（主开放平台） | https://open.dahuatech.com/ | 设备/平台/智能/数据/伙伴 五大开放总入口 |
| 大华巨灵 AI 开放平台 | https://ai.dahuatech.com/ | 页面标题原文：**「企业自己的算法训练平台」** |
| 大华物联能力开放平台 | https://open-gov.dahuatech.com/ | 政务/物联能力开放 |
| **大华云开发者平台** | https://open.cloud-dahua.com/ | **真正的云 REST API 平台，有公开价目表** |
| 大华云睿 | https://www.cloud-dahua.com/ | 企业级 SaaS |

- **大华万象能力清单**（https://open.dahuatech.com/map.html ）：设备开放（DHOP「允许第三方应用程序**安装在大华硬件设备上运行**」、设备网络 SDK、播放库 SDK）、平台开放、智能开放（原文「大华陆续发布了**通用行为，金融行为，人数统计，交通事件，浓缩摘要，工业事件，公共事件，城市治理**等数十种场景化算法」→ **全部检测/分析类**）、数据开放、合作伙伴（「合作申请 → 资格审查 → **合作签约**」）。
- **强反证**：主 bundle `js/main.d6ee0748.js`（1,373,782 字节）检索 `超分|superResolution|画质增强|图像增强|videoEnhance|imageEnhance` → **0 命中**；其 `/openapi/*` 端点仅门户配置与用户/伙伴管理。`https://open.dahuatech.com/openapi/config/menu/list` → `{"code":"000004","desc":"签名错误"}`（门户接口自身需签名）。
- **大华云开发者平台公开定价页（https://open.cloud-dahua.com/price ，抓取于 2026-10-04）** —— 官方导读原文：「大华云开发者平台定价 —— 帮您全面了解大华云开发者平台的产品价格和计费规则……」
  - **会员服务（按接入路数 + 带宽）**：

| 版本 | 接入路数 | 带宽 | 月价格 | 年价格 |
|---|---|---|---|---|
| 免费版（限时 120 天） | 10 路 | 1 Mbps | 免费 | 免费 |
| 轻量版 | 50 路 | 3 Mbps | **¥160/月** | **¥1,630/年** |
| 企业版 V1 | 100 路 | 5 Mbps | **¥260/月** | **¥2,650/年** |
| 企业版 V2 | 500 路 | 30 Mbps | **¥780/月** | **¥7,950/年** |
| 企业版 V3 | 2,000 路 | 50 Mbps | **¥1,680/月** | **¥17,800/年** |
| 企业版 V4 | 5,000 路 | 100 Mbps | **¥3,280/月** | **¥35,800/年** |

  - **扩展服务**：流量 **¥2.2/GB**；扩展带宽 **¥1/Mbps/日**；额外设备接入 **¥1.5/台/月**
  - **增值服务**：存储 **¥0.003/GB/日**；视频流量 **¥1.5/GB**；**转码 ¥5.5/千分钟/日**
  - → **价目中唯一与「视频处理」相关的是「转码 ¥5.5/千分钟/日」，全部计费维度为路数/带宽/流量/存储/转码。不存在任何「视频超分 / 画质增强 / 插帧」按分钟或按次计价条目。**（转码 ≠ 超分：前者是格式/码率转换，后者是分辨率提升 + 细节重建。）
- **文档中心（https://open.cloud-dahua.com/document ）**：产品文档（物联开放、云联开放、智能开放、业务开放、云睿开放）；开发套件 11 个（基础通用、视频监控、门禁业务开放、云运维、低功耗业务、云存储、**AI任务管理**、云联开放、CDN云直播、可视对讲、车辆管理）→ **11 个套件中无任何「视频增强/超分」套件**。
- 端侧/边侧大模型（哈勃系列、神算大模型、文搜 NVR 等）均为**硬件/软件平台产品**，非对外文件级增强 API。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **否** |
| 产品与接口名 | 云 REST API 开放且公开计价，但能力为设备接入/云直播/云存储/云智能/AI任务管理/**转码**；**无超分/增强接口** |
| 调用形态 | 云 REST API；限制维度是**接入路数、带宽(Mbps)、流量(GB)** |
| 输入限制 | 不适用（无此类 API） |
| 计价方式与单价 | **已抓到公开价目表**（见上）；**其中无视频超分计费项**；唯一视频类为**转码 ¥5.5/千分钟/日** |
| 开通前置 | 免费版可「立即注册」（限时 120 天）；轻量版及以上需「购买」；生态合作需「合作申请→资格审查→合作签约」；`dahuacloud_service@dahuatech.com` / 400-6728-166 |
| 中国大陆节点 | 是（杭州滨江区；`浙ICP备07004180号`） |
| 数据出境风险 | 无 |

**失败/受限 URL**：`cloud.dahuatech.com`、`yunrui.dahuatech.com`、`docs.dahuatech.com` HTTP:000；`open.dahuatech.com/{doc,yunrui}` 404；`/robots.txt`、`/sitemap.xml` 404；`ai.dahuatech.com`、`open-gov.dahuatech.com` 仅 JS 壳。

---

## 16. 极睿科技 / 硅基智能 / 瑞莱智慧

**结论：三家均无视频超分/修复 API。其中瑞莱智慧的方向是**相反的「检测」，任务背景中「可能是检测而非增强」的判断**已证实**。**

### 16.1 极睿科技 Infimind —— 否

- 官网 `https://www.infimind.com/` 为纯前端 SPA（Vite/React），首页 HTML 仅 1,134 字节，正文全在 `/assets/index-DgIfApod.js`（320,618 字节）。对该 bundle 做全量中文文本抽取后，**全部产品能力**为：
  - 「易尚货」（电商商品操作系统：商拍图、详情页排版、属性录入、多平台分发）
  - 「易视频」（AI 自动抓取品牌素材，批量生成全店商品微详短视频）
  - 「短视频带货 Agent」、「直播切片」、「图文/短视频内容代运营」
  - 核心 AI 能力：人台图转真人图、真人换脸、静物商品图换场景、**面部核心特征重构 / 3D 场景动态拟合 / 超分极致细节增强**
- **关键词计数（对 JS bundle）**：`API` = **0**、`开放平台` = **0**、`视频增强` = **0**、`视频修复` = **0**、`插帧` = **0**、`数字人` = **0**；`超分` = **1**、`画质` = 2。
- **`超分` 唯一出现的上下文是图片商拍能力描述**：`{label:"超分极致细节增强",icon:"✨"}`，与「面部核心特征重构」「3D 场景动态拟合」并列；同段文案「通过对计算机视觉、深度学习、图像生成和编辑等技术的研发和应用，实现模特图换脸、换场景、**高清精修美化**等功能」→ 即**图片级**超分/精修，且是**网页端功能，非 API**。
- 备案：京ICP备17058102号-7；主体「北京极睿科技有限责任公司」（北京市朝阳区酒仙桥路66号保利广场东座208）
- **判定**：电商 AIGC SaaS 厂商，**无对外开放的视频超分/修复 API**，也无开发者/开放平台入口。「超分」仅指图片商拍高清精修。
- 来源：https://www.infimind.com/ 、https://www.infimind.com/assets/index-DgIfApod.js 、https://www.infimind.com/cases （均页面日期未知）

### 16.2 硅基智能 Silicon Intelligence —— 未证实（未发现）

- **可达性实测**：`www.guiji.ai`、`guiji.ai`、`guiji.cn` 三个域名从本环境**全部不可达**（curl 000，连接失败）。
- 替代抓手：**国际品牌站 `https://www.duix.com/` 实抓可达**（48,563 字节），内容为**对话式 AI 数字人**：
  - 定位「#1 Conversational AI with real face and voice」「Interactive AI avatar」；技术指标「200ms TTFB latency, real voice, and 1:1 avatar likeness—delivering real-time two-way interactions」
  - 集成方式（原文）：「Seamlessly integrate across various SDKs and APIs… With just a few lines of code, you can connect your product to visual AI agent.」→ **对外确有 SDK/API，但面向实时数字人对话/口型驱动**
  - 页面结构仅 Docs / Pricing / About / Duix Skills / Join in，**无「视频增强」「超分」类产品**（对页面文本关键词匹配：视频增强/超分/插帧 **均 0 命中**）
- **判定**：对外能力是**数字人/虚拟人实时交互 SDK/API**（含口型、表情、视觉理解），**不是视频超分/修复/插帧 API**。`.ai`/`.cn` 主站不可达，未能核实 → 标注「未证实（未发现）」。
- ⚠️ 数字人 API 与「成片清晰化」需求**不匹配，不建议纳入候选**。
- 来源：https://www.duix.com/ （版权 © 2025 DUIX）、https://guiji.cn/ （不可达）

### 16.3 瑞莱智慧 RealAI / Prevision —— 否（方向相反：做检测）

- 官网实际域名为 **`https://www.real-ai.cn/`**（`https://www.realai.ai/` 直接 302 跳到 `real-ai.cn`），实抓 13,109 字节。
- 全部产品线（官网「产品中心」）：政策大模型、人机协同 AI 平台 RealCenter、隐私保护计算平台 RealSecure、人工智能安全平台 RealSafe、人脸 AI 安全防火墙 RealGuard、人工智能安全靶场 RealRange、**生成式人工智能内容检测平台 DeepReal**、大模型私域问答、**RealOasis 深度合成内容制作平台**。
- **DeepReal 对外表述**（原文）：「生成式人工智能内容检测平台」「AIGC 检测一体机 DeepReal」「能够提供主动实时检测防护，**可接入视频流鉴别人脸真伪**」→ 这是**深度伪造/AIGC 内容鉴别（检测）**能力。
- **站点地图 `https://www.real-ai.cn/sitemap.xml`（HTTP 200，3,518 字节）** 完整 `<loc>` 清单只有：`/`、`/about`、`/products`、`/core-technology`、`/solution`、`/news`、`/ai-research`、`/ecology` 及 `/news/company-news/<id>.html` —— **完全没有 `docs`/`developer`/`open`/`api` 类栏目**。
- `https://open.real-ai.cn/` 实测**连接失败（000）** → 无独立开放平台域名。
- **判定**：AI 安全厂商，视频相关能力是**深度伪造/AIGC 内容检测**，与「视频超分/修复/增强」**方向相反**，**无相关开放 API**。
- 来源：https://www.real-ai.cn/ （首页新闻时间戳最新至 2026.07.21）、https://www.real-ai.cn/sitemap.xml

### 16.4 三家小结

| 项目 | 极睿科技 | 硅基智能 | 瑞莱智慧 |
|---|---|---|---|
| 对外开放文件级视频超分/插帧/修复 API | **否** | **未证实（未发现）** | **否** |
| 实际视频能力 | 无（「超分」为**图片**商拍精修） | 数字人/虚拟人**实时交互** SDK/API | **深度伪造/AIGC 内容检测**（方向相反） |
| 计价 | 未证实（无定价页） | 未证实 | 未证实 |
| 开通前置 | 商务对接（「预约专家演示」） | 未证实 | 未证实 |
| 中国大陆节点 | 是（京ICP备17058102号-7） | 主站不可达（未证实） | 是 |
| 数据出境风险 | 无 | — | 无 |

> 附注（低相关）：RealAI 参与发起的多模态大模型公司**生数科技**（Vidu 视频生成），与视频生成强相关，但属**生成而非增强**，不在本次范围。

---

## 16.5 其它国内云厂商（华为云 / 百度智能云 / 火山引擎 / 腾讯云 CI）

### 16.5.1 腾讯云 CI（数据万象）· 画质增强 —— **是**（第二条产品线，价格同样公开）

> ⚠️ 腾讯云**并行存在两条视频增强产品线**：**MPS 音视频增强**（见第 7 节）与 **CI 数据万象画质增强**。二者接口、模板体系、计价**互相独立**，选型时必须分清。

- **接口**：模板 **`POST /template`**（`Tag=`**`VideoEnhance`**）+ 任务 **`POST /jobs`**；域名 `<BucketName-APPID>.ci.<Region>.myqcloud.com`；模板内节点：**`SuperResolution`**（超分，`Version` = `Base` 基础版 / `Enhance` 增强版）、**`FrameEnhance.FrameDoubling`**（插帧/帧率倍增）、**`MsSharpen`**（细节增强/锐化）、`ColorEnhance`（色彩增强）、`SDRtoHDR`（`HdrMode=HDR10`）；**`Transcode` 节点必填**，其余选填
- **另有独立「超分辨率」模板**（`Tag=SuperResolution`）：`<Resolution>` 取 **`sdtohd`（标清到超清）/ `hdto4k`（高清到4K）**；`<EnableScaleUp>` 自动缩放开关（默认关闭）；`<Version>` = `Base` / `Enhance`（默认 Base）
- **输入**：用 **COS Object 路径**（`<Object>`），**非 URL 直传**；异步任务支持 `CallBack` / `CallBackFormat` / `QueueId`，也支持工作流（上传即自动处理）
- **调用形态**：**异步任务队列 + 轮询/回调**
- **计价（中国大陆，元/分钟）**：

| 超分辨率（按**输出**时长） | 分辨率 R / 帧率 F | 价格 |
|---|---|---|
| 基础版 | R ≤ FHD(1920×1080) | F<30: **2.4** / F≥30: **3.2** |
| 基础版 | R > FHD(1920×1080) | F<30: 4.8 / F≥30: 9.6 |
| 增强版 | R ≤ HD(1280×720) | F<30: 4 / F≥30: 7.5 |
| 增强版 | HD < R ≤ 2K(2560×1440) | F<30: 6.5 / F≥30: 12 |
| 增强版 | 2K < R ≤ 4K(3840×2160) | F<30: 15 / F≥30: 24 |

| 视频插帧（按**输出**时长） | R ≤ HD | HD < R ≤ 2K | 2K < R ≤ 4K |
|---|---|---|---|
| F<30 / F≥30 | **3 / 6** | 6 / 12 | 18 / 36 |

| 视频增强（**通用计费项，按输入时长**） | 价格 |
|---|---|
| 色彩增强 / 细节增强 / SDR to HDR | 各 **0.4** 元/分钟 |

- ⚠️ **CI「视频增强」是通用计费项，会累加** —— 官方原文：「使用 5 分钟视频色彩增强 + 5 分钟 SDR to HDR，将产生 **10 分钟**视频增强用量」
- **开通前置**：绑定 COS 桶 + 开通数据万象 + **开通媒体处理服务**（**无需工单**）；子账号需 `ci:CreateMediaTemplate` / `ci:CreateMediaJobs`；**异步接口还需 `cam:PassRole` 权限**（通过 CAM 角色读写 COS）；媒体处理**并发默认 10 QPS**
- 来源：`/document/api/460/84722`（**2026-04-24**）、`/document/product/460/77092`（2022-07-15）、`/document/product/460/76912`（2023-03-17）、`/document/product/460/58120`（**2026-06-05**）、`/document/api/460/78247`（2026-01-16）
- 中国大陆节点：**北京/上海/广州/成都/重庆/南京**（+中国香港；海外另计）→ 媒资不出境
- ⚠️ **图片超分务必区分**（同产品线内）：`GET /<ObjectKey>?ci-process=AISuperResolution`，`magnify` ∈ {1,2,4}（默认 2，`magnify=1` 表示只做清晰度增强不改分辨率）→ **这是图片能力，与视频超分无关**
- **对本项目直算**：480p→1080p/30fps 走**超分基础版** = **3.2 元/分钟**；若同时插帧到 60fps，1080p 输出落在「HD<R≤2K 档」再加 **12 元/分钟**；若只要「去块/锐化」质感，**细节增强 0.4 元/分钟** 极低成本

> ⚠️ **诚实标注**：「提交画质增强任务」这一**页面的具体 URL 与任务侧 `Tag` 字面值未能直接抓取到**。可确证的是：① 该接口在官方接口列表（`api/460/78247`，2026-01-16）「画质增强」分类下**确实存在**（原文：「画质增强（包含超分辨率、视频插帧、色彩增强等功能）→ 提交画质增强任务」）；② 其模板侧 `Tag=VideoEnhance` 已由 `api/460/84722` 证实；③ 同族任务接口路径为 `POST /jobs`（已由「提交超分辨率任务」文档证实）。**任务侧 `Tag` 具体字面值标注「未完全证实」，接入前请以控制台/实际文档核对。**

### 16.5.2 华为云 MPC —— **否**

- **API 概览完整清单 + 产品功能页双重确证**：**无任何增强接口**（转码接口形如 `POST /v1/{project_id}/transcodings`）。
- ⚠️ 其宣传的「**高清低码**」是**编码压缩优化，不是 AI 超分**，须明确区分。

### 16.5.3 百度智能云 —— **否（视频无超分；只有图片）**

- **视频侧**：音视频处理 MCP（媒体处理）**仅转码**，无视频超分。
- **图片侧**：有**图像无损放大 / 清晰度增强** —— **图片级，不能用于视频成片**。
- 开通前置：实名认证。

### 16.5.4 火山引擎 / 字节跳动 —— **未证实（信息缺口，非确认无能力）**

- ⚠️ 本次**未能核实**：火山引擎文档站对非浏览器客户端有**强反爬** —— 换 Googlebot / Baiduspider / iPhone UA **全被 JS 挑战页挡住**；`sitemap.xml` 404；`/api/docs/search` 返回 `UnauthorizedAccess`；搜索引擎亦全部失效。
- → **视频增强 API：未证实**。**拿到官方接口名前不要写入技术方案。**
- **建议**：① 在浏览器环境人工确认 `www.volcengine.com/docs` 的媒体处理/视频点播文档；② 或直接向火山商务索取 API 清单。
- 🔎 **旁证线索（可信度中）**：境内聚合平台 **RunningHub** 已上线 **火山画质增强-极速版/标准专业版/大模型版**（端点 `/openapi/v2/volc-enhance{,-fast,-generative}/video`，见第 7.5 节）—— 说明火山确有该能力，但其**官方文档与定价页面本次未取到**。

### 16.5.5 云厂商横评（仅列已确证项）

| 厂商/产品 | 视频超分 | 插帧 | 去噪/去块/锐化 | 老片修复 | 准确接口 | 计价 | 开通门槛 |
|---|---|---|---|---|---|---|---|
| **腾讯云 MPS 音视频增强** | ✅ `超分`；**大模型修复内置超分** | ✅ 智能插帧（帧率 1–120） | ✅ 去毛刺/综合增强/降噪/去划痕/低光照 | ✅ **大模型修复**（Diffusion，官方点名老片/低清） | `ProcessMedia`(+`DescribeTaskDetail`) + `CreateTranscodeTemplate` | **元/分钟**：超分 0.6、综合增强 1.8、大模型视频修复 5.6、插帧 2.7(@≤60fps)、降噪 0.5、色彩增强 0.2、去划痕 2.3（1080p/≤30fps）**+ 转码费** | 低（价格公开，日结默认；月结需商务） |
| **腾讯云 CI 画质增强** | ✅ 基础版/增强版 | ✅ `FrameEnhance.FrameDoubling` | ✅ 细节增强 `MsSharpen` | 部分（细节/色彩/SDRtoHDR 组合） | 模板 `POST /template`(`Tag=VideoEnhance`) + `POST /jobs` | **元/分钟**：超分基础版 **3.2**（1080p/≥30fps）、插帧 3–36、细节/色彩增强 **0.4** | 低（绑桶 + 开通媒体处理，**无需工单**） |
| **阿里云 IMS 音画增强** | ✅ SR5（2× 放大，预置 1080p/4K 模板） | 未证实（页面未点名插帧） | ✅ 去压缩失真、多帧降噪、色彩与对比度增强 | ✅ 页面点名「老片高清重制」 | **`SubmitMediaConvertJob`** / `GetMediaConvertJob`（回调 `MediaConvertComplete`） | **元/帧**：标准版 1080p 及以下 0.003255（≈4.88 元/分钟@25fps）；专业版 0.05 | **中（必须提工单开通）** |
| **阿里云 VOD** | ❌ 无 | ❌ | ❌ | ❌ | —（全页关键词 0 命中） | — | — |
| **华为云 MPC** | ❌ 无 | ❌ | ❌（高清低码 = 编码压缩，非 AI） | ❌ | 转码接口，**无增强接口** | — | — |
| **百度智能云** | ❌ 视频无；✅ **图片** | ❌ | ❌ 视频无 | ❌ | 音视频处理 MCP：仅转码 | — | 实名认证 |
| **火山引擎** | **未证实** | 未证实 | 未证实 | 未证实 | **未证实**（文档站强反爬） | 未证实 | 未证实 |
| **OpenMMLab / MMagic** | ✅ 7 算法（**Apache-2.0 自建**） | ✅ 3 算法 | ✅ TOFlow 含 video denoising/deblocking | ✅ 适用 | **无云 API**，自建服务 | 自建 GPU 成本 | 无（开源） |

### 16.5.6 三家云厂商计价单位不一致（⚠️ 工程注意）

1. **腾讯云 MPS / CI = 元/分钟**；**阿里云 IMS = 元/帧**（须 × fps 折算：`时长(秒) × fps × 单价`）。
2. **腾讯云 MPS 增强必须叠加一笔转码费**。
3. **腾讯云 CI「视频增强」是通用计费项、会累加**（色彩增强 5min + SDRtoHDR 5min = 10 分钟用量）。
4. **最低成本组合（1080p/30fps）**：腾讯云 MPS **超分 0.6 + 普通转码 0.063 ≈ 0.663 元/分钟**；若只要去块锐化质感，腾讯云 CI **细节增强 0.4 元/分钟**。

## 17. OpenMMLab / MMagic（开源可自建路线）

**结论：无官方云 API，但 Apache-2.0 开源、可商用、可自建 —— 是「无 API 但完全可控」的兜底路线。**

- 官方仓库：https://github.com/open-mmlab/mmagic （原 MMEditing）
- **视频超分算法 = 7 个**：**RealBasicVSR、BasicVSR++、IconVSR、BasicVSR、TDAN、TOFlow、EDVR**（共 27 个 checkpoint）
- **视频插帧算法 = 3 个**：**CAIN、FLAVR、TOFlow**（共 7 个 checkpoint）
- ⚠️ **RIFE 不在 MMagic 内** —— `configs/` 全目录清单（**70 项已逐一核对**）中**无 `rife`**；若坚持用 RIFE 需另找上游实现（如 Practical-RIFE，MIT）。
- ⚠️ **易错点纠正**：**DIC (CVPR'2020) 是人脸「图片」超分，不是视频去水印/修复。**
- ✅ **TOFlow 官方覆盖 video denoising / deblocking** —— 正好对应 libtv 的「去噪/去块」需求。
- README（https://raw.githubusercontent.com/open-mmlab/mmagic/main/README.md ，页面日期未知）在册算法（另一组条目）：Video Super-Resolution = **EDVR (CVPR'2018)、BasicVSR (CVPR'2021)、BasicVSR++ (CVPR'2022)、RealBasicVSR (CVPR'2022)**；Video Interpolation = **TOFlow (IJCV'2019)、CAIN (AAAI'2020)、FLAVR (CVPR'2021)**；另有大量图像超分/去噪/修复/上色模型。
- **许可证（官方原文）**：README「License」节 —— 「This project is released under the **[Apache 2.0 license](LICENSE)**. Please refer to [LICENSES](LICENSE) for the careful check, **if you are using our code for commercial matters**.」；LICENSE 原文首行「Copyright (c) OpenMMLab. All rights reserved. Apache License Version 2.0」。
- **与商汤的关系**：EDVR、MMSR 均为商汤 & 港中文 MMLab 贡献/开源【二手旁证见第 1 节】，即商汤系视频超分能力经 OpenMMLab 以 Apache-2.0 释出。
- **对 libtv 的意义**：RealBasicVSR / BasicVSR++ 可直接在自有 GPU 上做 480p→1080p 超分，CAIN / FLAVR 做 24/30→60fps 补帧，TOFlow 兼顾去噪去块，**无出境风险、无按分钟计费、可离线批处理**；权重可从 `download.openmmlab.com` **直连下载**。代价是自建推理服务与调参（含时序一致性、面部区域、字幕保护）。
- **未证实**：OpenMMLab / 上海人工智能实验室是否有**官方商用云 API 或商业版授权** —— `openmmlab.com` **从本环境不可达**、Wayback **无快照**；**MMagic README 内所有对外链接只有 GitHub / ReadTheDocs / OpenXLab Demo，无任何 API 定价或商务授权入口**。**OpenXLab（浦源）**：仅模型/数据集托管 + Streamlit 应用 Demo + 上传下载 SDK/CLI，**未发现通用模型推理 REST API（未证实）**。

| 项目 | 结论 |
|---|---|
| 对外开放文件级视频超分/插帧 API | **无官方云 API**；**开源可自建（Apache-2.0，可商用）** |
| 产品与接口名 | MMagic（Python 库/推理脚本）；算法：BasicVSR++、RealBasicVSR、EDVR、FLAVR、CAIN、TOFlow 等 |
| 调用形态 | 自建 Python 推理服务（无托管端点） |
| 输入限制 | 取决于自建实现与显存 |
| 计价方式与单价 | **无（开源免费）**；成本 = 自有 GPU 算力 + 运维 |
| 开通前置 | 无 |
| 中国大陆节点 | 自建，境内 |
| 数据出境风险 | **无** |

---

## 18. Replicate / fal.ai 与开源商用云服务（海外，数据出境风险）

> 本节结论全部来自 curl 直接抓取官方定价页 / 官方公开 JSON API / `raw.githubusercontent.com` LICENSE 原文，**未使用搜索引擎二手来源**。

### 18.1 海外「确有文件级视频超分/插帧 API」的厂商 = 4 家

| 服务 | 有文件级视频超分/插帧 API | 关键 slug / 路径 | 调用形态 | 官方公开单价（USD） | 中国大陆节点 | 数据出境 |
|---|---|---|---|---|---|---|
| **Replicate** | **是** | `topazlabs/video-upscale`、`lucataco/real-esrgan-video`、`philz1337x/crystal-video-upscaler`、`zsxkib/seedvr2`、`zsxkib/film-frame-interpolation-for-large-motion` | 异步：`POST /v1/predictions` + `GET /v1/predictions/{id}` + `POST /v1/predictions/{id}/cancel`；webhook 签名密钥 `GET /webhooks/default/secret` | Topaz 720p→1080p/30fps **$0.093 / 5s**；60fps **$0.187 / 5s**；720p→4K/30fps $0.373 / 5s。Real-ESRGAN Video **≈$0.18/次**（A100 80GB） | 无 | ⚠️ 高 |
| **fal.ai** | **是（覆盖面最广）** | `topaz/upscale/video/precision`、`topaz/upscale/video/generative`、`topaz/interpolate/video`、`fal-ai/bytedance-upscaler/upscale/video`、`fal-ai/flashvsr/upscale/video`、`fal-ai/seedvr/upscale/video`、`fal-ai/rife/video`、`blackforestlabs/flux-video-upscale`、`clarityai/crystal-video-upscaler` | 异步 queue：`POST https://queue.fal.run/{model_id}` + 轮询 `.../requests/{id}/status?logs=1`；webhook `?fal_webhook=`；另有同步 `subscribe()` | **最低**：`fal-ai/bytedance-upscaler` **$0.0072/s @1080p**（2K $0.0144/s、4K $0.0288/s；60fps 翻倍；pro 模式 10×）。Topaz Precision **$0.20/10s@1080p**、1min **$0.80** | 无 | ⚠️ 高 |
| **Topaz Labs 官方直连** | **是**（自助注册，无需企业合同） | `POST https://api.topazlabs.com/video/`（`X-API-Key`） | 异步三步：创建 → `PATCH /video/{id}/accept` → S3 PUT 上传 → 轮询状态 | Proteus 10s@1080p = 2 credits ⇒ **$0.16~$0.24**；1min@1080p = 8 credits；10min@1080p = 76 credits | 无 | ⚠️ 高（美国达拉斯） |
| **PixelBin** | **是**（发现 `vsr_upscale` 插件） | 插件 `vsr_upscale`（`sr_upscale` 为**图片**） | **未证实**（文档站 JS 渲染） | **未证实** | 无 | ⚠️ 高（印度 Shopsense Retail Technologies） |

**明确「否」或「未证实」**：**ImageKit** —— 有视频变换 API（`/tr:` resize/crop/trim/overlay 等）但**无视频超分**；**Clipchamp** —— 未发现任何公开 API；**VEED / Kapwing / DeepAI** —— 本环境**网络不可达**（DNS 可解析但 TCP 全失败，`http=000`），**未能核实**。

### 18.2 fal.ai：本次调研中最便宜且最贴合 libtv 的选项

- ⭐ **`fal-ai/bytedance-upscaler/upscale/video`**（字节）单价 **$0.0072/s @1080p 30fps**（10s = $0.072），为全部抓到单价中**最低**。其 `enhancement_preset` 枚举原文包含 **`general / ugc / short_series / aigc / old_film`** —— **`short_series`（短剧）与 `old_film`（老片）几乎为本项目量身定制**；另含 `target_resolution`（`1080p/2k/4k/6k/8k`）、`target_fps`（24–120）、`enhancement_tier`（`fast/standard/pro`，pro 为 10 倍价）、`fidelity`（`high/medium`）、`bit_depth`（8/10/12，10/12bit 需 Pro）、`scale_ratio`（1.1–10.0）。
- **Topaz 系列（`modelLab: Topaz Labs`，`licenseType: commercial`，`publishedAt: 2026-08-17`）**：
  - `topaz/upscale/video/precision`：`$0.10/10s @720p、$0.20 @1080p、$0.60 @4K`（30fps）；1 分钟 **$0.40 / $0.80 / $3.10**。`model` 枚举含 Proteus、Proteus Natural、Iris、Iris Low Quality、Dione DV/TV/Robust/Dehalo、Artemis 系列、Gaia HQ/CG/Gaia 2、Rhea、Theia Fine Tune Detail/Fidelity；`upscale_factor` 1–4（default 2）；`target_fps` 16–60（**与源帧率不同时才启用补帧**）；`noise`/`halo`/`compression`/`recover_detail` 各 0.0–1.0；`grain` 0–0.1；`H264_output` 默认 false（默认 H265）。
  - `topaz/upscale/video/generative`（Starlight，**适合低质/压缩/档案素材**）：`$1.20/10s up to 1080p、$2.60 @4K`（Starlight Precise 2.6/HQ/Mini/Sharp）；`Starlight Fast 2` **$0.60 / $1.30**；60fps 则 **$2.40 / $5.10**。
  - `topaz/upscale/video/creative`（Astra 2）：**$3.00/10s up to 1080p、$5.00 @4K**；60fps $6.00 / $10.00。
  - **`topaz/interpolate/video`（补帧，最高 120fps）**：30→60fps/10s：**Apollo 或 Chronos $0.30 @1080p、$0.60 @4K；Aion $0.50 / $1.70**。`model` 枚举 `Apollo/Chronos/Aion`；`target_fps` 16–120（default 60）；`slowdown_factor` 1–8。
  - `topaz/denoise/video`：Nyx/Nyx XL/Nyx HF **$0.10 @720p、$0.20 @1080p、$0.60 @4K**（10s/30fps）；Nyx Fast $0.10 @720p·1080p、$0.30 @4K。
  - `topaz/deblur/video`（Themis 2）：**$0.10/10s up to 1080p、$0.30 @4K**。`topaz/colorize/video`（黑白上色并超分至 ≥1080p）：**$0.10 / $0.30**。`topaz/sdr-to-hdr/video`（Hyperion 2.5）：**$2.40/10s up to 1080p、$5.10 @4K**。
- **其它视频模型**：

| slug | 用途 | 单价（原文） | 关键输入限制 |
|---|---|---|---|
| `fal-ai/flashvsr/upscale/video` | FlashVSR（最快） | `$0.0005 / 视频总像素（宽×高×帧）`；1920×1080×121 帧 ⇒ **$0.125** | `upscale_factor` 1–4；`quality` 0–100；`output_format` X264/VP9/PRORES4444/GIF；`color_fix` 默认 true |
| `fal-ai/seedvr/upscale/video` | SeedVR2（时序一致性） | `$0.001 / 视频总像素`；1920×1080×121 帧 ⇒ **$0.25** | `upscale_mode` `target/factor`；`target_resolution` 720p/1080p/1440p/2160p；`upscale_factor` 1–10 |
| `clarityai/crystal-video-upscaler` | Crystal | `$0.10 / 输出兆像素/秒`，**按 FPS 乘数**（≤30 ×1、≤60 ×2、≤90 ×3） | `scale_factor` default 2、**max 200**，但输出不得超过 5K |
| `blackforestlabs/flux-video-upscale` | BFL FLUX 3 | precise：1080p **$0.14/s**、2K $0.25/s、4K $0.55/s；creative：$0.20/$0.35/$0.79 per s | ⚠️ **`The video must be at most 20 seconds and 50 MB.`**（不可用于整集） |
| `fal-ai/rife/video` | RIFE 补帧 | `$0.0013 / 计算秒` | `num_frames` 1–4；`fps` 1–60；`use_scene_detection` |
| `fal-ai/film/video` | FILM 补帧 | `$0.0013 / 计算秒` | 同上 |
| `bria/video/increase-resolution` | Bria（最高 8K） | **未证实**（`pricingInfoOverride: None`） | ⚠️ **`Size should be less than 7680,4320 and duration less than 30s.`** |
| `fal-ai/video-upscaler` | 逐帧 RealESRGAN | **未证实**（`pricingInfoOverride: None`；GPU-A6000） | `scale` default 2、max 8 |

- **注意区分图片/视频**：`fal-ai/film` 是**图片**，`fal-ai/film/video` 才是**视频**；`fal-ai/esrgan`、`fal-ai/aura-sr`、`fal-ai/clarity-upscaler`、`fal-ai/drct-super-resolution`、`fal-ai/codeformer`、`fal-ai/nafnet/*`、`fal-ai/docres` 等均为**图片**。
- **调用形态（官方 `queue.md` 原文）**：提交 `POST https://queue.fal.run/{model_id}`，header `Authorization: Key $FAL_KEY` → 返回 `request_id`/`response_url`/`status_url`/`cancel_url`；查状态 `GET .../requests/{id}/status?logs=1`；取结果 `GET .../requests/{id}`；取消 `PUT .../cancel`；**Webhook** `?fal_webhook=https://your-server.com/webhook`（`fal may retry failed deliveries, so use request_id for idempotency`）；状态 `IN_QUEUE`/`IN_PROGRESS`/`COMPLETED`；「**Requests in the queue are never dropped.**」「There is no queue size limit.」失败自动重入队，**最多重试 10 次**；平台头含 `X-Fal-Request-Timeout`、`X-Fal-No-Retry`、`X-Fal-Queue-Priority`、`X-Fal-Object-Lifecycle-Preference`。
  - ⚠️ per-model `openapi.json` 的 path 显示为 `https://queue.fal.run/{model_id}/{model_id}`（重复两遍），与官方 `queue.md` 不一致，**上线前需实测**。
- ⚠️ **数据留存（官方 `data-retention.md` 原文）**：`Generated media files are stored on the CDN and served as public URLs.` —— **生成媒体默认以公开 URL 形式存在于 fal CDN**；可用 `X-Fal-Object-Lifecycle-Preference`（如 `{"expiration_duration_seconds": 3600}`）控制过期。
- **平台定价（`fal.ai/pricing` 原文）**：GPU 自定义部署 B300 288GB `$12.99/h`、GB200 `$9.99/h`、B200 `$7.99/h`、H200 `$6.00/h`、H100 `$4.50/h`、RTX PRO 6000 `$4.00/h`。⚠️ 定价页的 Video/Image/Audio/3D 各**只列 Top 10 端点，不含任何超分模型** ⇒ **只看定价页会误以为 fal 没有超分能力**。
- **可复用侦察手法**：**全量模型目录 `GET https://fal.ai/api/models?page=N`（无需鉴权）** → `total = 1503`（每页 40 条），每条含 `modelUrl`/`category`/`licenseType`/**`pricingInfoOverride`（完整定价原文）**/`publishedAt`；⚠️ 其 `?search=` **被忽略**（必须全量拉取后本地过滤）。**每模型 OpenAPI `GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={model_id}`**（无需鉴权）→ 权威 input schema。

### 18.3 Replicate 细节

- 权威 schema：`https://api.replicate.com/openapi.json`（`servers: [{url: "https://api.replicate.com/v1"}]`，`title: Replicate HTTP API`）。路径：`POST /predictions`、`GET /predictions/{id}`、`POST /predictions/{id}/cancel`、`POST /models/{owner}/{name}/predictions`、`POST /deployments/{owner}/{name}/predictions`、`GET /webhooks/default/secret`、`GET|POST /files`。
- ⚠️ **必须修正的认知**：Replicate **没有 `video-upscaler` collection**（`/collections/video-upscaler` → 404 `Collection not found`）；视频超分在 **`/collections/ai-enhance-videos`**（标题 `Enhance videos`），而 **`/collections/super-resolution` 是纯图片集合**（标题 `Upscale images with super resolution`）。
- ⚠️ **官方集合页引用了已失效 slug**：`runwayml/upscale-v1` → 404；`google/film-frame-interpolation` → 404（可用的是 `zsxkib/film-frame-interpolation-for-large-motion`）。**不可照抄集合页文案**。
- `topazlabs/video-upscale`（Proprietary）：官方 5 秒价目表原文 —— 720p→720p/30fps **$0.027**；720p→720p/60fps $0.053；**720p→1080p/30fps $0.093**；720p→1080p/60fps $0.187；720p→4K/30fps $0.373；720p→4K/60fps $0.747。**Input schema**：`required: ['video']`；`target_fps`（default 30，**15–60fps**）；`target_resolution`（default `1080p`，enum `720p/1080p/4k`）。注：集合页文案称支持 120fps，但模型页与 schema 为 15–60fps，**以 schema 为准**。
- `lucataco/real-esrgan-video`：`approximately $0.18 to run, or 5 runs per $1`；`Nvidia A100 (80GB)`。输入限制原文：`Works for MP4 videos only, and filename must not contain spaces`。schema：`model`（default `RealESRGAN_x4plus`，enum `RealESRGAN_x4plus / RealESRGAN_x4plus_anime_6B / realesr-animevideov3`）、`resolution`（default `FHD`，enum `FHD/2k/4k`）、`video_path`。
- `philz1337x/crystal-video-upscaler`：`$0.10/$0.20/$0.30 per output video megapixel per second`；schema：`video`、`scale_factor`（default 2，**输出超 4K 会被截断**）。
- `zsxkib/film-frame-interpolation-for-large-motion`（FILM 补帧）：`≈$0.11/run, 9 runs per $1`；`Nvidia L40S`。schema：`mp4`、`num_interpolation_steps`（default 3）、`playback_frames_per_second`（default 24）。
- `pbarker/gfpgan-video`（人脸修复）：`≈$0.30/run`；`scale`、`video`、`version`（default v1.4，enum `v1.2/v1.3/v1.4/RestoreFormer`）。
- `zsxkib/seedvr2`：`≈$0.030/run, 33 runs per $1`；`H100`；保留源音频 + 可选 `apply_color_fix`。
- `tencentarc/animesr`（**动画**视频超分）：`≈$0.0033/run`（303 runs/$1），T4，~15 秒。
- `arielreplicate/deoldify_video`（老片上色）：`≈$0.060/run`；页面写明 `All code in this repository is under the MIT license`。
- ⚠️ `zsxkib/stable-video-face-restoration`（SVFR）页面原文：**`Available for non-commercial research purposes only.`** → **不可商用**。
- **平台硬件定价（`replicate.com/pricing` 原文，按硬件·秒）**：`cpu-small $0.000025/s`、`cpu $0.000100/s`、`gpu-t4 $0.000225/s`、`gpu-l40s $0.000975/s`、`gpu-a100-large $0.001400/s`、`gpu-h100 $0.001525/s`、`gpu-h200 $0.001525/s`（多卡需 committed spend）。`Most models are billed by the time they take to run.`
- 开通前置：注册 + API token（信用卡充值）；未见企业认证门槛。**未见中国大陆节点说明 → 未证实**。

### 18.4 Topaz 官方直连的输入限制（对「整集短剧」最关键）

- **文件大小**：`source.size must be less than 100 GB`（**100 GB**）；大文件走 multipart，**最多 150 段**。
- **时长**：`the request schema sets no maximum` ⇒ **文档未规定最大时长** ⇒ **唯一真正适配整集长视频的海外方案**。
- **输入容器（20+）**：`3gp, avi, dv, flv, m1v, m2t, m2ts, m2v, m4v, mkv, mov, mp4, mpeg, mpg, mts, mxf, ser, ts, vob, webm, wmv`。
- **限流**：`No fixed concurrent-job limit is published. API rate limits vary with server load; requests may receive 429, for which exponential backoff is recommended.`
- 对比：fal 上 Bria 封装**限 30s**、BFL 封装**限 20s/50MB** —— **均不可用于整集**。
- **Proteus 精细价目表（Topaz 官方原文，时长 × 输出分辨率）**：1s 1/1/1；5s 1/1/3；10s 1/**2**/6；**1min 4/8/31**；5min 17/38/151；**10min 34/76/302**（720p/1080p/4K）。注：`Gaia 2 (Animation) is roughly 50% cheaper than all other models in this family.`
- **Starlight**：`Frames Per Credit` 1080p **~26**、4K **~12**（Precise 2.6/HQ/Mini/Sharp）；`Starlight Fast 2` **~52 / ~24**；`Fast models are priced at 50% of the Quality models.`
- **Astra**：1080p **~7.7**、4K **4.3** frames/credit。**Frame Interpolation**：`Credits per GP`（generated frame）**Aion 6 / Apollo·Chronos 2 / Apollo Fast·Chronos Fast 1**。
- **交叉校验（α）**：fal 的 `topaz/upscale/video/generative` 报 **$1.20/10s@1080p**，与 Topaz 官方「Starlight Quality 12 credits × $0.10/credit = $1.20」**完全吻合** —— 两个独立来源互证，可信度高。
- 认证：header `X-API-Key`；API Key 在 `https://account.topazlabs.com/manage-api` 自助创建（**仅创建时可见一次**）。创建请求 `POST https://api.topazlabs.com/video/` 官方标注 **`This endpoint is free to use.`**

### 18.5 开源方案许可证（全部为 LICENSE 原文逐字核实）

| 项目 | 仓库 | 许可证（LICENSE 原文首行） | 可否商用 |
|---|---|---|---|
| **Real-ESRGAN** | `xinntao/Real-ESRGAN` | **`BSD 3-Clause License`** | ✅ 可商用 |
| Real-ESRGAN（NightmareAI fork） | `NightmareAI/Real-ESRGAN` | **`BSD 3-Clause License`** | ✅ 可商用 |
| **Video2X** | `k4yt3x/video2x` | ⚠️ **`GNU AFFERO GENERAL PUBLIC LICENSE Version 3`** | ⚠️ **是 AGPL-3.0，不是 GPL-3.0！** 对**网络服务**触发源码开放义务 —— libtv 是 Go 后端 SaaS，**若以自有服务对外提供，须向用户提供完整对应源码；闭源商用不可直接集成** |
| **Practical-RIFE** | `hzwer/Practical-RIFE` | **`MIT License`** | ✅ **可商用（最宽松）** |
| **BasicSR** | `XPixelGroup/BasicSR` | **`Apache License Version 2.0`**（文件名为 `LICENSE.txt`） | ✅ 可商用（保留 NOTICE） |
| **waifu2x** | `nagadomi/waifu2x` | **`The MIT License`** | ✅ 可商用 |
| **Anime4K** | `bloc97/Anime4K` | **`MIT License`** | ✅ 可商用 |
| **GFPGAN** | `TencentARC/GFPGAN` | **`Apache License Version 2.0 except for the third-party components listed below`** | ✅ 大体可商用，**须逐项核查第三方组件** |
| **FILM** | `google-research/frame-interpolation` | **`Apache License Version 2.0`** | ✅ 可商用 |
| **SeedVR** | `ByteDance-Seed/SeedVR` | **Apache-2.0** | ✅ 可商用 |
| **DeOldify** | — | `All code in this repository is under the MIT license` | ✅ 可商用 |
| **SVFR** | — | ⚠️ `Available for non-commercial research purposes only` | ❌ **不可商用** |

- **这些开源项目均无官方托管商用云 API**（逐一核查 LICENSE + README，均无 API base URL、无 API key 体系、无定价页）。waifu2x README 提到的 `https://waifu2x.udp.jp/`、`https://unlimited.waifu2x.net/` 是**网页 Demo**，未表述为可编程 API。
- ⇒ 商用只有两条路：**(1) 自建**（中国大陆部署，**唯一能规避数据出境**的路线）；**(2) 经第三方托管平台间接调用**（Replicate / fal.ai 上已有对应封装，slug 见 18.1–18.3）。
- **自建选型速评**：通用超分 → **Real-ESRGAN**（BSD-3，`RealESRGAN_x4plus`/`realesr-animevideov3`）；**动漫/漫剧**超分 → `realesr-animevideov3`、**Anime4K**（MIT，shader 方案实时性好）、`tencentarc/animesr`；补帧 24/30→60fps → **Practical-RIFE**（MIT）或 FILM（Apache-2.0）；去噪/去块/锐化 → BasicSR（Apache-2.0，如 NAFNet）；老片修复/上色 → DeOldify（MIT）、GFPGAN（Apache-2.0 + 第三方例外）。**⚠️ 避免 Video2X（AGPL-3.0）与 SVFR（非商用）。**

**失败/受限清单（本节相关）**：`deepai.org`、`www.veed.io`、`veed.io`、`developers.veed.io`、`www.kapwing.com`、`kapwing.com`、`developers.kapwing.com` → **本环境 TCP 全失败（http=000）**，**未能核实**；404：`replicate.com/collections/video-upscaler`、`topazlabs.com/solutions/api`、`docs.pixelbin.io`、`imagekit.io/pricing`、`api.replicate.com/v1/models/...`(401)；Replicate docs 正文页与 fal playground 正文为 JS 渲染未取到。

---

## 汇总表

> 说明：单价列中标注「**推算**」的，是基于官方公布单价的算术换算，**非厂商公布的一口价**。海外厂商单价为 USD。所有「未证实」均表示本次未抓到官方原文。

### A. 境内（无数据出境风险）—— 确有对外开放 API 的厂商

| # | 厂商 / 产品 | 文件级视频超分 API | 产品与接口名（准确路径） | 调用形态 | 输入限制 | 单价 | 开通前置 |
|---|---|---|---|---|---|---|---|
| 1 | **腾讯云 MPS · 音视频增强** | **是** | 模板：**`327002/327004/327006/327008`（漫剧场景-大模型增强 720P/1080P/2K/4K）**、327029–327032（漫剧·小脸优化）、327021–327024（老片·大模型修复）、327001/003/005/007（真人）；接口：**`ProcessMedia`**（`MediaProcessTask.TranscodeTaskSet[].Definition` 传模板 ID）、查询 **`DescribeTaskDetail`**、回调解析 `ParseNotification` | **异步 + 轮询/回调**（`TaskNotifyConfig`）；另有 COS 上传自动触发编排（3–5 分钟生效） | **支持 URL 直传**（`InputInfo.Type=URL`）或 COS；输出 COS/VODPro；时长/大小上限未证实 | **元/分钟（按增强后时长）**：大模型视频增强 720px **1.3**、**1080px 2.9**（≤30帧）；大模型视频修复 1080px **5.6**；专业版 1080px **12.3**；超分 1080px **0.6**；插帧 1080px(30–60帧) **2.7**；降噪 1080px 0.5；去毛刺 1080px 0.2。**须另加一笔转码费**（极速高清 H.264 1080px 0.195 / 720px 0.099）。**推算**：480p→1080p 漫剧增强 ≈ **3.10 元/分钟** | 注册 + 开通 MPS + 服务角色授权（**无需商务签约**） |
| 2 | **阿里云 VIAPI · 视频增强** | **是** | **`SuperResolveVideo`**（视频超分辨）→ **`GetAsyncJobResult`**；**`EnhanceVideoQuality`**（视频综合增强：插帧+超分+SDR转HDR）；**`InterpolateVideoFrame`**（视频插帧）；`videoenhan.cn-shanghai.aliyuncs.com` | **异步 + 轮询** | **URL 直传**（`VideoUrl`）；≤**1GB**；格式 MP4/AVI/MKV/MOV/FLV/TS/MPG/MXF；分辨率须 **>360×360 且 <1920×1080**；**输出仅 2 倍**；返回 URL **有效期 30 分钟** | **元/分钟**（分辨率按输入、帧率按时输出）：超分辨 ≤720P **0.4**、720–1440P 0.8；综合增强 ≤720P **4**；插帧 ≤720P **3**。失败不计费 | 注册 + **开通「视频生产服务」** + AccessKey（子账号需 `AliyunVIAPIFullAccess`） |
| 3 | **阿里云 IMS · 音画增强（AI 超分 SR5）** | **是** | 模板 **`S00000004-401040`**（`MP4-HD-UHD-SR5`，720P→1080P）、**`S00000004-401070`**（`MP4-4K-UHD-SR5`，1080P→4K）；接口 **`SubmitMediaConvertJob`** → **`GetMediaConvertJob`** / 回调 **`MediaConvertComplete`** | **异步 + 轮询或回调** | 输入**必须在 OSS**；输出到 OSS；输出分辨率固定 1080P/4K（超分默认开启，**放大 2 倍**） | **元/帧**：超分标准版 HD≤1080p **0.003255**、2K 0.007、4K 0.014；**超分专业版 HD 0.05**（含超分+修复，影视后期）。官方例：720P→1080P/25fps/200min = **976.5 元**。**推算**：标准版 1080p **≈4.88 元/分钟@25fps**、**5.86@30fps**；专业版 ≈75 元/分钟 | 开通 IMS + OSS；**音画增强需提交工单**联系阿里云客服开通 |
| 4 | **RunningHub**（境内聚合） | **是** | **`RH视频超分`** → `POST /openapi/v2/rhart-video/video-upscaler`；**`RH视频帧率增强`** → `/openapi/v2/rhart-video/video-fps-increaser`；`DetailX/视频超分补帧` → `/openapi/v2/arklin/video-super-resolution`；**`topazlabs视频增强Proteus/Starlight/Astra/Denoise/Frame Interpolation`** → `/openapi/v2/topazlabs/video-*`；**火山画质增强-极速版/标准专业版/大模型版** → `/openapi/v2/volc-enhance{,-fast,-generative}/video`；查询 `/openapi/v2/query` | **异步 + 轮询** | `videoUrl`（**URL 直传**）+ `targetResolution`（示例 `1080p`）；**单次最高 10 分钟** | 按量弹性计费（**元**）；**各接口具体单价未证实**（价格页异步加载） | 注册 + 获取 API Key（`Authorization: Bearer`） |
| 5 | **美图 AI 开放平台** | **是**（参数/价格未证实） | 产品：**视频超清（文档 id 404）**、**视频AI超清2.0（id 420）**、**视频-画质增强（id 414）**、视频去噪（372）、视频-暗光去噪-画质调光（415）、视频-色彩增强（417）、人像增强-基础版/极致版（405/406/430）；基址 **`https://openapi.mtlab.meitu.com/`**；**实测存在路由 `v1/superResolution`、`v1/videoEnhance`、`v1/videoDenoise`** | **异步 + 轮询**（文档有「异步任务查询/取消」「API任务查询状态」） | **未证实**（文档正文需登录） | **未公开**（申请制「价格确认」）；【二手 ￥20,000/2万次，可信度低】 | 注册 → **申请接口** → 价格确认 → 订单支付；`aigc@meitu.com` |
| 6 | **阿里云百炼 · VideoRetalk** | **有 API 但功能无关**（口型替换，非超分） | 模型名 **`videoretalk`** | 异步（**RPS=1，并发=1**，其余排队） | 人物视频 + 音频；**仅华北2（北京）**；不支持控制台体验 | **0.08 元/秒**（≈4.8 元/分钟）；免费额度 1800 秒 | 需该地域 API Key |
| 7 | **腾讯云 CI（数据万象）· 画质增强** | **是**（腾讯云**第二条独立产品线**） | 模板 **`POST /template`**（`Tag=`**`VideoEnhance`**）+ 任务 **`POST /jobs`**；模板节点 **`SuperResolution`**（超分·基础版/增强版）、**`FrameEnhance.FrameDoubling`**（插帧）、**`MsSharpen`**（细节增强/锐化）、`ColorEnhance`、`SDRtoHDR` | 异步（模板 + 任务） | 需绑定 COS 桶；限制未证实 | **元/分钟**：**超分基础版 1080p/≥30fps 3.2**；插帧 3–36；色彩/细节增强 **0.4**。⚠️「视频增强」是**通用计费项会累加**（色彩 5min + SDRtoHDR 5min = 10 分钟用量） | 绑桶 + 开通媒体处理（**无需工单**）；异步还需 `cam:PassRole` |

### B. 境内 —— 有入口但未公开 / 未证实 / 否

| # | 厂商 | 文件级视频超分 API | 说明 | 单价 |
|---|---|---|---|---|
| 7 | **牛学长 / 牛小影**（HitPaw 中国） | **未证实** | 官方明确提供「**视频分辨率提升API**」三种形态（API接口/私有化部署/咨询服务），但**无任何公开端点、参数、文档**；全站 CTA 为「立即咨询」「VIP接口申请合作」 | **未公开**（须填表咨询） |
| 8 | **微帧 Visionular** | **未证实** | 「AI超高清处理引擎（帧彩视界）」官方描述含**智能超分辨率、画质修复（去噪/锐化/增强/修复）、智能插帧（最高120fps）**，场景含**短剧增强**与**经典老片增强**；但公开文档 `docs.visionular.com` **只覆盖转码（AuroraCloud VOD）与直播（AuroraLive）**，对 `superres/upscal/enhance/denoise/interpolat` **0 命中** | **未公开**（申请试用/立即咨询） |
| 9 | **商汤 SenseTime** | **否 / 未证实** | 无文件级视频超分 API。产品清单中**如影=数字人、秒画=文生图、Seko=短片创作**；SenseME/水星为**SDK/AI传感器/ISP芯片**；SenseMARS 为特效引擎+三维重建。其视频超分能力以**开源**形态存在（EDVR→MMagic，Apache-2.0） | 未证实 |
| 10 | **影谱科技 Moviebook** | **未证实** | **官网域名全部 DNS 解析失败**（`moviebook.cn`/`www.moviebook.cn`/`moviebook.com`），无一手资料；二手资料仅述「Video AI 生产引擎」（2019），**无超分/修复 API 的任何证据** | 未证实 |
| 11 | **相芯科技 FaceUnity** | **否** | 技术栈为实时美颜/AR 特效/数字人（客户端 SDK + AvatarX 数字人云 API），**根本没有视频超分能力线**；「影像质量增强」仅为手机端人像模块文案 | 未证实（商务签约制） |
| 12 | **虹软 ArcSoft** | **否** | **有影像增强算法但是端侧 ISP 级嵌入式离线 SDK**（原文「结合平台 ISP 的特性」「主流中端平台 1080p 30fps 实时」「高通 ZSL / 联发科 ZSD」）；开放平台只开放**人脸**能力；百度 `site:arcsoft.com.cn 超分` → **「抱歉，未找到相关结果」** | 免费为主；增值授权未证实 |
| 13 | **中科视语 VISIQUEST** | **未证实**（且给定域名已失效） | ⚠️ `visiquest.cn` **NXDOMAIN**（三个 DNS 均失败）；实际官网 `www.objecteye.com` **HTTPS 不可用**、后端 API **整体「维护中」**、4 个前端 bundle 对超分/增强关键词 **0 命中**；方向为智慧交通/能源/监管/制造 | 未证实 |
| 14 | **海康威视 Hikvision** | **否** | **AI 开放平台商品全量枚举 = 27 项，零项超分**（公开 JSON 接口 `POST https://ai.hikvision.com/api/ai-portal/portal/v1/goods-info/front-query` → `total: 27`），全部为检测/识别算法模型 + 承载硬件；商品描述自证硬件绑定 | 未证实（无公开计价） |
| 15 | **大华股份 Dahua** | **否** | 云平台**真开放且公开计价**，但**价目表无超分条目** —— 全部维度为**路数/带宽/流量/存储/转码**；唯一视频处理项 **转码 ¥5.5/千分钟/日**；11 个开发套件**无增强套件**；主 bundle（1.37MB）对超分关键词 **0 命中** | **已抓到公开价目表**（会员 ¥160–3,280/月等），**其中无超分项** |
| 16 | **万兴科技 · 天幕 AILab** | **否**（**只有图片超分**） | **确有开放 API 平台**：base **`https://wsai-api.wondershare.cn`**，`Authorization: Basic base64(appkey:appsecret)`，**异步+轮询**（`POST /v3/pic/xxx/batch` → `task_id` → `GET /v3/pic/xxx/result/{task_id}`）。**图片**：`2倍图像超分` **`/v3/pic/fsr/batch`**、`图像清晰化` `/v3/pic/epe/batch`、`人脸清晰化` `/v3/pic/det/batch`。**视频只有**：文生视频 `/v3/pic/t2v/batch`、视频换脸 `/v3/pic/vfs/batch`、视频去水印 `/v3/pic/vrw/batch`、数字人 `/v3/pic/virtual_human/batch` → **无视频超分/插帧/修复**（90 个视频增强关键词探测 **0 命中**） | 付费，**单价未公开（未证实）**；余额制（错误码 `490027`）。图片限制：≤50MB、>256×256、<4K、纵横比≤4:1、单次≤20张、**支持可下载 URL 直传** |
| 17 | **万兴 · Media.io** | **未证实** | 网页端创作工具形态；**大陆不可直连**（DNS 污染到 Meta/Twitter/Dropbox 网段 + 80/443 超时）；wondershare.com 全站**无 Media.io 的 API/开发者入口**（`/api/`、`/developer/`、`/enterprise/` 均 404） | 未证实 |
| 18 | **万兴 · Filmora / 喵影 / Virbo** | **否** | AI 增强是**桌面客户端功能**（本地 RTX 30 系 GPU 或万兴云侧代跑）；官方 FAQ：「Enhance: **No time limit** for local processing, up to 4K」「Generative Enhance/Bright Night View/Dark Night View: **Up to 3 minutes**」；集成的 `Topaz Starlight` 模型；`/api/`、`/developer/`、`/sdk/` **均 404**；企业版仅「Request a Demo」表单 | AI credits（订阅制），**无 API 单价** |
| 19 | **出门问问 Mobvoi** | **否 / 未证实** | 序列猴子开放平台 `openapi.mobvoi.com`（→ 腾讯云南京 CLB，**大陆节点**）；从官方 bundle（构建目录 2026-09-15）提取的能力为 `/llm`、`/video-introduce`（视频合成）、`/faceclone`、`/digtalHuman`、`/realtime-digital-man`、语音类；**「超分/画质/修复/插帧」全文检索 0 命中** | 仅见「克隆声音 API 100元/100w字符」（**与本需求无关**）；接口路径与各能力单价未证实 |
| 20 | **深言科技 DeepLang** | **否** | 官网 `deeplang.ai` **无「开放平台/API/开发者」入口**；产品只有文本类（语鲸 lingowhale.com、深言达意 shenyandayi.com）；定位「新一代**智能文本信息处理**引擎」 | — |
| 21 | **极睿科技 Infimind** | **否** | 电商 AIGC SaaS；对 JS bundle 关键词计数：`API`=0、`开放平台`=0、`视频增强`=0、`视频修复`=0、`插帧`=0；`超分`=**1**，唯一上下文是**图片**商拍 `{label:"超分极致细节增强"}` | 未证实（无定价页；「预约专家演示」） |
| 22 | **硅基智能** | **未证实（未发现）** | `guiji.ai`/`guiji.cn` **全部不可达（curl 000）**；可达的 `duix.com` 为**对话式 AI 数字人**（「200ms TTFB」「real-time two-way interactions」），**对外确有 SDK/API 但面向实时数字人交互**；页面「视频增强/超分/插帧」**0 命中** | 未证实 |
| 23 | **瑞莱智慧 RealAI** | **否（方向相反：做检测）** | 实际官网 **`www.real-ai.cn`**；产品为 RealCenter/RealSecure/RealSafe/RealGuard/RealRange/**DeepReal（生成式 AI 内容检测）**/RealOasis；DeepReal 原文「**可接入视频流鉴别人脸真伪**」→ **深度伪造检测，非增强**；`sitemap.xml` 全量 `<loc>` **无 docs/developer/open/api 栏目**；`open.real-ai.cn` 连接失败 | 未证实 |
| 24 | **华为云 MPC** | **否** | **API 概览完整清单 + 产品功能页双重确证无增强接口**（仅转码/转封装/转动图/截图/水印/剪辑/视频解析）；⚠️「**高清低码**」是**感知编码压缩（省带宽），不是 AI 超分**；输入**必须 OBS**（无 URL 直传）、**不支持跨区域媒资**、单租户流控 100 次/分钟 | — |
| 25 | **百度智能云** | **否（视频无；只有图片）** | 音视频处理 MCP（代码 `MCT`）全页关键词：`视频增强`=0、`超分`=0、`插帧`=0、`转码`=46；VOD 仅转码模板组；**图片**侧有「图像无损放大/图像清晰度增强」（`IMAGEPROCESS`）→ **图片能力，不能用于成片** | — |
| 26 | **火山引擎 / 字节** | **未证实（信息缺口，非确认无）** | 文档站**强反爬**：换 Googlebot/Baiduspider/curl/iPhone UA **全被同一 JS 挑战页挡住**；`sitemap.xml` 404；`/api/docs/search` 返回 `UnauthorizedAccess`；`r.jina.ai` 不可达；官方 Python SDK 目录**无 `vod`/`mps` 模块**（旁证）。🔎 旁证：RunningHub 已上线**火山画质增强**三档（见 7.5）→ 火山确有该能力，但**官方文档与定价未取到** | **未证实** —— **拿到官方接口名前不要写入技术方案** |

### C. 海外（数据出境风险）—— 确有对外开放 API

| # | 厂商 | 文件级视频超分/插帧 API | 关键 slug / 路径 | 调用形态 | 单价（USD） | 大陆节点 |
|---|---|---|---|---|---|---|
| 16 | **Topaz Labs（官方直连）** | **是** | `POST https://api.topazlabs.com/video/` → `PATCH /video/{id}/accept` → S3 `PUT` → `GET /video/{id}/status`；`X-API-Key` | **异步三步 + 轮询** | credit 制：Developer **$0.10/credit**、Scale $0.08、Starter $0.12。**Proteus**：10s@1080p = **2 credits**、1min@1080p = 8、10min@1080p = 76；**Starlight** Quality 12 / Fast 6（10s@1080p）；**Astra** 40；**Frame Interpolation** 1–2；**Denoise** 2–4。**推算**：Proteus 1min@1080p ≈ **$0.64–0.96** | **无**（美国达拉斯） |
| 17 | **fal.ai** | **是（最全）** | `POST https://queue.fal.run/{model_id}` + 轮询 / `?fal_webhook=`；`topaz/upscale/video/precision`、`topaz/upscale/video/generative`、`topaz/interpolate/video`、`fal-ai/bytedance-upscaler/upscale/video`、`fal-ai/flashvsr/upscale/video`、`fal-ai/seedvr/upscale/video`、`fal-ai/rife/video` | **异步 queue + 轮询/webhook**（失败最多重试 10 次） | **最低：`fal-ai/bytedance-upscaler` $0.0072/s @1080p**（2K $0.0144/s、4K $0.0288/s；60fps 翻倍；pro 10×），**`enhancement_preset` 含 `short_series`（短剧）与 `old_film`（老片）**；Topaz Precision **$0.20/10s@1080p**、1min $0.80；Topaz Generative $1.20/10s@1080p；Topaz 补帧 $0.30/10s@1080p（Apollo/Chronos）；Denoise $0.20/10s@1080p；FlashVSR $0.0005/总像素（1080p×121帧=$0.125）；SeedVR $0.001/总像素（=$0.25） | **无**；⚠️ 生成媒体默认以**公开 URL** 存于 fal CDN |
| 18 | **Replicate** | **是** | `POST /v1/predictions` + `GET /v1/predictions/{id}` + `POST .../cancel`；webhook 密钥 `GET /webhooks/default/secret`；`topazlabs/video-upscale`、`lucataco/real-esrgan-video`、`philz1337x/crystal-video-upscaler`、`zsxkib/seedvr2` | **异步 + 轮询/webhook** | Topaz 720p→1080p/30fps **$0.093/5s**、60fps $0.187/5s、4K/30fps $0.373/5s；Real-ESRGAN Video ≈**$0.18/次**；Crystal $0.10–0.30/输出兆像素/秒；SeedVR2 ≈$0.030/次；AnimeSR ≈$0.0033/次；DeOldify 上色 ≈$0.060/次；硬件 T4 $0.000225/s … A100 $0.0014/s | **无** |
| 19 | **PixelBin** | **是**（插件存在） | 插件 **`vsr_upscale`**（`sr_upscale` 为图片） | **未证实**（文档站 JS 渲染） | **未证实** | **无**（印度公司） |

### D. 海外 —— 明确「否」或「未能核实」

| 厂商 | 结论 | 依据 |
|---|---|---|
| **ImageKit** | **否**（无视频超分） | 视频变换仅 resize/crop/trim/overlay/thumbnail/ABR；对超分关键词 grep **0 命中**；sharpen/contrast 属**图片** |
| **Clipchamp**（Microsoft） | **否** | 首页无任何 `api`/`developer` 入口；`Video enhancer` 是网页功能 |
| **VEED / Kapwing / DeepAI** | **未证实** | 本环境 **TCP 全失败（http=000）**，DNS 可解析 |

### E. 开源可自建（无 API，但可商用、无出境风险）

| 项目 | 许可证（LICENSE 原文） | 可商用 | 用途 |
|---|---|---|---|
| **Real-ESRGAN**（`xinntao` / `NightmareAI`） | **BSD 3-Clause** | ✅ | 通用超分（`RealESRGAN_x4plus`、`realesr-animevideov3`） |
| **BasicSR** | **Apache-2.0**（`LICENSE.txt`） | ✅ | 去噪/去块/锐化（NAFNet 等） |
| **Practical-RIFE** | **MIT** | ✅（最宽松） | 补帧 24/30→60fps |
| **Anime4K** / **waifu2x** | **MIT** | ✅ | 动漫/漫剧超分 |
| **FILM** / **SeedVR** / **GFPGAN** | **Apache-2.0**（GFPGAN 含第三方组件例外） | ✅（GFPGAN 需逐项核查） | 补帧 / 视频修复 / 人脸修复 |
| **MMagic**（OpenMMLab，含商汤系 EDVR/BasicVSR++/RealBasicVSR/CAIN/FLAVR） | **Apache-2.0** | ✅ | 视频超分 + 视频插帧 |
| ⚠️ **Video2X** | **AGPL-3.0** | ⚠️ **SaaS 对外提供会触发源码开放义务，不可闭源集成** | — |
| ❌ **SVFR**（`zsxkib/stable-video-face-restoration`） | 页面原文 `Available for non-commercial research purposes only` | ❌ **不可商用** | — |

### F. 给 libtv 的选型排序（基于上述已验证单价，480p→1080p、24–30fps）

| 优先级 | 方案 | 成本（**推算**/官方价） | 关键理由 |
|---|---|---|---|
| ★★★ | **腾讯云 MPS「超分」+「综合增强」** | **0.663 / 1.863 元/分钟**（含转码费） | **最低成本 + 快上线**：1080p/≤30fps 档超分仅 **0.6**；综合增强 **1.8**（去压缩伪影和毛刺同时增强关键细节）。价格公开、**无需工单**、大陆多地域、官方内置**「短剧」场景预设参数** |
| ★★★ | **腾讯云 MPS「漫剧场景-大模型增强-1080P」(327004)** | **≈3.10 元/分钟** | **官方专为「漫剧场景」预置**（另有小脸优化版）；`ProcessMedia` 支持 **URL 直传**；境内；公开定价 |
| ★★★ | **RunningHub `RH视频超分`** | 单价未证实 | 境内；**官方明确「帧间一致性、消除闪烁与伪影」**（AI 生成视频最关键）；**单次 10 分钟**；`targetResolution: "1080p"` 一行参数 |
| ★★ | **阿里云 VIAPI `EnhanceVideoQuality`** | **4 元/分钟**（≤720P 输入/≤30帧） | 一次调用同时完成**超分+插帧+SDR转HDR+抑制块噪声/压缩噪声**；URL 直传；文档最完整 |
| ★★ | **阿里云 IMS `S00000004-401040`** | **≈4.88 元/分钟**@25fps（标准版） | 官方明确「先用模型生成 720P，再用 IMS AI 超分放大到 1080P/4K」的 **AIGC 降本路径**；需在 OSS |
| ★ | **阿里云 VIAPI `SuperResolveVideo`** | **0.4 元/分钟**（≤720P） | **最便宜**，但**输出仅 2 倍**且输入须 <1920×1080 → 480p 只能到 ~1708×960，**达不到标准 1080p** |
| ★ | **腾讯云 MPS「超分」计费项**（不用大模型） | **≈0.80 元/分钟**（0.6 + 0.195 转码） | 纯超分最省，但无大模型修复能力 |
| 备选 | **Topaz 官方直连 / fal.ai** | Proteus ≈$0.64–0.96/min；fal ByteDance **$0.432/min**@1080p30 | 效果天花板最高、fal 单价极低，**但均有数据出境风险** |
| 兜底 | **自建 Real-ESRGAN + Practical-RIFE** | 仅 GPU 成本 | **唯一完全规避出境**且许可证干净（BSD-3 + MIT）；代价是自建推理服务与调参 |

---

## 未证实清单

> 以下均为**本次未抓到官方一手原文**的项，**不得作为决策依据**，需要商务咨询或登录后复核。

### 1. 接口 / 参数层面

| 厂商 | 未证实内容 |
|---|---|
| **美图 AI 开放平台** | ①「视频超清(404)/视频AI超清2.0(420)/视频-画质增强(414)」的**接口路径**（仅确认 `v1/superResolution`、`v1/videoEnhance`、`v1/videoDenoise` 三条路由**存在**，但**不确定 `v1/superResolution` 对应图片还是视频**）；②全部**请求参数名与枚举**；③输入限制（时长/分辨率/格式/大小）；④是否支持 URL 直传；⑤具体单价 |
| **腾讯云 MPS** | ①各模板的**时长/文件大小上限**；②`ProcessMedia` 的 QPS/并发限制；③「漫剧场景」模板与「真人场景」模板的效果差异说明；④企业版 MPSE 的报价 |
| **阿里云 IMS 音画增强** | ①音画增强的**工单开通门槛**（企业认证？）②是否有按分钟/包年套餐；③海外地域是否可用（增强定价表仅「以中国内地为例」） |
| **阿里云 VIAPI** | ①`SuperResolveVideo` 是否可**超过 2 倍**（文档明确 2 倍，但未说明能否串联）②各能力的 QPS 上限（除资源包标注的 2QPS）③`EnhanceVideoQuality` 的输出分辨率上限与时长上限 |
| **RunningHub** | ①**每个接口的具体单价**（价格页交互式加载）②`targetResolution` 的**完整可选值枚举** ③`video-fps-increaser` 的参数细节 ④**Topaz 模型是否在境内推理**、生成媒体留存策略 ⑤企业认证要求 |
| **牛学长 / 牛小影** | ①接口路径与签名方式 ②请求/回调参数 ③全部输入限制 ④价格（元/分钟 或 元/次）⑤私有化部署报价 |
| **微帧 Visionular** | ①「帧彩视界」超分/插帧的**云 API 端点**（公开文档只有转码与直播）②调用形态 ③输入限制 ④价格 |
| **商汤 SenseTime** | ①SenseFoundry 方舟「算法商城」是否上架视频超分算法 ②是否有商务定制的私有化「视频增强/超分」交付 ③SenseME/TetrasMobile Video 的具体能力边界 |
| **影谱科技 Moviebook** | ①公司是否仍在运营、官网现址（**全部域名 DNS 失败**）②是否有「AI 视频增强」产品 ③是否有开放 API 或私有化交付 |
| **相芯 FaceUnity** | AvatarX 数字人云平台的接口清单（飞书 Wiki 需登录）；是否有超分类接口 |
| **虹软 ArcSoft** | 增值版 / LINUX PRO / ARM PRO 的授权单价；是否可商务定制云端文件级超分 |
| **中科视语** | 全部（官网 HTTPS 不可用、API 维护中、前端产物零命中） |
| **海康 Hikvision** | ①是否有未上架的商品/商务定制算法 ②「观澜大模型」是否有对外 API（现为产品能力，二手来源） |
| **大华 Dahua** | ①是否有未公开的超分增值服务 ②`cloud.dahuatech.com` 全系域名不可达（HTTP:000） |
| **PixelBin** | `vsr_upscale` 插件的**参数表、调用形态、单价**（文档站 JS 渲染）；`docs.pixelbin.io` 404 |
| **VEED / Kapwing / DeepAI** | 是否有视频超分 API（**本环境 TCP 全失败 http=000，未能核实**） |
| **OpenMMLab / 上海人工智能实验室** | ①是否有官方商用云 API 或商业版授权 ②OpenXLab（浦源）是否上架 MMagic 推理 API |
| **万兴科技 · 天幕 AILab** | ①**API 单价**（官方 FAQ 仅说「需付费，在【购买页】购买」；`/price`、`/pricing`、`/buy`、`/console` 均 404）②视频类接口的时长/分辨率/体积上限（文档未公开）③`创建任务` 返回的 `status` 码语义在不同接口文档中**不一致**（1 既表"等待中"又表"成功"） |
| **万兴 · Media.io** | 是否有官方 REST API（**大陆不可直连**，DNS 污染 + 超时；wondershare.com 无 API 入口） |
| **出门问问 Mobvoi** | 开放平台的**接口路径与各能力单价**（文档正文需登录；仅见「克隆声音 API 100元/100w字符」，与本需求无关） |
| **火山引擎 / 字节** | **全部未证实** —— 是否有视频增强 API、接口名、调用形态、输入限制、单价（文档站强反爬，多种 UA 均被 JS 挑战页拦截）。**属信息缺口，非确认无能力** |
| **腾讯云 CI** | ①「提交画质增强任务」页面的**具体 URL 与任务侧 `Tag` 字面值**（模板侧 `Tag=VideoEnhance` 已证实；接口确实存在于官方接口列表）②各增强节点的完整参数枚举 |
| **腾讯云 MPS** | `CreateTranscodeTemplate` 中**增强参数的确切 JSON 字段名**（页面示例被抓取截断；完整 API 文档疑在 `/document/api/862/37605` 未抓正文）。→ **可先用控制台建模板拿 TemplateId 绕开** |
| **硅基智能** | `guiji.ai` / `guiji.cn` 主站不可达，**未能核实**是否存在视频增强类开放 API |
| **OpenXLab（浦源）** | 是否存在**非公开的模型推理 API**（文档主题仅含平台介绍/登录/数据集/PythonSDK/Streamlit 配置；`/docs/*` 多个路径 404） |
| **DeepLang 深言科技** | 是否有任何视频/图像能力（官网仅文本产品，无开放平台入口 → 判否，但未见官方「无视频能力」的明示声明） |

### 2. 价格层面 —— 明确「官方未公开」

- **美图**：仅申请制「价格确认」，官方无定价页。
- **牛学长 / 牛小影**：仅咨询表单。
- **微帧 Visionular**：仅「申请试用」。
- **相芯 / 虹软 / 中科视语 / 海康**：全无公开定价。
- **腾讯云 MPSE 企业版**：报价定制（工单 → 需求评估 → 个性化方案及报价）。
- **RunningHub 各接口单价**：价格页异步加载，未取到。
- **Topaz Enterprise / on-premise**：「Let's talk」，量价面议。
- **fal.ai 部分模型**：`bria/video/increase-resolution`、`fal-ai/video-upscaler`、`fal-ai/amt-interpolation` 的 `pricingInfoOverride` 为 `None`。

### 3. 仅二手来源（**可信度低，不可作决策依据**）

| 内容 | 来源 | 可信度 |
|---|---|---|
| 美图「2万次调用 ￥20,000」 | 雪球帖 https://xueqiu.com/1909276603/331998659 | 低（无法确认适用于视频超清） |
| 腾讯云 MPSE 提供「音画增强 / 老片 4K 修复」 | 腾讯云开发者社区 UGC 文章 https://cloud.tencent.com/developer/article/2682447 （2026-06-04） | 中低（UGC） |
| 影谱科技「Video AI 生产引擎」 | 头条 https://www.toutiao.com/article/6647713943445832206/ （**2019-01-18**）等 | 低（时间久、无 API 证据） |
| 中科视语技术方向（智慧交通/昇腾合作/道路病害一体机/PhysVLM） | 百度检索摘要 + 百科 | 中低（未抓官方原文） |
| 海康「视觉大模型/观澜大模型」 | 媒体稿 | 中（落点在硬件产品） |
| Topaz 中国「官方授权代理商」 | `topaz-video.apsgo.com` 等经销商页 | 低（仅桌面版售卖，无 API 代理） |
| 商汤 MMSR / EDVR 视频超分开源 | CSDN 博客 | 中（已由 OpenMMLab MMagic README 官方交叉印证） |

### 4. 输入限制层面 —— 已抓到的硬限制（汇总，便于选型）

| 平台 | 已确证的输入限制 |
|---|---|
| **阿里云 VIAPI `SuperResolveVideo`** | ≤1GB；MP4/AVI/MKV/MOV/FLV/TS/MPG/MXF；**>360×360 且 <1920×1080**；输出仅 **2 倍**；结果 URL **30 分钟有效** |
| **Topaz 官方直连** | 文件 **<100GB**（multipart ≤150 段）；**文档无时长上限**；20+ 容器；429 需退避；视频 GAN 超时 ~4h / 生成式 ~17h（超时**全额退款**）；**500MB 上限不存在**（该 500MB 是另一处口径，见 3.3——以 `<100GB` 为准，**两处口径不同已如实并列**） |
| **fal.ai `blackforestlabs/flux-video-upscale`** | **≤20s 且 ≤50MB** |
| **fal.ai `bria/video/increase-resolution`** | 尺寸 <7680×4320 且**时长 <30s** |
| **fal.ai `clarityai/crystal-video-upscaler`** | 输出**不得超过 5K** |
| **RunningHub `RH视频超分`** | **单次最高 10 分钟** |
| **腾讯云 MPS** | 支持 URL/COS 输入；**时长与大小上限未证实** |
| **阿里云 IMS 音画增强** | 输入输出**必须在 OSS**；输出固定 1080P 或 4K |
| **Replicate `lucataco/real-esrgan-video`** | **仅 MP4，且文件名不能含空格** |
| **Replicate `topazlabs/video-upscale`** | `target_fps` **15–60fps**；`target_resolution` ∈ {720p, 1080p, 4k} |

> ⚠️ **关于 Topaz 文件体积的两种口径**：官方视频快速开始页「API Restrictions」写 **500MB → HTTP 413**；而经开发者文档 GitBook 问答得到的口径是 `source.size must be less than 100 GB`（大文件走 multipart）。**两处口径不一致，已如实并列，上线前必须实测确认。**

### 5. 工具与环境限制（影响复现）

- 内置 `web_search` **全程不可用**（返回 **HTTP 402 Insufficient Balance**）；**Bing 结果被严重过滤**（实测 `site:volcengine.com 视频增强` 查询被**忽略**，返回通用视频站）；**百度 `www.baidu.com/s` 触发「百度安全验证」**（返回 1488 字节验证页，多轮均如此）→ **改用 `m.baidu.com/s?word=` 可用**；**360 搜索 `www.so.com/s` 可用但会间歇性触发 `qcaptcha.so.com` 限流**；DuckDuckGo（html/lite）、`r.jina.ai`、Mojeek、searx、Yandex、Sogou、`grep.app` **全部不可用**；`web.archive.org`（含 CDX API）**超时或返回空**。
- → 全部结论改为**直接 curl 官方站点/接口**取得；搜索引擎仅用于发现 URL，相关线索一律标注二手。
- **DNS 失败**：`www.moviebook.cn`、`moviebook.cn`、`ai.moviebook.cn`（**SERVFAIL**；whois 显示有效至 2027-11-13）、`ai.mobvoi.com`、`mediaio.io`、`open.meitu.com`、`open.sensetime.com`、`visiquest.cn` 全变体。
- **TCP 全失败（http=000）**：`deepai.org`、`www.veed.io`、`developers.veed.io`、`www.kapwing.com`、`guiji.ai`/`guiji.cn`、`open.real-ai.cn`、`openmmlab.com`、`cloud.dahuatech.com`、`https://www.objecteye.com/`。
- **media.io 特殊性**：其域名 **DNS 污染到 Meta/Twitter/Dropbox 网段**（`www` → 31.13.95.48 等），直连 80/443 亦超时 → **从中国大陆完全无法抓取任何页面**。
- **需完整浏览器头才 200（WAF）**：`https://open.hikvision.com/`（普通 UA → **HTTP 403**，openresty）；`https://open.cloud-dahua.com/price`（精简壳 → 完整头才返回价目表）。
- **反爬挑战页（多 UA 均无效）**：`www.volcengine.com/docs/*`（换 Googlebot / Baiduspider / curl / iPhone UA **全部命中同一 JS 挑战页**，约 3.5KB 无正文；`web_fetch` 亦返回 "Please wait..."）；`portal.volccdn.com` 的 remoteEntry（文件名带哈希）**404**。
- **`web_fetch` 可绕过 curl 被拦的站点**（重要技巧）：`support.huaweicloud.com/*`（**华为云**）对 curl 返回**腾讯 EdgeOne 验证码页**（2,189 字节 "Security Verification"），**改用 `web_fetch` 工具可成功抓取**。
- **被服务端返回主站 HTML 导致无法读取配置**：`ailab.wondershare.cn/doc/assets/js/*.js`（VuePress 侧边栏配置读不到 → 改用**逐页探测 700+ 候选路径**枚举）。
- **SPA 正文需登录/JS 渲染**：`replicate.com/docs/*`、`openapi.mobvoi.com/document`、`ai.meitu.com/doc/?id=*`（均返回相同壳页）。
- **macOS 无 `timeout` 命令**，应使用 `curl -m`。
- **GitHub API 限流**：`api.github.com/repos/open-mmlab/mmagic` → rate limit exceeded（改用 `raw.githubusercontent.com` 直取）。