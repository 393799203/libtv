# 01 · Topaz Labs 专项调研：产品能力、API 化接入路径与同类桌面软件

> 项目：libtv（漫剧/短剧 AI 视频生成平台，Go 后端 + React 前端）
> 需求：把生成的 **480p 成片**做「清晰化」——超分到 720p/1080p、去噪/锐化/修复；以及**补帧**（24/30fps → 60fps，做慢动作或更流畅）
> 调研日期：**2026-10-04**（本报告所有「抓取日期」均为 2026-10-04）
> 汇率假设：**1 USD ≈ 7.1 CNY**（仅用于量级换算，非实时汇率）

> ### ⚠️ 关于「中国大陆可访问性」的重要说明（**本报告的一个核心优势**）
>
> **本次全部调研的网络出口位于中国大陆**：实测 `https://ipinfo.io/json` 返回
> `{"ip":"124.90.21.177","city":"Hangzhou","region":"Zhejiang","country":"CN","org":"AS4837 CHINA UNICOM China169 Backbone"}`。
>
> 这意味着：**本报告中所有对 `topazlabs.com` / `developer.topazlabs.com` / `api.topazlabs.com` / `docs.topazlabs.com` / `fal.ai` / `replicate.com` / `docs.freepik.com` 的成功抓取，都是「在中国大陆网络环境下直连成功」的实证** —— 不需要代理。
> 这对本项目是**直接可用的结论**，而不是需要另行验证的假设。
>
> 但请注意两点限定：①只能证明**HTTP 抓取与 API 短请求**可达，**长时大文件上传/下载的稳定性未测**；②并发同事的另一份报告（`04-hosted-apis-and-gpu-cloud.md`）曾记录其出口为美国 LAX，**两份报告的网络环境可能不同**，凡涉及延迟/可达性的结论**以本报告（杭州联通）为准**。

---

## 0. 调研方法与证据等级说明

内置 `web_search` 工具在本次会话不可用（上游余额不足），全部检索改走 `curl` + Bing 中国站 + 直接抓官方站点。

**一个关键的意外收获**：Topaz 官方 API 文档站（`developer.topazlabs.com`）是 **GitBook** 托管的，它有三个对调研极其有用的特性：

1. **任意文档页 URL 追加 `.md` 即得 Markdown 原文**（无导航噪音），例如
   `https://developer.topazlabs.com/getting-started/model-pricing.md`
2. **完整索引** `https://developer.topazlabs.com/llms.txt`
3. **动态问答**：`<page>.md?ask=<问题>&goal=<目标>` 会返回**直接答案 + 出处链接**。本报告中标注为【实证-问答】的结论即由此获得；由于该机制由 GitBook 侧生成，**我将其证据等级排在「原文引用」之下**，凡能从页面原文/OpenAPI 原文得到的，一律优先用原文。

另外还拿到了两份**官方结构化数据**，是本报告价格与模型 id 的主要依据：

| 数据源 | URL | 说明 |
|---|---|---|
| **官方 Video API OpenAPI 3.0.3 规范**（84,964 字节） | `https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/video-12-25-updated.yaml`（入口页 `/reference/openapi-specs/readme`） | 全部端点、参数枚举、硬约束的权威来源 |
| **官方 credit 计算器的主价格表 CSV**（397 行） | `https://hebbkx1anhila5yf.public.blob.vercel-storage.com/master_price_table-dccnxGID3lbiE98svUZkCXHqT8nIZl.csv`（由 `developer.topazlabs.com/credit-calculator` 页面 JS 在运行时 fetch） | 按「源分辨率-帧率 × 输出分辨率/帧率/慢放倍数」给出 credits/秒 |
| **官方系统实时状态接口**（无需鉴权） | `https://api.topazlabs.com/video/status` | 返回当前**实际支持**的模型 id 列表（权威） |

证据等级约定：

| 等级 | 含义 |
|---|---|
| **【实证-原文】** | 抓取到官方页面/规范/接口原文，引用了原文数字 |
| **【实证-接口】** | 通过官方公开接口拿到的结构化数据（如 `/video/status`、官方 CSV） |
| **【实证-问答】** | 官方文档 `?ask=` 动态问答返回（有出处，但为生成式回答，谨慎对待） |
| **【同事核实】** | 由并行调研同事抓取并交叉确认，本报告未二次抓取 |
| **【推算】** | 基于【实证】单价 + 明确写出的假设做算术推导 |
| **【未证实】** | 未取得硬证据；**不得作为决策依据** |

---

## 1. Topaz Labs 2026 年产品线与能力

### 1.1 产品矩阵【实证-原文】

来源：`https://www.topazlabs.com/`、`https://www.topazlabs.com/api`、`https://www.topazlabs.com/topaz-video`（抓取日 2026-10-04）

| 产品 | 形态 | 官方定位（原文要点） | 价格（抓取日页面价） |
|---|---|---|---|
| **Topaz Video** | 桌面 Win/macOS | "Cinematic-Grade Video Quality Enhancement Software"；本地渲染 + 云渲染 | **$59/mo** |
| **Topaz Photo** | 桌面 | 图像增强（摄影师向） | 见 Studio 套餐 |
| **Topaz Gigapixel** | 桌面 | 图像放大 **最高 16× 像素** | 见 Studio 套餐 |
| **Topaz Studio** | 套餐 | 含 Topaz Video / Photo / Gigapixel / Mobile / Web | **$399/yr**（约 $34/mo） |
| **Topaz for Web – Image** | 云（浏览器） | 网页版图像增强 | $19 → $12/mo（促销价） |
| **Topaz for Web – Video** | 云（浏览器） | 网页版视频工作流：**Precision Upscale、Creative Upscale、Frame Interpolation、Slow Motion、SDR to HDR**；**200 月度 cloud video credits**；并发 2 | $29 → $19/mo |
| **Astra** | 云（浏览器） | "Standard AI video enhancement **up to 4K**"；**400 credits/mo ≈ 增强约 10 分钟 HD 视频**；额外 credits **$0.10/个** | $39 → $19/mo |
| **Topaz for Mobile** | iOS | 移动端，导出上限 32MP | 含套餐 |
| **Enterprise** | 企业 | "Pro and commercial use. Custom solutions." | 联系销售 |
| **API** | REST | "Image and Video Upscaling API" | 见 §2.5 |
| **Starlight**（Solution 页） | 云/企业 | 面向企业生产工作流 | 联系销售 |

页面上出现的**AI 模型品牌**（页脚 "AI Models" 区）：`Starlight Precise 2.5 (Cloud)`、`Starlight Precise 2.5 (Desktop)`、`Wonder 3 (Cloud)`、`Wonder 3 (Desktop)`、`Astra 2`。

> ⚠️ 商业使用许可的一个重要限定（桌面版与网页版套餐页均以小字标注）：
> **"Personal and commercial use for orgs under $1M USD annual revenue."**
> 即：**年营收 ≥ 100 万美元的组织需要 Pro 订阅才能商用**（见 §2.7）。

### 1.2 视频 AI 模型全清单与能力分工

Topaz 官方把视频模型分成三大「家族类型」【实证-原文，`/getting-started/introduction.md`】：

| 类型 | 语义（原文） | 视频模型 |
|---|---|---|
| **Precision**（精确） | "improve quality while preserving original source characteristics" | Proteus、Proteus Natural、Rhea、Theia、Artemis、Dione、Gaia、Iris |
| **Generative**（生成式） | "intelligently adding detail and texture while preserving artistic intent" | Starlight 全系 |
| **Creative**（创意） | "add new levels of detail that can transform objects, identity, and stylization" | Astra |
| 其他 | Sharpen / Denoise / Utilities | Nyx 系、Themis、Hyperion、Video Colorization、去物体 |

**按「你需要的功能」重新归类**（这才是选型时要看的）：

#### A. 视频超分（Upscale）

| 模型 | 代码 | 家族 | 官方特点 |
|---|---|---|---|
| **Proteus** | `prob-4` | Precision | "The default choice for video enhancement"，通用首选 |
| **Proteus Natural** | `pnat-1` | Precision | 下一代自然增强 |
| **Rhea** | `rhea-1` | Precision | **高保真 4× 超分**，细细节 |
| **Theia** | `thd-3` / `thf-4` | Precision | 手动清晰度/细节控制（Fine Tune Detail / Fidelity） |
| **Artemis** | `ahq-12` / `alq-13` / `alqs-2` / `amq-13` / `amqs-2` | Precision | 平衡去噪+锐化；含 Aliasing/Moire 分支 |
| **Dione** | `ddv-3` / `dtv-4` / `dtd-4` / `dtds-2` / `dtvs-2` | Precision | 隔行/telecine 源专用 |
| **Gaia** | `ghq-5` / `gcg-5` | Precision | CG 向 |
| **Gaia 2 (Animation)** | `ganim-1` | Precision | **动画专用，2× 模型，约半价** |
| **Iris** | `iris-2` / `iris-3` | Precision | 人脸/人物向 |
| **Starlight Precise 2.6** | `slp-2.6` | Generative | **扩散模型超分，官方推荐用于 GenAI 视频与档案片，可到 4K** |
| **Starlight HQ** | `slhq-1` | Generative | **明确支持 480p–4K 输入** |
| **Starlight Mini** | `slm-1` | Generative | **面向标清（SD）/退化素材**，可自动去隔行 |
| **Starlight Fast 2 / 3** | `slf-2` / `slf-3` | Generative | 速度优先 |
| **Starlight Sharp** | （已弃用，`wonder-1`） | Generative | **仅 1080p 输出，不支持 4K** |
| **Astra Creative** | `slc-1` | Creative | 生成式造细节 |
| **Astra 2** | `ast-2` | Creative | 生成式、可用 prompt 引导，会**吸附到自己的输出分辨率（通常 4K）** |

#### B. 帧插值 / 补帧 / 慢动作（Frame Interpolation）

**这是你「24/30 → 60fps」需求对应的模型族**【实证-原文，`/video-models/frame-interpolation.md`】：

| 模型 | 代码 | 官方定位 | 计费（credits 每新生成 GP） |
|---|---|---|---|
| **Aion** | `aion-1` | "Extreme slow motion for complex, high-resolution motion"；精度最高、最耗资源 | **6** |
| **Apollo** | `apo-8` | "non-linear motion and slightly blurry inputs"，生成 8 帧插值后合成目标帧率，比 Chronos 快；官方标注 **[Recommended]** | **2** |
| **Apollo Fast** | `apf-2` | 比 Apollo 更快，大运动时质量略降 | **1** |
| **Chronos** | `chr-2` | 通用帧率转换/慢动作，速度随生成帧数线性下降；≤4× 慢放效果好 | **2** |
| **Chronos Fast** | `chf-3` | 擅长帧间大变化、快速运动 | **1** |

官方**逐模型真实计价表**（估算基准 **10s @30fps**）【实证-原文，`/video-models/frame-interpolation/apollo.md`、`/aion.md`】：

| 慢放倍数 | Apollo / Chronos @1080p | Apollo / Chronos @4K | Aion @1080p | Aion @4K |
|---|---|---|---|---|
| **2×** | 1 | 5 | 4 | 15 |
| **4×** | 4 | 15 | 11 | 45 |
| **8×** | 9 | 35 | 26 | 105 |
| **16×** | 19 | 75 | 56 | 224 |

> 官方原文：*"Apollo costs 2 credits per new GP generated. Apollo Fast costs 1 credit per new GP generated."*（"GP" 为该家族的计费单位；Aion 为 6 credits/GP。）

**桌面版对这几个模型的定性说明**（对选型有实际帮助）【实证-原文，`https://docs.topazlabs.com/topaz-video/filters/frame-interpolation`】：
- **Apollo**："Generates 8 interpolated frames per run... Use when you need exactly 2x, 4x, or 8x frame count multiple."
- **Apollo Fast**："Recommended for use for any **non-double conversions**. For example, **24fps -> 29.97 or 60**." ← **你的 24→60 属于此列**
- **Aion**："More accurate than Apollo and Chronos, but more system-intensive."
- ⚠️ 重要限制（原文）：*"Frame interpolation is only applied to the video. **The audio will not be modified by this enhancement and will be removed from the video.**"* → **补帧会丢音轨，必须后期用 ffmpeg 合并回原音轨。**

#### C. 去噪 / 其它修复

| 模型 | 代码 | 说明 |
|---|---|---|
| **Nyx** / **Nyx Fast** / **Nyx XL** / **Nyx High Fidelity** | `nyx-3` / `nxf-1` / `nxl-1` / `nxhf-1` | 去噪；Nyx HF 可导出 noise pass |
| **Themis 2 (Motion Deblur)** | `thm-2` | 运动去模糊 |
| **Hyperion / 2 / 2.5 (SDR→HDR)** | `hyp-1` / `hyp-2` | SDR 转 HDR，8-bit GenAI → 10/16-bit |
| **Video Colorization** | `color-1` | 黑白上色 |
| **Video Foreground Object Removal** | `remove-1` | 去前景物体 |
| 稳定 / 旋转裁切等 | `stab-1` 等 | 稳定；**注意：稳定与 SDR→HDR 不支持桌面版云渲染** |

#### D. 稳定（Stabilization）与「上采样倍数」

- **稳定**：桌面版有 Stabilization 滤波器【实证-原文，docs 侧边栏 `/topaz-video/filters/stabilization`】；**API 是否暴露稳定端点：未证实**（`/video/status` 的当前模型列表中未见稳定的独立代码，`stab-1` 只出现在 OpenAPI 的枚举里）。
- **上采样倍数**：**Topaz 的 API 没有 `upscaleFactor` 参数**。官方文档明确：*"There is no documented `upscaleFactor` parameter. Set the target dimensions in `output.resolution`"*【实证-问答】。官方 OpenAPI 的 `UpscaleFilter` 里**只有 `model` 是必填**，没有任何倍数/尺寸字段【实证-原文】。
  - 例外：**桌面版 CLI 的 `tvai_up` 滤镜有 `scale=` 参数**（如 `scale=2`）；**fal.ai 托管版**有 `upscale_factor`（默认 2）【同事核实】。
  - 另外：*"`resolution` is forced to the source resolution when no upscale model is present in `filters`"*【实证-原文，OpenAPI 规范内注释】——即不指定超分模型时，输出分辨率被强制等于源分辨率。
  - **Gaia 2 (Animation) 是 2× 模型**，`480p→1080p` 是 **2.25×**，因此**单靠 Gaia 2 到不了 1080p**【实证-问答】。

### 1.3 「480p 输入」的官方支持情况

| 结论 | 证据 |
|---|---|
| **480p 输入是支持的**，但**逐模型而异** | 【实证-问答】：*"Yes, 480p input is supported by some models, including Starlight HQ, which supports inputs from 480p through 4K. Starlight Mini is also intended for standard-definition footage."* |
| **Starlight HQ 明确支持 480p–4K** | `/video-models/starlight/starlight-hq.md` |
| **Starlight Mini 面向 SD/退化素材**，可自动去隔行 | `/video-models/starlight/starlight-mini.md` |
| **没有「最低输入分辨率」的通用门槛** | 【实证-问答】：*"No general minimum is specified; input support is model-specific."* |
| **官方对「480p→1080p 的 GenAI 动画短剧」的推荐顺序** | 【实证-问答】：首选 **Starlight Precise 2.6**（面向 GenAI 视频、时序一致性优先）；保风格对比用 **Gaia 2**；**Proteus** 作为低中质量/压缩素材的精确型兜底 |

---

## 2. Topaz 官方 API（核心结论：**存在，且在运营中**）

### 2.1 存在性与历史脉络

| 问题 | 结论 | 证据 URL |
|---|---|---|
| 官网现在有 API 或 Cloud/Enterprise 产品页吗？ | **有。** `https://www.topazlabs.com/api` 标题为 "Video / Image Upscaling & Enhancement API"，页面含完整定价与「Start now / API Documentation」CTA，并称 **3M+ 用户、月请求 3 million+、已增强 7.5M 张图 / 2.3M 个视频** | https://www.topazlabs.com/api（抓取 2026-10-04） |
| 文档站 | **`https://developer.topazlabs.com/`**（GitBook），含 Developer Guide + API Reference + API Playground（`https://playground.topazlabs.com/`） | 同上 |
| 历史域名 `api.topazlabs.com` 还在吗？ | **是同一个，且是当前的正式生产域名。** OpenAPI 规范中 `servers: - url: https://api.topazlabs.com (Production API base URL)` | OpenAPI 规范原文 |
| `https://api.topazlabs.com/`（根路径） | 返回 **404**（正常——根路径未挂路由，业务路由在 `/video/*`、`/image/*`） | 本次实测 |
| 文档页 `/api/docs` | 404（真实入口是 `developer.topazlabs.com` + `openapi.gitbook.com` 的 YAML） | 本次实测 |
| 是否有图片 API | **有**，与视频 API 并列（Enhance / Sharpen / Denoise / Restore / Lighting / Matting / Tool / Estimate / Cancel / Download） | `/reference/image/*`、OpenAPI image-yaml-feb-2026 |

> **一个可复用的工程事实**：`GET https://api.topazlabs.com/video/status` **无需 API Key**，可直接用于健康检查与"当前支持的模型列表"探测。本次实测返回 `HTTP 200`：
> ```json
> {"isAvailable":true,"availabilityMessage":"System is available",
>  "supportedModels":["aaa-9","aaa-10","ahq-12","aion-1","alq-13","alqs-2","amq-13","amqs-2","apf-2","apo-8","ast-2","chf-3","chr-2","color-1","ddv-3","dtd-4","dtds-2","dtv-4","dtvs-2","ganim-1","gcg-5","ghq-5","hyp-1","hyp-2","iris-2","iris-3","nxf-1","nxhf-1","nxl-1","nyx-3","pnat-1","prob-4","remove-1","rhea-1","sl-1","slc-1","slf-1","slf-2","slf-3","slhq-1","slm-1","slp-2","slp-2.5","slp-2.6","stab-1","thd-3","thf-4","thm-2","wonder-1"],
>  "isFrameInterpolationSupported":true}
> ```
> **共 50 个模型**（抓取日 2026-10-04）。官方明确说明：*"`supportedModels` is the authoritative list of models the system currently accepts. It may include models beyond those enumerated in the filter schemas of this document."*

### 2.2 完整调用链（异步、多段上传）

来源：`https://developer.topazlabs.com/getting-started/video-quickstart` + OpenAPI 规范

```
1) POST  https://api.topazlabs.com/video/                    创建请求 → 返回 requestId
2) PATCH https://api.topazlabs.com/video/{requestId}/accept  接受报价 → 返回 S3 预签名上传 URL(s)
3) PUT   <S3_UPLOAD_URL>  --upload-file video.mp4            上传（Content-Type: video/mp4）→ 拿 eTag
4) PATCH .../video/{requestId}/complete-upload               带 uploadResults[{partNum, eTag}] → 开始处理
5) GET   .../video/{requestId}/status                        轮询 → complete 后返回下载链接
```

其它可用端点【实证-原文，OpenAPI `paths`】：
`/video/express`（免上传，直接用 `source.external` 拉取）、`/video/{requestId}`、`/video/{requestId}/cancel-estimate`、`/video/{requestId}/media`、`/video/{requestId}/metrics`、`/video/history`。

鉴权：**HTTP 头 `X-API-Key: <你的key>`**。API Key 在账号后台 `https://account.topazlabs.com/manage-api` 创建，**仅创建时可见一次**。

**与我们后端架构高度相关的三个能力**（都在 OpenAPI 规范原文中）：

| 能力 | 说明 | 原文位置 |
|---|---|---|
| **Webhook** | 请求体可带 `notifications.webhookUrl`，Topaz **在成功完成与处理失败时都会 POST 通知** | OpenAPI `notifications` schema：*"Webhooks are sent on successful completions and processing failures."* |
| **`source.external`** | 传入 S3 预签名 URL，**Topaz 自己拉源文件，不返回 uploadId/uploadUrls，credit 立即预留并马上开始处理** → 省掉我们的上传步骤 | OpenAPI：*"If `source.external` is provided, the system fetches the source itself: no `uploadId` or `uploadUrls` are returned, credits are reserved immediately, and processing begins right away."* |
| **`destination.external`** | 让 Topaz 把成品直接写入我们自己的 S3（预签名 URL），省掉我们下载再转存 | OpenAPI 规范 |
| **成本/耗时预估** | 接口返回 `estimates`：**credits 成本区间 + 秒级耗时区间**，且官方说明 **"the lower-bound estimate is billed"**（按下限计费）→ 适合我们做「先预扣、后按实结算」 | 【实证-问答】+ OpenAPI `InitialEstimates` |

### 2.3 `filters` 参数语义（含「超分 + 插帧能否串一次」）

**答案：能，一次请求可同时串超分与插帧。**【实证-问答，出处指向 `/reference/video/create-express-request/create-express-video-request.md`】

OpenAPI 原文：`InputFilters` 是 **数组**，元素 `anyOf: [UpscaleFilter, FrameInterpolationFilter]`。

| Filter | 参数 | 语义 |
|---|---|---|
| **UpscaleFilter** | `model`（**必填**） | 只有模型代码；**无倍率参数**，目标尺寸由 `output.resolution` 决定 |
| | 其它可选项 | `videoType`、`auto`、`fieldOrder`、`focusFixLevel`、`compression`、`details`、`prenoise`、`noise`、`halo`、`preblur`、`blur`、`grain`、`grainSize`、`recoverOriginalDetailValue` 等 |
| **FrameInterpolationFilter** | `model`（必填） | `aion-1` / `apf-2` / `apo-8` / `chf-3` / `chr-2` |
| | `slowmo` | **整数 1–16**；"value of 2 makes the output twice as slow and **doubles the duration**" |
| | `fps` | **数值 15–240**；"Output frame rate, **does not increase duration**"（→ **只提帧率、不变时长，就是你要的 30→60fps**） |
| | `duplicate` | 布尔，分析并移除重复帧 |
| | `duplicateThreshold` | 数值 0.001–0.1，重复帧检测灵敏度 |

**官方给出的「480p 风格 → 1080p + 60fps 一次搞定」请求体**【实证-问答】：

**结论（实测问答）**：
- **可以串 3 个甚至更多 filter**：`filters` 是数组，**schema 未规定最大元素个数**。官方示例给出「去噪 → 超分 → 插帧」三段式：
  ```json
  "filters": [
    { "model": "nyx-3" },
    { "model": "prob-4" },
    { "model": "apo-8", "fps": 60 }
  ]
  ```
- ⚠️ **但官方「未文档化处理顺序，也不保证按数组顺序执行」**（原文：*"It does not document the processing order or guarantee that filters run in array order."*）→ **如果我们依赖「先去噪再超分」的语义，必须先做小样验证实际效果，不能假定顺序**。
- 请求体 **3000 字节上限**是约束 filter 数量的现实因素。

```json
{
  "source": { "container": "mp4" },
  "filters": [
    { "model": "prob-4" },
    { "model": "apo-8", "fps": 60 }
  ],
  "output": {
    "resolution": { "width": 1920, "height": 1080 },
    "frameRate": 60,
    "audioTransfer": "None"
  }
}
```

（上述两段 filter 示例均为官方文档给出的形态。）

**输出侧参数**（OpenAPI 原文）：

| 参数 | 取值 | 备注 |
|---|---|---|
| `output.resolution` | `{width, height}` | **宽度上限取决于编码器**：H.264 **4096**、H.265 **8192**、ProRes **16386**、AV1 **16384**、VP9 **8192**；分辨率**向上取整到 4 的倍数** |
| `output.videoEncoder` | H264 / H265 / ProRes / AV1 / VP9 / … | 默认 **H265 / Main10** |
| `output.container` | mp4 / mov / mkv / avi / webm（还有 DPX/EXR/PNG/TIFF 等图像序列） | 默认 **mp4**；ProRes 会被强制为 mov，AV1/VP9 强制为 mp4 |
| `output.frameRate` | 数值 | **不带插帧模型时被强制等于源帧率** |
| `output.audioTransfer` | `Copy` / `Convert` / `None` | **用 Copy/Convert 时必须给 `output.audioCodec`** |
| `output.audioCodec` | AAC / AC3 / PCM | |
| `output.dynamicCompressionLevel` | Low / Mid / High | 默认 **High**；与 `videoBitrate` 互斥 |
| `output.cropToFit` / `videoProfile` / `videoBitrate` | — | VP9 **必须**给 `videoBitrate` |

> **音轨结论**：官方 API **支持保留原始音频**（`audioTransfer: "Copy"`）。这一点**优于**桌面版本的帧插值滤波器（后者明确会移除音频），也优于多数第三方托管端点。

### 2.4 模型 id 全表（按用途归类）

以下 id 均来自**实测的 `/video/status`（50 个）+ OpenAPI 枚举**，是本项目可直接使用的权威清单：

**超分（Precision）**
`prob-4`(Proteus)、`pnat-1`(Proteus Natural)、`rhea-1`(Rhea)、`thd-3`+`thf-4`(Theia)、`ahq-12`+`alq-13`+`alqs-2`+`amq-13`+`amqs-2`(Artemis)、`ghq-5`+`gcg-5`(Gaia)、`ganim-1`(**Gaia 2 Animation，2×，半价**)、`iris-2`+`iris-3`(Iris)、`ddv-3`+`dtv-4`+`dtd-4`+`dtds-2`+`dtvs-2`(Dione)、`aaa-9`+`aaa-10`

**超分（Generative / Creative）**
`sl-1`、`slp-2`、`slp-2.5`(已弃用)、`slp-2.6`(**Starlight Precise 2.6**)、`slhq-1`、`slm-1`、`slf-1`、`slf-2`、`slf-3`、`wonder-1`(旧 Starlight Sharp)、`slc-1`(**Astra Creative**)、`ast-2`(**Astra 2**)

**帧插值**
`aion-1`、`apo-8`、`apf-2`、`chr-2`、`chf-3`

**去噪**
`nyx-3`、`nxf-1`、`nxl-1`、`nxhf-1`

**工具**
`thm-2`(Themis 2 去运动模糊)、`hyp-1`+`hyp-2`(Hyperion SDR→HDR)、`color-1`(上色)、`remove-1`(去前景物体)、`stab-1`(稳定，未在 status 列表中)

### 2.5 计价

#### 5.1 credit 单价（官方 API 定价页）【实证-原文：https://www.topazlabs.com/api】

| 套餐 | 月费 | 每月 credits | 单价 | 备注 |
|---|---|---|---|---|
| **Starter** | $0/mo（页面标 **COMING SOON**） | — | **$0.12 / credit** | 灵活按量 |
| **Developer** | **$50/mo** | 500 | **$0.10 / credit** | credits 可结转 |
| **Scale** | **$240/mo** | 3000 | **$0.08 / credit** | 优先支持、自定义工作流 |
| **Enterprise** | 议价 | 量大 | — | **含 on-premise 部署**、专属开发支持 |

其它规则（原文）：
- **credits 永不过期，可结转**，但**余额上限为月配额的 5×**（例：3k 套餐最多持 15,000）。
- 用完自动充值 **套餐量的 25%**，按当前单价计费（例：3k 套餐自动充 750 credits，扣 $49.75）。
- **取消任务**的计费公式：`1.1 × [进度%]`；进度 0% 全额退款。
- **超时算失败、全额退款**（通常 24 小时内）。

#### 5.2 视频模型家族计价（估算基准 **10s @1080p 30fps**）【实证-原文：`/getting-started/model-pricing.md`】

| 用途 | 家族 | Credits / 视频 |
|---|---|---|
| Precision Upscale | **Proteus** | **4** |
| Generative Upscale | **Starlight** | Fast **6** / Quality **12** |
| Creative Upscale | **Astra** | **40** |
| Denoise | Denoise | Fast **2** / Quality **4** |
| Motion | **Frame Interpolation** | Fast **1** / Quality **2** |
| Video Utilities | Video Utilities | **2** |

#### 5.3 逐模型／逐分辨率真实计价表

**① Proteus / Rhea / Artemis / Theia / Dione / Iris 家族**（同一张表，30fps 估算）【实证-原文，`/video-models/proteus.md`、`/proteus/proteus.md`、`/proteus/rhea.md`】

| 时长 | 720p | **1080p** | 4K |
|---|---|---|---|
| 1s | 1 | 1 | 1 |
| 5s | 1 | 1 | 3 |
| 10s | 1 | **2** | 6 |
| **1m** | 4 | **8** | 31 |
| 5m | 17 | **38** | 151 |
| 10m | 34 | **76** | 302 |

> 注意：**该表按「输出分辨率」定价，与输入是否 480p 无关**（表头没有输入维度）。Gaia 2 (Animation) 约为同家族 **50%**。

**② Starlight 系（按「帧/credit」计价）**【实证-原文，`/video-models/starlight.md` 及逐模型页】

| 模型 | id | 帧/credit @1080p | 帧/credit @4K |
|---|---|---|---|
| **Starlight Precise 2.6** | `slp-2.6` | **26.0417** | **11.9179** |
| **Starlight HQ** | `slhq-1` | 26.0417 | 11.9179 |
| **Starlight Mini** | `slm-1` | 26.0417 | 11.9179 |
| **Starlight Fast 3** | `slf-3` | 26.0417 | 11.9179 |
| Starlight Fast 2 | `slf-2` | ~52 | ~24 |
| Starlight Precise 2 / 2.5（弃用） | `slp-2`/`slp-2.5` | ~26 | ~12 |
| Starlight Sharp（弃用） | `wonder-1` | ~26 | ~12（**实际仅 1080p 输出**） |

> 官方说明：表中为 "Quality" 模型价格；"Fast" 模型约为 Quality 的 **50%**。
> ⚠️ 换算提醒：**26 帧/credit @1080p 意味着 1 分钟 30fps（1800 帧）≈ 69 credits**——**Starlight 系是 Proteus 的 ~8.6 倍贵**，这是选型时最大的成本分野。

**③ Astra** | **④ Gaia 2 (Animation)**【实证-原文】

| 模型 | 帧/credit @1080p | 帧/credit @4K | 备注 |
|---|---|---|---|
| **Astra 2** (`ast-2`) | **10** | **6** | 约 Proteus 的 2.6 倍贵（1080p） |
| **Gaia 2 (Animation)** (`ganim-1`) | **300** | **100** | **全表最便宜**，但**只能 2× 且仅适合动画** |

**⑤ 帧插值**：见 §1.2 B 的表格（Apollo/Chronos 2 或 Fast 1 credits/GP；Aion 6）。官方家族页另给一版「Fast 1 / Quality 2 每 10s@1080p30」的粗口径，**与逐模型表（2× 慢放 @1080p 10s = 1 credit）不一致**，见 §6 存疑项。

**⑥ Denoise / Video Utilities**：与 Proteus 同表（1080p 1m = 8、10m = 76），Fast 档约 50%；**Nyx 按帧/credit 计价，与同家族其它模型略不同**（官方原注）。

#### 5.4 官方计算器主价格表的独立证据（credits/秒）【实证-接口】

官方 credit 计算器在运行时 fetch 一份 CSV（397 行），列结构为
`Source, Output, Frame Rate, Slowmo Factor, Megapixels/Second, Tokens/Second, Cost/Second, Tokens/5 Minutes, Cost/5 Minutes`。
UI 中把该表的 `Tokens/Second` 直接显示为 **"Credits per Second"**，故**该表的 "Tokens" 即 credits**。

抽样（源 720p-24fps）**credits/秒**：

| 输出 | 24fps | 30fps | 60fps |
|---|---|---|---|
| 720p | 0.0666 | 0.0666 | 0.2333 |
| **1080p** | **0.2000** | **0.2333** | **0.9000** |
| 1440p | 0.2000 | 0.2333 | 0.9000 |
| 4K | 0.7666 | 0.9333 | 3.5333 |

（慢放 2×／4×／6× 另有独立行，数值更高。）

> ⚠️ **两个必须注意的点**：
> 1. **该表的「Source」只有 720p / 1080p / 1440p / 4K——没有 480p**。也就是说**官方计算器不提供 480p 源的报价**，我们无法从中直接读到一个权威的「480p→1080p」价格。
> 2. 表的 `Cost/Second` 列 = `Tokens/Second × $0.04`，即该 CSV 用的是 **$0.04/credit**（非当前任何在售套餐单价）。**因此 `Cost/Second` 列不可直接用**，只能取 `Tokens/Second`（credits）再乘以实际套餐单价（$0.08–$0.12）。

### 2.6 硬约束与限制（API）

来源：OpenAPI 规范原文 + `https://developer.topazlabs.com/resources/api-limits.md?ask=...`（该页正文为空，内容仅存在于 `?ask=` 返回）+ `/getting-started/video-quickstart`

| 项目 | 事实 | 证据 |
|---|---|---|
| **请求 JSON body 上限** | **3000 字节**（超限返回无 body 的错误；通常由 `source.external`/`destination.external` 的长预签名 URL 或过多 filters 导致） | OpenAPI 规范原文 |
| **输入文件大小** | **< 100 GB**（标准请求 schema 要求） | 【实证-问答】 |
| **多段上传** | 分片 **500 MB**，最多 **150 个** 上传 URL；单文件 ≤500MB 时可单次 PUT | 同上 + quickstart |
| **请求体上限 500MB → HTTP 413** | quickstart 原文 | `/getting-started/video-quickstart` |
| **输入时长上限** | **未公布**（`source.duration` 无 maximum） | 【实证-问答】 |
| **帧数上限** | **未公布** | 同上 |
| **输出分辨率上限** | 取决于编码器：H.264 **4096×4096**、H.265/VP9 **8192×8192**、AV1 **16384×8704**、ProRes **16386×16386**；**向上取整到 4 的倍数** | OpenAPI + 【实证-问答】 |
| **是否支持 4K/8K 输出** | 支持；H.265 可到 8192 | 同上 |
| **并发上限** | **未公布**。过载返回 **HTTP 429**，官方建议**指数退避** | 【实证-问答】+ quickstart |
| **速率限制** | **无数字配额**，随服务器负载变化 | 同上 |
| **排队时长** | **无 SLA**；官方说明耗时预估"假设空队列"，且可能不准 | 【实证-问答】 |
| **处理超时（≠时长上限）** | GAN 图像 ~90 分钟；生成式图像 ~20 分钟；**多数 GAN 视频（如 Proteus 系）~4 小时**；**多数生成式视频（Starlight / Astra 系）~17 小时**。**超时算失败、全额退款（通常 24h 内）** | `/resources/faq` 原文 |
| **音轨保留** | 支持（`audioTransfer: Copy`） | OpenAPI |
| **批量提交** | **无批量端点**，逐个请求 | 【实证-问答】 |
| **HTTPS** | 仅 HTTPS；HTTP 会 301 跳转 | quickstart |
| **C2PA** | **所有 API 输出均为 C2PA-compliant** | `/resources/faq` 原文 |
| **水印** | 部分模型端点有 `watermark` 布尔参数（`false` 为默认）；响应含 `shouldAddWatermark` 字段 | `/video-models/starlight/starlight-mini.md`、`/astra/astra-2.md`、`/starlight/starlight-hq.md`、`/starlight/starlight-precise-2.6.md`、OpenAPI |

### 2.7 授权与商用（**这块有明确的坑，务必读**）

| 问题 | 结论 | 证据 |
|---|---|---|
| API 的 ToS 是否允许把输出用于面向终端用户的商业 SaaS 二次分发？ | **未证实。** 官方文档**没有**说明 API 许可是否允许把处理结果通过商业 SaaS 转售，也没有定义署名/水印义务，也没有解释 API 权利与桌面版许可的关系。文档仅把 API 描述为"用于集成到应用和自动化工作流"。 | 【实证-问答】，出处 `/getting-started/introduction.md`；官方要求商业 SaaS 转售决策向 `enterprise@topazlabs.com` 取得书面确认 |
| 是否有署名/水印要求？ | **未证实**。存在 `watermark` **技术参数**（默认 false），但这只是技术开关，**不构成法律署名义务的说明**。 | 同上 |
| **桌面版授权（EULA）** | **1 seat**：可装多台但**同时只能用一台**；**多机同时使用需 Pro 许可**；**年营收 > $1M 的组织必须 Pro 才能商用**；Additional seats **仅 Pro / Enterprise** 可加。EULA 原文：*"You may not sell, redistribute or reproduce the Topaz Software"* | `https://docs.topazlabs.com/sales-account-licensing/before-you-buy/how-many-computers-can-i-use-my-apps-on`、`/before-you-buy/terms`（原文引 `https://www.topazlabs.com/eula`，**该 URL 现返回 404**） |
| 网页版 / Astra 商用限制 | **"Personal and commercial use for orgs under $1M USD annual revenue."** | `https://www.topazlabs.com/topaz-video` 套餐小字 |
| **中国区可访问性 / 支付** | 支付侧：**仅 Stripe 月付信用卡**（原文：*"We currently support monthly credit card payment processing through Stripe. Please contact us if you would like other payment options."*）。**是否支持支付宝/银联/人民币发票：未证实。** 网络侧：**本报告全部抓取均在杭州联通 AS4837 出口完成，`topazlabs.com` / `developer.topazlabs.com` / `docs.topazlabs.com` / `api.topazlabs.com` 全部直连成功**；`POST https://api.topazlabs.com/video/express` 实测 **~0.7s 返回 401**（端点在线可达，无需代理）。 | `/api` 原文；本次实测 |
| 中国区「官方中文站」？ | 检索到 `topazvideo.cn` / `topazstudio.cn` / `topazgigapixel.cn` / `topazphoto.cn` 等站点，**但未证实其是否为 Topaz Labs 官方授权渠道**（页面含相同产品名与"Topaz Studio 所有应用，一个低价"文案，疑似镜像/联盟站）。**不得据此判断官方在华有代理。** | Bing 中国站检索结果，**【未证实】** |

> ⚠️ **一个容易踩的认知陷阱：换成第三方托管（Replicate / fal）并不能自动解决授权问题。**
> Replicate 服务条款（`https://replicate.com/terms`，本次抓取原文）明确把这类模型归为 **"Third-Party Offerings" / "Marketplace Models"**：
> - *"Third-Party Offerings may be subject to **additional terms and conditions, including license restrictions**... You agree to **fully comply with Third-Party Terms** applicable to your use of the Services."*
> - *"Use of any Marketplace Models is subject to the **Third-Party Terms** applicable to such Marketplace Models... **Before using any Marketplace Models, you should review and ensure you comply with such Third-Party Terms.**"*
>
> 即：**授权问题"跟着模型走"，不跟着平台走**。在 Replicate / fal 上调用 Topaz 模型，仍然受 **Topaz 自己的附加条款**约束，而 Replicate **明确把合规责任推给使用者**。
>
> 同时注意 Replicate 自身对网站内容的授权表述是 *"solely for your and your Representatives' **non-commercial purposes**"*（针对 Replicate 网站内容而言，非针对模型输出）。
>
> **结论：无论走官方 API 还是第三方托管，「把 Topaz 输出用于面向终端用户的商业 SaaS」都需要拿到 Topaz 的书面确认。** 我已尝试在 Replicate 的 Topaz 模型页寻找 "Additional Terms"，**未找到 Topaz 的附加条款文本【未证实】**，这本身就是风险信号。

> **对 libtv 的直接含义**：如果要把 Topaz 能力做成我们面向终端用户的产品功能，**必须先向 `enterprise@topazlabs.com` 取得书面许可确认**。在拿到书面确认前，**不要**把该路径写进产品化的关键路径。

---

## 3. Topaz 桌面版能否 API 化 / 服务器端自动化？

### 3.1 结论摘要

| 路径 | 可行性 | 关键阻碍 |
|---|---|---|
| 桌面版在 **Linux 服务器**上无头批处理 | ❌ **不可行（官方明确不支持）** | 官方系统要求原文：**"Linux Operating Systems are not supported. Virtual Machines and Ghost Machines are not supported. E GPUs are not supported."** |
| 桌面版在 **Windows 服务器 + GPU** 上批处理 | ⚠️ **技术可行，但授权不成立** | 有 CLI（见 §3.2），但 **1 seat 限制** + **>$1M 营收需 Pro** + EULA 禁止 redistribute → **不能用于我们 SaaS 的多实例并发** |
| **官方 API** | ✅ **推荐** | 见 §2，唯一在授权与工程上都站得住的路径 |

**系统要求原文**【实证-原文：`https://docs.topazlabs.com/topaz-video/system-requirements`】：

- 明确**不支持**：Intel 版 Mac、Snapdragon 处理器、**虚拟机与 Ghost 机器**、**eGPU**、**Linux**。
- **Windows 最低**：Windows 10 最新版；CPU 需 2016 年后且支持 AVX；**16 GB RAM**；独显 **NVIDIA / AMD / Intel 均需 6 GB VRAM**（**Aion、Hyperion、Rhea 需 8 GB VRAM**）；可用存储 **45 GB**。
- **macOS 最低**：macOS 13 + **M 系列**处理器；16 GB RAM；45 GB 存储。
- **Starlight 系推荐配置**：Windows 11、**32 GB RAM+**、**NVIDIA RTX 30 系及以上**（或 AMD Radeon 5000+ / Intel Arc A770+）、**8 GB VRAM+**、**60 GB 存储**。
- 安装后仍需联网用于**激活、模型下载、更新、云渲染**。
- CPU 要求出自另一份更严格的说法（Mac 侧）：「Proteus Natural 与场景检测需 macOS 15 或更新」。

### 3.2 桌面版 **存在 CLI**，但文档已下架（重要且矛盾的状态）

**证据链**：

1. **社区帖（2024-02-29）**证明 CLI 真实存在且**可在一条命令里串联超分+插帧**
   `https://community.topazlabs.com/t/command-line-documented-options/64122`
   帖中原文示例（macOS 路径）：
   > `/Applications/Topaz\ Video\ AI\ 4.0.9.app/Contents/MacOS/ffmpeg -hide_banner -nostdin -y -strict 2 -hwaccel auto -i "CLIP_2.avi" -vcodec h264_videotoolbox -b:v 1000k -pix_fmt yuv420p -filter_complex "tvai_up=model=alq-13:scale=2,tvai_fi=model=chf-3:fps=30" "CLIP_2.mp4"`
   - **`tvai_up`** = 超分滤镜，**有 `scale=` 参数**（此处 `scale=2`）
   - **`tvai_fi`** = 帧插值滤镜，**有 `fps=` 参数**
   - 两个滤镜可**用逗号串联在同一 `-filter_complex` 里**——这就是我们要的「先超分再补帧」

2. **官方当时确有 CLI 文档页** `docs.topazlabs.com/topaz-video/command-line-interface`（帖中由用户与官方人员共同引用）。
   → **本次实测该 URL 返回 404**，且**当前 docs 的 Topaz Video 侧边栏（34 个页面）中已无 CLI 条目**。
   → 结论：**CLI 功能存在，但已不在官方文档中，属「非官方支持」状态。**

3. **官方人员确认 Starlight Mini 不支持 CLI**（2025-06-05，`kyle.topazlabs`）：
   > *"Starlight Mini is not currently an option for CLI with the app, it is being run via a different process right now. This will be changed in the future once the team gets the workflow sorted out and running efficiently."*
   `https://community.topazlabs.com/t/cli-starlight-mini/92066`
   → 即**最新最强的模型恰恰不能用 CLI 调用**，这是"桌面版自动化"路线的致命伤。

4. 同一帖中还有 GUI 生成的原生命令行（`runner.exe`），含 `--upscale-factor 3`、`--max-gpu-mem`、`--start-frame-idx` 等参数，说明**背后确实有一个可编程的 runner 进程**——但**非公开 API、无文档、随版本变化**，不可作为生产依赖。

5. **CLI 曾被尝试用于 Linux**：社区有 *"Topaz Video AI Linux Beta v4.0.7.0.b"*（2023-12-08）与 *"VAI dockerized for headless linux use"*（2023-09-17）两个帖子 → 说明历史上存在过 Linux 实验版本，但**当前官方系统要求已明确不支持 Linux**。

### 3.3 桌面版的「批处理」是 GUI 队列，没有独立文档

我对 `docs.topazlabs.com` 的导航做了完整对比【实证-原文】：

| 应用 | 是否有 `functions/batch-processing` 文档页 |
|---|---|
| Topaz Photo | ✅ 有（`/topaz-photo/functions/batch-processing`） |
| Topaz Gigapixel | ✅ 有（`/topaz-gigapixel/functions/batch-processing`） |
| **Topaz Video** | ❌ **没有**（35 个页面中不存在 batch 页） |

Topaz Video 的批处理只能通过 **文件列表 + 导出队列（Previews / Exports Queue）** 完成——云渲染页原文提到云导出队列 *"follows the same logic as the standard Previews and Exports Queues"*。**即：批量能力存在，但完全绑定 GUI，且官方未提供文档化的批处理入口。**

补充：官方预置里直接有 **"4K & 60 FPS"**、**"60 FPS"**、**"4x Slow Motion"**、**"8x Slow Motion"**、**"Auto Crop Stabilization"**、**"Denoise"**、各档 Film 4k 等预设【实证-原文，`/topaz-video/reference-guide/presets`】——**说明"超分到 4K + 60fps"正是 Topaz 主推的标准场景**。

### 3.4 桌面版有一个「云渲染」功能——但它不是 API

`https://docs.topazlabs.com/topaz-video/cloud-rendering`【实证-原文】：

- 用途："Processing large batches of videos in parallel"、"Processing long videos on low-power machines"；**"There's no limit to how many simultaneous jobs you can queue"**。
- **但入口在 GUI 里**（"Cloud Export" 按钮 + 确认弹窗显示预估时间与 credit 成本）→ **无法从后端直接调用**，只能人工点。
- **明确的硬限制**：
  - 支持 **AV1 / VP9 / H264 / H265**；**输入文件最大 100 GB**；**云渲染最高支持 8K**
  - **不支持云渲染的模型**：`Rhea XL`
  - **不支持云渲染的滤镜**：**Stabilization（稳定）**、**SDR to HDR**；**Rotation / crop / Telecine 等也不支持**
  - **Starlight 家族限制 9,000 帧/任务**（原文换算：≈5 分钟 @30fps ≈2.5 分钟 @60fps）；**其它模型无帧数限制**
  - `Starlight Sharp` **仅 1080p 输出，不支持 4K**
- **这是「5 分钟上限」说法的真实出处之一，且它是 9000 帧限制、只针对 Starlight**（详见 §6）。

**桌面版云渲染的 credit 成本（1 分钟 @30fps 的官方示例）**【实证-原文，同页】：

| 类别 | 输入分辨率 | 成本（credits / 分钟） |
|---|---|---|
| 增强 Tier 1（Nyx Fast） | **SD 480p/576p** | **~2** |
| 增强 Tier 2（**Proteus / Iris / Nyx**） | **SD 480p/576p** | **~22–26** |
| 增强 Tier 3（Rhea / Artemis / Gaia / Theia / Nyx XL） | **SD 480p/576p** | ~20–26 |
| 增强 Tier 2 | 1080p 输入 | ~10（输出 Original）/ ~34（4K） |
| **帧插值 → 60fps** | **SD 480p/576p** | **~2–4** |
| 帧插值 → 120fps | SD | ~6–14 |
| 帧插值 2× 慢动作 | SD | ~4–12 |
| 帧插值 → 60fps | 1080p | ~10 |
| 去运动模糊 (Themis) / 去噪 (Nyx HF) | SD | ~2–4 each |

**桌面版 cloud credit 价格**【实证-原文，同页】

| 月度订阅 | credits/月 | 月费 | 单价 |
|---|---|---|---|
| — | 80 | $9.99 | **$0.125** |
| — | 400 | $39.99 | **$0.100** |
| — | 1400 | $99.99 | **$0.071** |
| — | 3000 | $199.99 | **$0.066** |
| — | 9000 | $499.99 | **$0.055** |

一次性 credit 包：20/$5（$0.250）、400/$78（$0.195）、1000/$158（$0.158）、3000/$399（$0.133）、9000/$999（$0.111）。（**一次性包不过期**；订阅 credits 每月结转、上限 5×。）

> 值得注意：**桌面版 cloud credit 的单价（最低 $0.055）明显低于官方 API 的 credit 单价（最低 $0.08）**。但桌面版**无法 API 化**，且受 1 seat 与商用授权限制 —— 便宜但用不上。

---

## 4. 第三方托管平台上的 Topaz 模型

> 本节主要依据并行调研同事的核实结果（`04-hosted-apis-and-gpu-cloud.md` §1）。**我已对其中最关键的两个端点做了独立二次抓取**（通过 fal 的 queue OpenAPI 接口，无需 token），结论如下：
>
> **`GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=topaz/upscale/video/precision`** → 确认输入 schema 为 `UpscaleVideoPrecisionInput`，字段：`model`（默认 `Proteus`）、**`upscale_factor`（默认 2，"2.0 doubles width and height"）**、**`target_fps`（"Frame interpolation is enabled only when this differs from the source FPS"）**、`noise`/`halo`/`compression`/`grain`/`recover_detail`（0–1 或 0–0.1）、`H264_output`（默认 False，**即默认 H265**）、`video_url`。**独立验证通过。**
>
> **`GET .../openapi.json?endpoint_id=topaz/interpolate/video`** → 确认输入 schema 为 `InterpolateVideoInput`，字段仅 5 个：**`slowdown_factor`、`model`、`video_url`、`H264_output`、`target_fps`**。**即该端点确实「只插帧、不超分」**（无 `upscale_factor`）。路径为 `/topaz/interpolate/video`（含队列 `requests/{id}/status`、`/cancel`）。**独立验证通过。**

### 4.1 fal.ai —— **Topaz 端点最完整、参数与计价最公开的平台**

来源（同事抓取）：fal 模型索引接口 `https://fal.ai/api/models?keywords=topaz`、各模型 OpenAPI `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>`、模型 playground 计价文案

| fal model id | 功能 | 关键参数 | 计价 | 证据 |
|---|---|---|---|---|
| **`topaz/upscale/video/precision`** | Precision 超分（Proteus / Proteus Natural / Iris / Dione / Artemis / Gaia / **Gaia 2** / Rhea / Theia） | `upscale_factor`（默认 2）、**`target_fps` 16–60（与源不同时自动启用 Apollo 插帧）**、`noise`/`halo`/`compression`/`grain`/`recover_detail` 0–1 | 10s 计：720p **$0.10**、1080p **$0.20**、4K **$0.60** | 【同事核实】，页面 date 2026-08-11 |
| **`topaz/upscale/video/generative`** | Starlight 系超分（Precise 2.6 / HQ / Mini / Sharp / Fast 2） | `upscale_factor`（默认 2）、**`target_fps` 16–60（启用 Apollo 插帧）**、`softness` 1–5 | 30fps 10s：1080p **$1.20**、4K **$2.60**；Fast 2 为 **$0.60 / $1.30**；**60fps 翻倍** | 【同事核实】 |
| **`topaz/upscale/video/creative`** | Astra 2（生成式造细节） | `creativity`、`realism`、`sharp`、`prompt`（≤1024 字符，**带 prompt 时输入限 450 帧**）、`target_fps` 16–60 | 30fps 10s：1080p **$3.00**、4K **$5.00**；60fps 翻倍 | 【同事核实】；注意 **Astra 2 会吸附到自身输出分辨率（通常 4K）**，按实际交付分辨率计费 |
| **`topaz/interpolate/video`** | **纯帧插值（Apollo / Chronos / Aion）** | **`target_fps`（默认 60）**、**`slowdown_factor` 1–8（整数，1=变速不变）**；**仅插帧不超分（保持源分辨率）** | 10s 30→60fps：Apollo/Chronos **$0.30@1080p、$0.60@4K**；Aion **$0.50 / $1.70**；慢动作按输出时长计费 | 【同事核实】 |
| **`topaz/denoise/video`** | Nyx / Fast / XL / **HF** | `upscale_factor`（默认 1）、`noise`/`compression`/`halo` | 10s：**$0.10@720p、$0.20@1080p、$0.60@4K** | 【同事核实】 |
| **`topaz/deblur/video`** | Themis 2 运动去模糊 | 保持源分辨率与帧率 | 10s **$0.10（≤1080p）/$0.30@4K** | 【同事核实】 |
| **`topaz/colorize/video`** | 上色 | — | 同 deblur 口径 | 【同事核实】 |
| **`topaz/sdr-to-hdr/video`** | Hyperion 2.5 | — | 10s **$2.40@1080p / $5.10@4K**（很贵） | 【同事核实】 |
| **`fal-ai/topaz/upscale/video`** | 旧版统一端点 | **Proteus v4 超分 + 可选 Apollo v8 插帧；playground 称"最高 8× 放大与 120 FPS 输出"** | playground 文案：「每秒 $0.01（≤720p）、$0.02（720–1080p）、$0.08（>1080p）；60fps 翻倍；Gaia 2 半价」 | 【同事核实，实证-间接】 |
| 图像端点 | `topaz/upscale/image/precision` / `generative` / `creative` / `transparent` | — | $0.08/24MP、$0.08/8MP、$0.08/2MP、$0.08/24MP | 【同事核实】 |

**⚠️ fal 侧的硬限制**：上述视频端点页面**均声明 5 分钟时长上限**。**这是 fal 托管版的限制，不是 Topaz 官方 API 的限制**（见 §6）。

**⚠️ fal 侧的三条勘误（子任务逐端点探测 + 我独立复核 `precision` 端点确认）**：

1. **`fal-ai/topaz/video/enhance` 这个 model id 不存在** —— OpenAPI 接口返回 **404**（响应体仅 4 字节）；其网页是 Next.js 空壳、无 `Inference` 徽标、无模型描述。**请勿使用该 id。**
2. **fal 官方文档自相矛盾**：`upscale/video` 的 `about` 文案宣称 *"up to **8x** upscaling and **120 FPS**"*，而**实际 JSON Schema 硬限为 `upscale_factor` ≤ 4、`target_fps` ≤ 60**。→ **生产环境请按 4×/60fps 设计。**
   ⚠️ **但要注意端点差异**：**真正能到 120fps 的是 `topaz/interpolate/video`**（其 Schema 为 `target_fps` **16–120**、`slowdown_factor` 1–8、`model` ∈ {Apollo, Chronos, Aion}），而**超分端点封顶 60fps**。（我独立抓取 `precision` 端点确认 `upscale_factor` 默认 2、`target_fps` 存在；上限与端点差异由子任务逐端点核对得出。）
3. **`fal-ai/topaz/upscale/video`（旧统一端点）的 "8×/120fps" 同样来自 playground 文案**，参数表里 `upscale_factor` 默认 2、`target_fps` 无上限声明 → **先用它做小样验证再决定**。
4. **fal 的模型枚举比我们需要的更丰富**（子任务逐端点抄录）：`precision` 端点 **21 个模型**（含 `Proteus Natural`、`Iris Low Quality`、`Dione DV/TV/Robust/Dehalo`、`Artemis` 六种变体、`Gaia 2`、`Rhea`、`Theia Fine Tune Detail/Fidelity`）；`generative` 端点为 **Starlight Precise 2.6（默认）/ HQ / Mini / Sharp / Fast 2**；`denoise` 端点 `upscale_factor` **默认 1**（即只降噪不放大）。**注意 `precision` 端点里没有 `Starlight`，`generative` 端点里没有 `Proteus` —— 要跨家族组合必须分两次请求。**
5. **fal 的计价原文口径**（`https://fal.ai/models/fal-ai/topaz/upscale/video/llms.txt`）：*"$0.01 for up to 720p, $0.02 for 720p to 1080p, and $0.08 for above 1080p output. **Price doubles for 60fps output.** For **Gaia 2** output costs **half**."* → 即 **480p→1080p/60fps = $0.02 × 2 = $0.04/秒**。

**fal 平台侧约束**【同事核实】：
- **必须预充值 credits**，credits **365 天过期**；**仅支持银行卡或美国 ACH，美元计价**（无支付宝/微信/银联）。
- **新账号默认并发 = 2**（限 `IN_PROGRESS`，`IN_QUEUE` 不计入）；自助提升上限 **40**；再高需联系销售。
- 429 带 `X-Fal-needs-retry: 1`，SDK 自带指数退避；**生产建议用 `subscribe()`（服务端队列重试）**。
- 生成媒体默认在 fal CDN **至少保留 7 天**；服务器在**美国及其它国家**；DPA 只有 GDPR/SCC 机制，**无 PIPL / 数据出境标准合同对应机制**；Serverless 区域**无亚太/香港/新加坡**。
- 管辖区加州，含仲裁与集体诉讼弃权。

### 4.2 Replicate —— **✅ 有 Topaz 官方账号**（此前的「未证实」已推翻）

来源：`https://replicate.com/topazlabs`（HTTP 200）、`https://replicate.com/topazlabs/video-upscale`【实证-原文，子任务抓取】

`replicate.com/topazlabs` 是 **Topaz Labs 官方账号**（页面同时链出官方 GitHub `https://github.com/topazlabs`），带 4 个自有模型：

| model id | 描述 | runs |
|---|---|---|
| **`topazlabs/video-upscale`** | "Video Upscaling from Topaz Labs" | **1.1M** |
| `topazlabs/image-upscale` | "Professional-grade image upscaling" | 3.6M |
| `topazlabs/dust-and-scratch-v2` | 老照片除尘去划痕 | 2.8K |
| `topazlabs/image-colorization` | 图像上色 | 2.3K |

**`topazlabs/video-upscale` 关键信息**：

- **维护状态**：页面 README 写 **"Model updated 2 weeks, 2 days ago"**（相对 2026-10-04）→ **仍在维护**。
- **README 原文**：*"This upscaler supports **720p, 1080p, and 4k** resolution upscaling and **fps up to 60**."*
- **输入参数仅 3 个**：`video`（uri，必填）、**`target_resolution`**（enum `720p`/`1080p`/`4k`，默认 `1080p`）、**`target_fps`**（integer **15–60**，默认 30）。
  - ⚠️ **没有 `upscale_factor`**（只能给目标分辨率）；**不暴露插帧模型选择**（无 Apollo/Chronos 选项，与 fal 不同）。
- **计价（README 内嵌表格原文）**：

| Output | Cost / 5 秒 |
|---|---|
| 720p → 720p/30fps | $0.027 |
| 720p → 720p/60fps | $0.053 |
| 720p → 1080p/30fps | $0.093 |
| **720p → 1080p/60fps** | **$0.187** |
| 720p → 4K/30fps | $0.373 |
| 720p → 4K/60fps | $0.747 |

  → **`$0.187 / 5s = $0.0374/秒`，60 秒成片约 `$2.24`**。**比 fal.ai 的约 $0.04/秒便宜约 6%。**【推算】
  - ⚠️ 页面 JSON 中还并存 `"price": "$0.0001 per second"`、`p50price $0.0060`、`current_tiers: {"price":"$0.08","type":"per-unit"}` 三套口径，**与 README 表格不一致** → **实际结算口径存在歧义【未证实】，须以真实账单为准。**

### 4.3 其它第三方平台核实结果（均为实测／全量枚举）

| 平台 | 有 Topaz 视频超分/补帧？ | 真实 model id | 计价 | 备注 |
|---|---|---|---|---|
| **WaveSpeedAI** | ❌ **无 Topaz 视频模型**（全量 1054 个模型中仅命中 **4 个 Topaz 图片**模型） | Topaz 图片：`topaz/image/sharpen`、`/restore`、`/denoise`、`/lighting`（`type` 均为 image-to-image） | 4 个图片模型均 **$0.096/次**（每 24 输入 MP，向上取整，最低 $0.096） | ✅ **明确支持微信支付 + 支付宝**（+ PayPal/Google Pay/Apple Pay/卡，企业可电汇）→ **对中国团队最友好**；新账号送 $1 |
| **Freepik API**（已切换为 **Magnific API**） | ✅ **有专属端点组「Upscaler Topaz」（标 NEW）** | `POST /v1/ai/video-upscaler-topaz`、`GET /v1/ai/video-upscaler-topaz`、`GET /v1/ai/video-upscaler-topaz/{task-id}`；服务域 **`https://api.magnific.com`** | **【未证实】**——`docs.freepik.com/pricing.md` 只说是 credit 制，**Topaz 视频超分每次扣多少 credit 无任何数字**；`llms-full.txt`（935KB）全文 grep `[0-9]+ credits` 零命中 | 参数最清晰：`enhancement_model`（`starlight_precise_2_5`(默认) / `starlight_fast_2`）、`resolution`（`720p`/`1k`/`2k`/`4k`，默认 2k）、**`target_fps`（1–60，"When it differs from the source frame rate, AI frame interpolation is applied"）**、**`frame_interpolation`（`apollo` 默认 / `chronos`）**、`noise`(0–1)、`webhook_url`。**即 Starlight 超分 + Apollo 插帧一体化**；但**价格未知，无法做成本预算** |
| **Higgsfield** | ❌ **完全没有** | — | — | 官方文档 sitemap 全量 **141 个 URL**，grep `upscal\|interpol\|enhanc\|restore\|denoise\|topaz\|super.?res\|fps` **零命中**；`docs.higgsfield.ai/docs/models.md` 明文：**82 个在售条目（16 图片 / 66 视频），全部是生成/编辑/运动迁移，无任何超分或插帧**；`higgsfield.ai/models`、`/ai-models`、`/video` 均 404；`/pricing` 中 `topaz` 出现 **0 次** |
| **OpenRouter** | ❌ **明确无** | — | — | `/api/v1/models` 共 **466 个模型，0 个含 topaz、0 个是视频输出模态** |
| **国内聚合站** | ❌ **均未证实存在 Topaz** | — | — | 302.AI 模型列表为客户端渲染无法静态核实；AIHubMix 从中国大陆**连接直接超时**（见 §4.4） |

> **WaveSpeedAI 反向价值**：虽然它没有 Topaz 视频模型，但**有便宜得多的替代理线**——`wavespeed-ai/video-upscaler`（1080p **$0.025/5 秒 = $0.005/秒**，秒级计费、3 秒起收）+ 补帧 `wavespeed-ai/rife`（**$0.01/次**）或 `wavespeed-ai/video-fps-increaser`（**$0.008/次**，"doubles your video frame rate"）。
> → **粗略对比：1080p 60fps 每分钟 ≈ $0.3（WaveSpeed 非 Topaz） vs ≈ $2.2（Replicate Topaz）vs ≈ $2.4–3.6（fal Topaz）**——**差约 7–10 倍，非常值得做 A/B。**
> ⚠️ 但 `video-fps-increaser` 页面只自称 "**doubles** your video frame rate"，**是否接受任意 `target_fps` 未逐项核实【未证实】**。

### 4.4 中国大陆可访问性（**第一手实测，杭州联通 AS4837**）

子任务在**中国大陆网络环境**（出口 `124.90.21.177`，杭州 / 浙江 / 中国联通 AS4837）做了真实 curl 实测（2026-10-04）【实证-接口】：

| 目标 | 结果 | 耗时 | 判读 |
|---|---|---|---|
| `https://fal.ai/` | **200** | 1.22s | ✅ 直连可达 |
| `POST https://queue.fal.run/fal-ai/topaz/upscale/video` | **401** | 0.78s | ✅ **可达且 Topaz 端点存活**（401 = 缺 Key，非网络故障） |
| `https://replicate.com/` | **200** | 1.37s | ✅ |
| `https://replicate.com/topazlabs/video-upscale` | **200** | 1.26s | ✅ |
| `https://docs.freepik.com/` / `https://api.magnific.com/` | **200** | 1.14s / 2.23s | ✅ |
| `https://wavespeed.ai/` | **200** | **4.57s** | ✅ 可达但**明显偏慢** |
| `https://aihubmix.com/`、`yunwu.ai`、`302.ai`、`doc.302.ai` | **000（超时）** | 15–25s | ❌ **从大陆不可达**（DNS 解析到 Meta/Dropbox IP 段，疑似域名级封锁；`302ai.cn`（阿里云）正常） |
| `POST https://api.topazlabs.com/video/express`（同事实测） | **401** | ~0.7s | ✅ **Topaz 官方 API 从大陆可直连** |

> **结论：fal.ai、Replicate、Freepik/Magnific、Topaz 官方 API 从中国大陆均可直连，无需代理。**子任务的建议是：**不必优先寻找第三方代理，真正的瓶颈是「跨境支付与发票」，不是网络。**

**支付方式**：

| 平台 | 支付 | 证据 |
|---|---|---|
| **WaveSpeedAI** | ✅ **微信支付 + 支付宝**（+ PayPal / Google Pay / Apple Pay / 卡；企业可电汇） | `https://wavespeed.ai/pricing` FAQ 原文 |
| **fal.ai** | 仅「payment card 或美国 ACH，美元计价」【同事核实 ToS】；**支付宝/微信/银联 0 命中** | `https://fal.ai/legal/terms-of-service`、`https://fal.ai/pricing` |
| **Replicate** | **未证实**（`/docs/topics/billing` 中 Alipay/WeChat/UnionPay 均 0 命中；`payment-methods` 页 404） | `https://replicate.com/docs/topics/billing` |
| **Freepik / Magnific** | **未证实**（credit 制，无公开支付说明；`freepik.com/api` 被 WAF 403） | `https://docs.freepik.com/pricing.md` |
| **Topaz 官方 API** | 仅 **Stripe 月付信用卡**（官方原文）；支付宝/银联/人民币**未证实** | `https://www.topazlabs.com/api` |

> ⚠️ **「能否开中国增值税发票」对四家全部未证实**——这是本项目跨境方案的最大未知项。

### 4.5 境内托管方案：腾讯云数据万象 CI（**非 Topaz，但对本项目高度相关**）

> 这条不是 Topaz，但它是「480p→1080p + 60fps」这个真实需求在**境内、人民币计价、可开票、低延迟**维度上的唯一完整解法，因此单列。

**我已独立二次抓取并逐格核对价格表**。来源：`https://cloud.tencent.com/document/product/460/58120`（HTTP 200，页面标注 **最近更新时间：2026-06-05**）【实证-原文】
> 📌 抓取提示：该站返回压缩体，**必须加 `curl --compressed`**，否则拿到二进制乱码。

腾讯云 CI 的**媒体处理费用**页明确列出两个独立的计费项：
- **超分辨率**：*"使用超分辨率服务产生的费用，包括基础版、增强版，**根据输出视频时长收费**，不同分辨率费用不同。"*
- **视频插帧**：*"**将低帧率视频转换为高帧率视频**而产生的费用，**根据输出视频时长收费**。"*

**价格表（原文逐行抄录，单位：元/分钟，中国境内）**：

**① 超分辨率 — 基础版**

| 输出分辨率 R | 帧率 F | 价格（元/分钟） |
|---|---|---|
| R ≤ 1080p | F < 30 | **2.4** |
| R ≤ 1080p | **F ≥ 30** | **3.2** |
| R > 1080p | F < 30 | 4.8 |
| R > 1080p | F ≥ 30 | 9.6 |

**② 超分辨率 — 增强版**

| 输出分辨率 R | 帧率 F | 价格（元/分钟） |
|---|---|---|
| R ≤ 720p | F < 30 | 4 |
| R ≤ 720p | F ≥ 30 | 7.5 |
| 720p < R ≤ 2K | F < 30 | 6.5 |
| **720p < R ≤ 2K** | **F ≥ 30** | **12** |
| 2K < R ≤ 4K | F < 30 | 15 |
| 2K < R ≤ 4K | F ≥ 30 | 24 |

**③ 视频插帧**

| 输出分辨率 R | 帧率 F | 价格（元/分钟） |
|---|---|---|
| R ≤ 720p | F < 30 | 3 |
| **R ≤ 720p** | **F ≥ 30** | **6** |
| 720p < R ≤ 2K | F < 30 | 6 |
| **720p < R ≤ 2K** | **F ≥ 30** | **12** |
| 2K < R ≤ 4K | F < 30 | 18 |
| 2K < R ≤ 4K | F ≥ 30 | 36 |

**④ 相邻可叠加项**：视频增强（色彩增强 / 细节增强 / **SDR to HDR**）各 **0.4 元/分钟**，且是**通用计费项**（多个同类功能累计）；数字水印 1080p **0.43 元/分钟**。

> **针对本需求（480p → 1080p @60fps，输出 1080p 且 F≥30）的合计**：
> - 超分基础版 + 插帧 = **3.2 + 12 = 约 15.2 元/分钟**
> - 超分增强版 + 插帧 = **12 + 12 = 约 24 元/分钟**
> - 若再加 SDR to HDR +0.4 → 约 15.6 / 24.4 元/分钟
>
> ✅ **优势**：**人民币计价、境内节点（低延迟）、可开中国增值税发票、按输出时长计费、不足一分钟按实际时长计费**；可叠加 COS 存储与资源包抵扣（页面有资源包抵扣比例说明，且有 CI 价格计算器）。
> ⚠️ **代价**：**算法不是 Topaz**，画质（尤其生成式细节重建、人脸/动画风格保持）需自测对比；**其超分/插帧的具体能力上限、是否有 API 层封装、并发配额均未在本次核实范围内【未证实】**。

**成本对照**：约 15.2 元/分钟 ≈ **$2.14/分钟**，与 Replicate Topaz（$2.24）和 fal（$2.4–3.6）**同量级**——即：**境内方案在价格上不输给 Topaz 系，且额外拿到合规与开票优势。**

---

## 5. Topaz 之外：「同类桌面/专业软件 API 化」选项

### 5.1 关键判断：**要区分「桌面版本身」与「同厂商的 API 产品线」**

**⚠️ 这是本报告的一个重要修正。** 我最初假设「桌面 AI 增强软件几乎没有官方 REST API」——**实测只对了一半**：

| 类别 | 结论 | 例子 |
|---|---|---|
| **传统桌面厂商的「桌面版本身」** | ❌ 普遍无 API / 无 CLI，批量仅 GUI 队列 | **Wondershare（视频侧）/ VideoProc** —— 已实证（§5.3.1） |
| **同厂商另开的「API 产品线」** | ✅ **真实存在且可编程** | **HitPaw**（`api-base.hitpaw.com`，**含独立补帧模型**）、**AVCLabs**（Media MCP + MIT SDK）、**VanceAI**（Open API v1）、**Krea**（REST + npm SDK + MCP）、**Magnific**（`api.magnific.com`） |
| **视频生成平台另开的「增强端点」** | ✅ 部分存在 | **Runway**（超分+补帧各自计价）、**Vidu / PixVerse**（仅超分）、**火山引擎 VOD**（SR + VFI） |

→ **所以正确的问题不是「桌面软件能不能 API 化」，而是「哪家另开了 API 产品线，以及它是否够便宜」。** 详见 §5.3.4。

**Topaz 自己的例子说明「桌面版本身」这条路走不通**：有 CLI（`tvai_up` / `tvai_fi`），但
1. 官方 CLI 文档**已下架**；
2. **最新模型（Starlight Mini）明确不支持 CLI**；
3. **Linux/VM/eGPU 官方不支持**；
4. **1 seat 授权**禁止服务端并发。

### 5.2 通用替代：开源自建「超分 + 补帧」流水线

对 libtv 而言，**真正的「同类方案 API 化」答案是：不用桌面软件，用开源模型自建服务**。

| 环节 | 开源方案 | 说明 |
|---|---|---|
| 超分 | **Real-ESRGAN / ESRGAN / SwinIR / SPAN / OmniSR** | 有官方与社区 CLI，Linux + GPU 可无头批处理；模型库见 OpenModelDB |
| 补帧 | **RIFE / Practical-RIFE / ncnn-vulkan** | 有 CLI，Linux 可跑；RIFE 是当前主流实时补帧方案 |
| 串流程 | **ChaiNNer**（`chaiNNer-org/chaiNNer`） | 见下方核实 |

**ChaiNNer 核实结果**【实证-原文：`https://chainner.app/`，抓取 2026-10-04】：

- 官方自述：*"A **node-based editor** for image processing pipelines. Drag nodes onto a canvas, connect them, and press run. **Free and open source, for Windows, macOS, and Linux**."*
- 运行后端：*"chaiNNer runs them through **PyTorch, NCNN, ONNX, or TensorRT**."*
- 模型生态：自维护架构包 **Spandrel**，*"covers **ESRGAN, SPAN, OmniSR**, and dozens of other architectures, and most of the models people use come from **OpenModelDB**."*
- 能力范围：*"color work, blending, format conversion, **batch runs, and video frames**"* —— 注意**原文是 "video frames"（逐帧处理），不是"视频补帧"**。
- **许可证：GPLv3**（站点页脚明确标注）。
- ⚠️ 官方站点与页脚均**只把它描述为 desktop editor（GUI）**，`https://chainner.app/docs` 返回 **404**。
- ✅ **但 CLI 确实存在**（我在站点上没找到，是子任务读源码与仓库文档证实的）：**`chainner run <chain.chn> [--override x.json]`**，仓库内 `docs/05--CLI.md` 有官方文档，自称 **"experimental"**，并明载适合 **server / Docker** 场景。
- ❌ **但它没有 `--headless` 参数**：子任务在**全仓库检索 `headless` 得 0 处命中**，且 ChaiNNer 是 **Electron 应用** → **"无头"这一步【未证实】，是本项最大的落地风险**（需自行 `xvfb` 实测，且它**会挂住等按键**，不像 ncnn 工具那样有可靠退出码）。
- ❌ **它没有补帧节点**：RIFE 在 ChaiNNer 里仅用于"图像对齐"，`Interpolate Models` 是**权重融合**（不是插帧），相关 issue #1109 **自 2022 年至今仍 OPEN**。
- ⚠️ **`--override` 能力有限**：只能改**文本 / 数字 / 文件 / 目录**类型，**不能改模型与开关**。

> **对 libtv 的三点提示**：
> ① **GPL-3.0**：作为独立进程调用（Go 后端 `exec`、不链接）**通常可隔离**，但**须法务确认**；**不建议链接进后端**；
> ② ChaiNNer 是**逐帧图像**流水线，**真正的视频补帧仍必须另配 RIFE**，它本身不解决 24/30→60fps；
> ③ **结论：ChaiNNer 不适合作为生产管线** —— 无头未证实 + 无补帧 + 挂住等按键。**直接调 `realesrgan-ncnn-vulkan` + `rife-ncnn-vulkan` 才是正解**（见 §5.3.5）。

**这个方向的优势**：无席位数限制、可水平扩容、**数据不出境**、成本只有 GPU 租用费。
**劣势**：画质与 Topaz 的 Starlight/Astra 生成式超分有明显差距（尤其在退化严重的 GenAI 动画上），需要自己调参与维护。

### 5.3 桌面/专业软件的核实结果（子任务产出，已合并）

#### 5.3.1 结论速览：**「桌面版本身」是死路；但部分厂商另开的 API 产品线是真的（见 §5.3.4）**

| 产品 | 能否 API 化 / 无人值守 | 一句话结论 | 许可 |
|---|---|---|---|
| **ChaiNNer** | ⚠️ **部分**（有官方 CLI，但"无头"未证实，**且无补帧**） | `chainner run <chain.chn>` **确实存在且官方文档化**（自称 "experimental"，文档明载适合 server/Docker）；但**全仓库 0 处 `headless`**、`--override` 只能改文本/数字/文件/目录（**不能改模型与开关**）、**无任何补帧节点**（RIFE 仅用于"图像对齐"；`Interpolate Models` 是权重融合；issue #1109 自 2022 至今仍 OPEN）；且它是 **Electron 应用** → 无头需自行 `xvfb` 实测 | **GPL-3.0** |
| **Real-ESRGAN / RIFE / ncnn-vulkan** | ✅ **完全可以 headless 批处理**（无官方托管 API） | 纯 CLI，Linux 服务器无头批处理是**标准用法**，**退出码可靠** → 天然适配无人值守 | **BSD-3 / MIT** ✅ 商用 |
| **GFPGAN** | ✅ 可（CLI/库） | 人脸修复可用，但**许可有重大坑** | 🔴 **Apache-2.0 但内含 NVIDIA 非商用条款 + DFDNet CC BY-NC-SA** |
| **Video2X** | ✅ 可（CLI） | 超分+RIFE 补帧一条命令，但**按 AGPL-3.0 发布** | 🟠 **AGPL-3.0，SaaS 高危** → 只做内部工具 |
| **Wondershare（万兴）** | ❌ 对视频超分/插帧**无 API** | 万兴**确实有**真实在线的官方 API 平台（Wondershare AILab，网关 `wsai-api.wondershare.com`），但**137 条接口路由中零个视频超分/插帧接口**；超分**只在图像侧** | 未找到视频侧 API 条款 |
| **VideoProc (Digiarty)** | ❌ **完全不可**（无 API、无 CLI） | **2393 条 sitemap URL 中零 API/CLI 页**；批量处理**仅 GUI 队列**，不可脚本化 | 未找到服务端条款 |

> **修正我此前的一个说法**：我在 §5.2 说「ChaiNNer 串流程」——**这不成立为完整的补帧方案**。ChaiNNer **没有补帧能力**，真正的视频补帧必须另配 **RIFE**。ChaiNNer 只解决超分。

#### 5.3.2 🔴 自建路线的许可红线（**上线前必须过法务**）

| 组件 | 许可 | 商用裁定 |
|---|---|---|
| Real-ESRGAN（代码+权重） | **BSD-3-Clause** | ✅ 可商用（保留版权声明） |
| Real-ESRGAN ncnn 版 / ncnn / RIFE / Practical-RIFE / rife-ncnn-vulkan | **MIT / BSD-3** | ✅ 可商用 |
| **GFPGAN** | Apache-2.0 **+ NVIDIA 非商用条款 + DFDNet CC BY-NC-SA** | 🔴 **高风险**：`--face_enhance` 人脸环节**上线前须法务书面确认**。源码 `archs/__init__.py` **自动导入全部 `*_arch.py`，无法只引用一部分来规避** |
| **Video2X** | **AGPL-3.0** | 🟠 **SaaS 高危**：网络服务对外提供可能触发**向用户提供完整对应源码**的义务 → 只做内部工具 |
| **chaiNNer** | **GPL-3.0** | 🟠 进程级独立调用（Go 后端 `exec` 外部 GPL 程序、不链接）**通常可隔离**，但须法务确认；**不建议链接进后端** |
| spandrel 的 `spandrel_extra_arches` | 含**限制性（如非商用）**架构 | ⚠️ **不要使用 `spandrel_extra_arches`**（CodeFormer 等 `+` 项属此类） |

#### 5.3.3 ★★★ 最有价值的发现：托管市场里已有「**为短剧而生**」的现成端点

子任务意外发现两个**公开免鉴权的机器可读目录接口**，可直接枚举并读到官方发布的逐字定价（**证据等级最高的发现方式**）：

- `https://fal.ai/api/models?keywords=<kw>` → JSON，含 `id` / `licenseType` / **`pricingInfoOverride`（逐字定价）** / `publishedAt`
- `https://replicate.com/api/search?query=<kw>` → JSON，含 `run_count` / `hardware` / **`is_official_model`**

由此实证出**最贴合 libtv 需求的端点**：

**🥇 `bytedance/video-upscaler`（字节 vCube）—— 官方简介直接点名「短剧」**

Replicate 页面逐字【页面实证，`https://replicate.com/bytedance/video-upscaler`】：

> 标题：**"ByteDance Video Upscaler – upscale video to 4K 60fps"**
> **"Upscale and enhance video up to 4K at 60fps, with scene-aware presets for AI-generated content, short dramas, UGC, and film restoration."**
> - *"You can take a **480p, 720p, or 1080p** clip and push it up to **2K or 4K at frame rates up to 60fps**."*
> - *"It's built for the kind of content people are generating today — **AI video, short-form drama**, user-generated clips."*
> - ***"The model does both spatial upscaling and frame interpolation in one pass."***
> - *"Use the **pro** tier when faces and skin are in frame."*
> - *"A **5-second clip typically takes 3–5 minutes** end-to-end."*
> - *"Billed **per second of output video**."*

**fal 侧逐字单价**【接口实证，端点 `fal-ai/bytedance-upscaler/upscale/video`，发布 2025-10-31，`licenseType: commercial`】：

> *"Upscaling to **1080p costs $0.0072/s**, 2K costs $0.0144/s, and 4K costs $0.0288/s, at a 30fps rate. **Processing at 60fps doubles the cost** for any resolution. Processing in **`pro` mode makes the price 10 times** of the normal price."*

**→ 成本换算（1080p @60fps = $0.0144/s）【推算】**：

| 成片时长 | standard 档 | pro 档（人脸/皮肤场景） |
|---|---|---|
| 10 秒 | **$0.144** | $1.44 |
| **1 分钟** | **$0.864** | $8.64 |
| 10 分钟 | $8.64 | $86.4 |

> 🔴 **这是本次调研中唯一一个「官方简介直接写 short dramas（短剧）+ AI-generated content + 一次调用同时超分与补帧 + 60fps」的端点** —— 对 libtv 的「AI 短剧 480p→1080p + 60fps」**几乎一对一命中**，且 **standard 档比 Topaz 便宜**（$0.864/分钟 vs Topaz 官方 API $1.12–2.40、Replicate Topaz $2.24 —— **即比 Topaz 最便宜的档位便宜约 1.3 倍，比 Replicate/fal 的 Topaz 便宜约 2.6–4 倍**）。
> ⚠️ **Replicate 侧价目数字未证实**（页面价目 tab 由客户端 JS 渲染；`/pricing` 404、`/api/models/bytedance/video-upscaler` **403**）→ **以 fal 侧单价为准，Replicate 侧需实测**。
> ⚠️ **runs 与稳定性**：`bytedance` 为官方账号（`is_official_model: true`）、34.1K runs；**但「5 秒成片需 3–5 分钟」意味着吞吐比约 36–60×，容量规划必须按这个量级做。**

**🥈 `bitflow/video-super-resolution-rife-pro` —— 超分 + RIFE 补帧，单价固定**

Replicate 页面逐字：*"fast upscaling with **TensorRT** and frame interpolation with **RIFE**"*、*"transforms low-fidelity **15fps** footage into **Cinema-grade 4K 60fps**"*、超分模型可选 *"FoolhardyRemacri, RealESRGAN, Swin2SR or AnimeSharp"*；**$0.19/次**（L40S，典型 ~4 分钟）。
⚠️ **runs 仅 444，属长尾模型**；且它是**包装开源模型的第三方服务**，**未证实其是否遵守 Real-ESRGAN 的 BSD-3 署名要求** → **仅作备选**。

**🥉 `fal-ai/rife/video` —— 纯补帧（RIFE 官方封装）**

`licenseType: commercial`，发布 2025-07-22，单价逐字：**"$0.0013 per compute second"**。
⚠️ **计价口径警告**：单位是 **compute second（GPU 计算秒）**，**不是输出视频秒** → **无法由单价直接推出"每分钟成片多少钱"**，总价 = 实际 GPU 运行秒数 × $0.0013，**官方未公布典型耗时 →【未证实】，必须实测出账**。
同平台其它纯补帧端点：`fal-ai/film/video`（$0.0013/compute second）、`fal-ai/amt-interpolation`（**未证实**）。

**其它非 Topaz 视频超分端点（fal 官方目录逐字）【接口实证】**：

| 端点 | 超分 | 补帧 | 单价（逐字） | 发布日 |
|---|---|---|---|---|
| `blackforestlabs/flux-video-upscale` | ✅ →1080p/2K/4K（precise/creative 双模） | ❌ | **1080p $0.14/s**（precise）、$0.20/s（creative） | **2026-08-20** |
| `fal-ai/flashvsr/upscale/video` | ✅ | ❌ | **$0.0005/MP**（1080p×121 帧 ≈ $0.125） | 2025-11-11 |
| `fal-ai/seedvr/upscale/video` | ✅ SeedVR2，时序一致 | ❌ | **$0.001/MP**（1080p×121 帧 ≈ $0.25） | 2025-09-22 |
| `clarityai/crystal-video-upscaler` | ✅ 高保真 | ❌ | **$0.10/MP/秒**，按 30FPS 档乘倍数 | 2025-12-17 |
| `fal-ai/video-upscaler` | ✅ **"uses RealESRGAN on each frame"** | ❌ | **未证实** | 2024-12-04 |
| `bria/video/increase-resolution` | ✅ up to **8K** | ❌ | **未证实**；标注 "trained on fully licensed and commercially safe data" | 2025-08-26 |

> **⚠️ 关于按「每 MP」计费的端点（`flashvsr` / `seedvr` / `crystal`），不要被低单价误导** —— 我必须把 60fps 的真相算清楚：
> 1080p 单帧 = 1920×1080 ≈ **2.07 MP**。**1 分钟 1080p@60fps = 3600 帧 ≈ 7465 MP**，于是：
> - `fal-ai/flashvsr`（$0.0005/MP）→ **≈ $3.73/分钟**
> - `fal-ai/seedvr`（$0.001/MP）→ **≈ $7.47/分钟**
> - `clarityai/crystal`（$0.10/MP/秒）→ 需按 30FPS 档乘倍数，**量级更高**
>
> → **这些端点单帧单价看似极低，但在「1080p + 60fps」下反而比 Topaz 还贵**；它们的适用场景是**低帧率或低分辨率**的超分。
> **结论：本项目的 1080p@60fps 场景，`bytedance/video-upscaler`（$0.864/分钟）是性价比最优的托管端点，比按 MP 计费的端点便宜 4–8 倍。**

#### 5.3.4 ★★ 桌面厂商的「另一条 API 产品线」——对我的初始假设的重大修正

> **⚠️ 纠正**：我在拼接子任务报告的**中途版本**（51KB）时，曾记录「Krea / AVCLabs / HitPaw / VanceAI / Runway / Vidu / PixVerse 等未被逐个核实」。**子任务随后把完整版（153KB，含 §5/§6/§7）写入同一文件**，这些平台**已被逐个核实**。以下为**核实后的真实结论**，我此前的「覆盖缺口」说法作废。

**最重要的修正**：我原先假设「桌面 AI 增强软件几乎没有官方 REST API」。**实测结论相反 —— 清单里至少 5 家另有官方 API 产品线，其中 HitPaw 与 Runway 直接提供超分+补帧。** 真正「无 API」的只有传统桌面厂商 **Wondershare（视频侧）与 VideoProc**。

| 产品 | 视频超分 | 视频补帧 | 接入形态 | 价格（逐字实证） |
|---|---|---|---|---|
| **★ HitPaw** | ✅ 多模型至 4×，输出至 **8K** | ✅ **有独立 `frame_interpolation` 模型（≤120 FPS）** | `POST https://api-base.hitpaw.com/api/video-enhancer`（`Apikey` 头）+ `POST /api/task-status` 轮询；另有 OSS 预签名上传 / MCP / Playground | 按**输出秒**：1080p ≤30fps **$0.015/s**；**补帧 1080p 60–120fps $0.078/s** → **两段合计 ≈$5.58/分钟** |
| **AVCLabs** | ✅ 至 **2K**（480p/540p/720p/1080p/2k） | ❌ **无** | **MCP over stdio** + JS/TS SDK（`@avclabs.ai/media-mcp`，**MIT**）；⚠️ 桌面版本身无 API | **1 秒 = 1 credit**；Advanced $39.95/500 → **≈$4.79/分钟**；Enterprise 可**私有化部署** + SLA |
| **VanceAI** | ✅ `video_upscale`（scale 2/4） | ⚠️ **`fps` 参数语义未证实** | 官方 **Open API v1**：`POST https://vanceai.com/api/v1/jobs` → 轮询 `GET /v1/jobs/{id}` → `GET /v1/jobs/{id}/result`；两阶段直传 ≤**4.9GB**；**v1 无 webhook**（1.1 计划中）；失败**全额退还** credit；响应含 `credits_estimated` 可实测 | **未给逐项 credit 单价 → 未证实** |
| **Krea** | ⚠️ **仅图片**（至 22K，**Topaz-powered**） | ❌ 未见于 API | 公开自助 REST + Bearer + **`X-Webhook-URL`** + 官方 npm `@krea-ai/sdk` + MCP | Topaz `$0.10`/图、Topaz Generative `$0.27` |
| **Magnific AI** | ✅ 视频 4 个端点至 4K | ⚠️ **仅 `video-upscaler-topaz`**（= Topaz，见 §4.3） | `https://api.magnific.com`，`x-magnific-api-key`，**仅服务器间调用**；50 hits/s、30,000 RPM | credit 制，**逐项单价未证实** |
| **PicWish** | ❌ **纯图片，0 视频** | ❌ | REST（有文档站与免费额度） | 未取到 → 未证实 |
| **Wondershare（视频）** | ❌ | ❌ | 有真实 API 平台（`wsai-api.wondershare.com`，137 条路由全枚举）但**零视频超分/插帧** | — |
| **VideoProc** | ❌ | ❌ | **无 API、无 CLI**（sitemap 2393 条 URL 零 API/CLI 页） | — |
| **Media.io** | ⚠️ **未证实** | ⚠️ **未证实** | 官方首页 HTML 中**确实存在** `https://developer.media.io/`（开发者门户）与 `https://www.media.io/cli/`（CLI 页）**两个官方入口链接** → 极可能有 API+CLI；但这两地址**自身内容 9 次重试仍无法取证**（直连 000 / 代理 500·520·522） | **未证实** |
| **Cutout.pro** | ❌ 未见开发者入口 | ❌ 未见 | 首页经代理取得（1.2MB），标题 `AI Image Editing & Video Generation \| Cutout.pro`；但 **href 全量扫描 `api`/`develop`/`business`/`enterprise`/`cli` → 0 命中** | — |
| **Neural.love** | ⚠️ **无法取证** | ⚠️ **无法取证** | 直连 000，代理 522（6 次重试全失败）→ **失败 ≠ 没有 API** | — |

**★ 视频生成平台的独立超分/补帧端点**（子任务已全量核实，我独立复核了 Runway/Vidu/PixVerse 三条）：

| 平台 | 独立超分 | 独立补帧 | 端点与价格（官方原文） |
|---|---|---|---|
| **Runway** | ✅ | ✅ | `POST /v1/video_upscale`，用 model 区分：**`magnific_video_upscaler_creative`**（$0.007/帧 @720p·1k、$0.009@2k、$0.012@4k，**上限 30 秒**）与 **`enhance_frame_rate`**（1 credit/2s = **$0.005/秒输入**，**上限 300 秒**）。→ **超分与补帧可分别调用、分别计价**；1080p 档超分+补帧 60fps ≈ **$12.9/分钟**（⚠️ 比托管替代品贵 5–25 倍，但**补帧极便宜**）。**其超分模型 id 是 `magnific_...`，说明 Magnific 超分已 API 化。** |
| **火山引擎 VOD**（**「即梦」的超分/插帧在这里**） | ✅ | ✅ | `POST https://vod.volcengineapi.com?Action=StartExecution&Version=2025-01-01`，`Modules[].Type` = **`SR`（智能超分）/ `VFI`（智能插帧）**；**智能超分 8 元/分钟（闲时 2.4）、智能插帧 2.7 元/分钟（闲时 0.81）**；**场景模板预设里直接有「短剧」** → **超分+插帧 ≈ 10.7 元/分钟，闲时仅 3.2 元/分钟**。⚠️ **"即梦 AI" 本产品线（136 篇文档）零命中超分/插帧** —— **别在即梦 API 上白找** |
| **Vidu** | ✅ | ❌ | `POST https://api.vidu.com/ent/v2/upscale-new`（1080p/2K/4K/8K），1080p **$0.05/s ≈ $3.0/分钟**；支持 `callback_url` |
| **PixVerse** | ✅ | ❌ | `POST /openapi/v2/video/upscale/generate`，5 credits/s（美元单价**未证实**）；≤30s |
| **Kling / 可灵** | ❌ | ❌ | **88 个官方文档模块全量检索零命中**（95 个唯一端点全为生成类） |
| **MiniMax / Hailuo** | ❌ | ❌ | 仅有限制的 `video_regeneration`，官方明文 *"does not perform general-purpose processing of arbitrary videos"* → **不能当通用超分，是浪费评估时间的陷阱** |

> 🔗 **与兄弟报告的分工**：国内云厂商（阿里云 / 腾讯云 MPS / 火山引擎）的完整视频增强 API 与价格由 **`02-cn-cloud-video-enhance-apis.md`** 详述；本报告只保留（a）我独立复核的腾讯云 CI 计费表（§4.5）、（b）火山引擎 SR/VFI 与本需求的成本换算，作为**路径排序**的输入。

> **其余 fal 侧旁证**：`fal-ai/kling-video/o3/4k/*` 是**「原生生成 4K」而非「对已有视频超分」**，对 libtv 的 480p 成片**不适用**；`runwayml/upscale-v1` 出现在 WaveSpeedAI 目录（**$0.11/次**，见 §4.3），与 Runway 自身 API（上表）是**两条独立路径**。

> **对路径排序的影响**：HitPaw 与 AVCLabs 证明了「桌面厂商的 API 产品线」真实存在，**但它们都贵得多**（≈$4.79–5.58/分钟，是 `bytedance/video-upscaler` 的 5–6 倍），且 **AVCLabs 根本不补帧**。→ **它们只能作为「合规备选」（如私有化部署要求），不进入首选路径。**

#### 5.3.5 自建路线：硬件、速度、架构

**两条技术路线对比**【源码/页面实证】：

| 维度 | **路线 A：ncnn + Vulkan**（`realesrgan-ncnn-vulkan` + `rife-ncnn-vulkan`） | **路线 B：PyTorch + CUDA**（`inference_realesrgan_video.py` + Practical-RIFE） |
|---|---|---|
| GPU 要求 | **只需支持 Vulkan**（NVIDIA/AMD/Intel 核显均可） | **需 CUDA**（NVIDIA）；AMD 走 ROCm |
| 依赖复杂度 | ✅ **极低**：官方便携二进制 *"includes all the binaries and models required. **No CUDA or PyTorch environment is needed.**"* | ⚠️ 高：CUDA + PyTorch + basicsr/facexlib 等 |
| 功能完整度 | ⚠️ **不支持 `outscale`**（不能任意倍率），固定 2/3/4× | ✅ 全：**`--outscale` 任意倍率（如 2.25× 直达 1080p）**、`--tile`、`--num_process_per_gpu` |
| 多 GPU | ✅ `-g 0,1,2`；RIFE 甚至支持 `-g -1,-1,0,1`（**CPU + 独显 + 核显一起跑**） | ✅ `CUDA_VISIBLE_DEVICES` |
| 画质 | 官方警告分块拼接可能引入 *"block inconsistency"*，*"generate slightly different results from the PyTorch implementation"* | 更好（官方原版实现） |
| 纯 CPU | ⚠️ 基本不可行（**必须 Vulkan GPU**） | ⚠️ 可跑但**慢到不可用于生产** |

**⚠️ 显存数字：Real-ESRGAN/RIFE 的 README 均未公布显存占用表 →「480p 整帧不分块推理需要多少显存」【未证实】**，必须在目标卡上实测。官方提供 `-t/--tile`（分块）与 `--tile_pad` 正是为了"显存不够时降显存"；`tile=0` = 不分块（最吃显存、最快、**无接缝**）。

**🔴 速度量级（做容量规划最重要的数字）**【实证，来自多个真实发布数据】：

| 数据点 | 值 | 来源 |
|---|---|---|
| **ByteDance vCube 云服务** | **5 秒成片端到端 3–5 分钟** | Replicate README 逐字 |
| `lucataco/real-esrgan-video`（A100-80G） | 典型 ~127 秒/次，~$0.18/次 | Replicate 页面 |
| `bitflow`（L40S + TensorRT） | 典型 ~4 分钟/次，~$0.19/次 | Replicate 页面 |

> → **量级锚点：云侧 480p→1080p/60fps 大约是「成片时长的 35–60 倍」**（5 秒 → 3–5 分钟）。
> → **即：1 分钟成片单卡约需 35–60 分钟；10 分钟成片约需 6–10 小时。**
> 🔴 **强烈建议：不要相信任何二手吞吐数字，先做一次基准测试**（子任务给出了可复现命令：取 10 秒 480p 片段，量 `realesrgan-ncnn-vulkan` + `rife-ncnn-vulkan` 的墙钟时间、`nvidia-smi` 峰值显存），得到 **秒/帧、峰值显存、单卡并发上限** 三个数字后再推容量。

**建议的自建架构（Go 后端视角）**：

```
Go 后端 (libtv)
  └─ 任务队列
       └─ Worker: 每条视频一个 job → 在 GPU 机器上 exec 子进程
            Step 0  ffprobe 取 fps/分辨率/色彩/音频流（保留音频与色彩元数据）
            Step 1  拆帧：ffmpeg -vsync 0 → 16bit PNG（避免中间 8bit 量化）
            Step 2  超分：realesrgan-ncnn-vulkan -n realesr-animevideov3 -s 2 -g <gpu>
                    （480p×2=960p → 再 LANCZOS 到 1080p；或改用 PyTorch 版 --outscale 2.25 一步到位）
            Step 3  补帧：rife-ncnn-vulkan -i out -o out2 -g <gpu>   (30→60fps)
            Step 4  合帧：ffmpeg -framerate 60 ... -i audio.m4a -c:a copy（音频直通）
            Step 5  回报：退出码 0/非 0 + 产物路径
```

**四个要点**：
1. **两个 ncnn 工具都有可靠退出码**（不像 chaiNNer 会挂住等按键）→ **天然适配无人值守**；
2. **音频必须显式 `-c:a copy` 直通**，否则会丢音轨；
3. **顺序：先超分再补帧**（与 `03-open-source-selfhost.md` §4.1 结论一致）；
4. **优先整帧不分块**（`-t 0`），480p 输入通常装得下，避免接缝；若必须分块，**用大 tile**。

---

## 6. 结论：480p → 1080p + 60fps 的接入路径排序

### 6.1 路径评估表

| # | 路径 | 可行性 | 接入方式 | 成本量级（每 1 分钟成片） | 耗时量级 | 主要坑 |
|---|---|---|---|---|---|---|
| **1** | **Topaz 官方 API**（`prob-4` + `apo-8`） | ✅ **推荐** | REST 异步：`POST /video/` → `accept` → 上传 → `complete-upload` → `status`/webhook；`X-API-Key` 鉴权；可 `source.external`/`destination.external` 免上传/免下载；可一次 filters 串超分+插帧 | **~14–20 credits ≈ $1.1–2.4**（$0.08–0.12/credit）【推算】 | 官方只公布**超时上限**（Proteus 系 ~4h、Starlight 系 ~17h）；**典型耗时未公布【未证实】** | ①**商业 SaaS 转售授权未证实，须书面确认**；②请求 JSON ≤3000 字节；③补帧会改帧率，须 `audioTransfer:"Copy"` 保音轨；④49 号模型 `stab-1`/稳定 API 化未证实；⑤Starlight 系贵 ~8.6× |
| **2** | **fal.ai 托管 Topaz** | ✅ 可行（**最省事**） | fal 队列 API（`submit`/`status`/`result` 或 `subscribe`+webhook）；`Authorization: Key ...` | `precision`+`interpolate` 组合：**1080p 60fps 约 $2.4–3.6/分钟**；单靠 `precision` 的 `target_fps=60` 约 **$1.2/分钟**（1080p）【同事核实】【推算】 | 未声明，未证实 | ①**5 分钟时长硬上限**（fal 侧）→ **超过 5 分钟必须本地切段**；②**计价口径自相矛盾**（precision 页两套数字差 1.2–1.5×）→ **投产前必须小额实测出账**；③`interpolate` 端点**不超分**，必须两段拼接；④仅银行卡/ACH + 美元，无人民币；⑤数据出境合规（无 PIPL 机制）、无亚太区域；⑥生成媒体仅存 7 天 |
| **3** | **桌面版 CLI 自动化**（`tvai_up`/`tvai_fi`） | ❌ **不建议 / 授权不成立** | Windows(或 macOS) + GPU 主机跑 `ffmpeg -filter_complex "tvai_up=...,tvai_fi=..."` | 桌面 cloud credit 最低 **$0.055/credit**，SD→1080p Tier2 ~22–26 + 插帧 ~2–4 = **~24–30 credits ≈ $1.3–3.8/分钟** | 本地/云渲染，未公布 | ①**Linux / VM / eGPU 官方不支持**；②**1 seat，不能多实例**；③>**$1M 营收需 Pro**；④**EULA 禁止 redistribute**；⑤**CLI 文档已下架、Starlight Mini 不支持 CLI**；⑥云渲染入口在 GUI，无法后端调用 |
| **4** | **桌面版云渲染**（GUI 点） | ❌ 不可 API 化 | 人工在 GUI 操作 | SD→1080p + 60fps ≈ **~24–30 credits ≈ $1.3–3.8/分钟** | 页称"无并发上限"、适合 30 分钟以上长片 | **无法编程调用**；不支持稳定/SDR→HDR/crop；Starlight 限 9000 帧 |
| **5** | **🥇 `bytedance/video-upscaler`**（字节 vCube，fal / Replicate）**——非 Topaz，但最贴合本需求** | ✅ **强烈推荐优先验证** | 标准 REST：fal 队列 API（`submit` + webhook）；`licenseType: commercial` | **1080p@60fps = $0.0144/秒 ≈ $0.864/分钟**（= 1080p $0.0072/s × 60fps 翻倍）；pro 档（人脸/皮肤）×10 = $8.64/分钟 | **官方明载「5 秒成片端到端 3–5 分钟」** → 吞吐比 **35–60×**（1 分钟成片单卡 35–60 分钟） | ✅ **一次调用同时完成超分+补帧**（"does both spatial upscaling and frame interpolation in one pass"）；官方简介**直接点名 "short dramas" + "AI-generated content"**；⚠️ 容量规划必须按 35–60× 做；⚠️ Replicate 侧价目未证实，以 fal 侧为准 |
| **6** | **Replicate 上的 Topaz 官方模型**（`topazlabs/video-upscale`） | ✅ **可行，Topaz 系里最省事** | Replicate 标准预测 API（`POST /v1/predictions` + 轮询/webhook，`Bearer <token>`） | **`$0.187/5s`（720p→1080p/60fps）= $0.0374/秒 ≈ $2.24/分钟** | 未公布 | ①参数最薄：**只有 `target_resolution` + `target_fps`，无 `upscale_factor`、不能选插帧/增强模型**；②**结算口径歧义**（README 表格 vs 页面 `price`/`p50price`/`per-unit` 四套数字不一致）→ **必须实测出账**；③支付与发票未证实 |
| **7** | **Freepik / Magnific API**（`video-upscaler-topaz`） | ✅ 可行（**参数语义最清晰**） | `POST /v1/ai/video-upscaler-topaz` → `GET /v1/ai/video-upscaler-topaz/{task-id}`；域 `api.magnific.com`；`magnificApiKey`；**支持 `webhook_url`** | **【未证实】官方无任何 credit 数字** | 未公布；503 = 高负载，建议指数退避 | ①**价格未知，无法做预算**，须先谈商务；②`docs.freepik.com` 实为 **Magnific API** 文档（Freepik 已收购 Magnific） |
| **8** | **腾讯云数据万象 CI**（超分+插帧，**非 Topaz**） | ✅ **可行，境内合规最优** | 腾讯云 CI 媒体处理（**API 层封装形态未核实【未证实】**） | **基础版 3.2 + 插帧 12 = 约 15.2 元/分钟**；增强版 12+12 = 约 24 元/分钟 | 未公布 | ①**不是 Topaz**，画质需自测；②**API 封装/并发配额未证实**；③与 COS 存储耦合 |
| **9** | **自建开源流水线**（Real-ESRGAN + RIFE） | ✅ 可行（**自主可控**） | Go/Python 服务封装 CLI；Linux 无头批处理是标准用法，**退出码可靠** | **仅 GPU 租用成本**（量级远低于以上） | **单卡约 35–60× 成片时长**（1 分钟成片需 35–60 分钟） | ⚠️ **许可红线**：`GFPGAN` 含 **NVIDIA 非商用条款**（人脸增强须法务确认）、`Video2X` 是 **AGPL-3.0**（SaaS 高危）；`Real-ESRGAN` BSD-3 / `RIFE` MIT ✅ 可商用 |
| **10** | **WaveSpeedAI 非 Topaz 替代**（`video-upscaler` + `rife`） | ✅ 可行（**成本极低**） | WaveSpeed API | **1080p ≈ $0.31/分钟**，**比 Topaz 路线便宜约 7 倍、比 vCube 便宜约 2.8 倍** | 未公布 | ①**不是 Topaz**，画质需自测；②`video-fps-increaser` 是否支持任意 `target_fps` **未证实** |
| **11** | **火山引擎 VOD**（`SR` + `VFI`，**境内**） | ✅ 可行（**境内最便宜**） | `POST vod.volcengineapi.com?Action=StartExecution&Version=2025-01-01`，`Modules[].Type` = `SR`/`VFI` | **超分 8 元/分钟 + 插帧 2.7 元/分钟 = 约 10.7 元/分钟（≈$1.5）**；**闲时仅 3.2 元/分钟（≈$0.45）** | 未公布 | ✅ **场景模板预设里直接有「短剧」**；✅ 人民币、可开票；⚠️ **"即梦 AI" 产品线本身零超分/插帧，别在即梦 API 上白找**；⚠️ 详见 `02-cn-cloud-video-enhance-apis.md` |
| **12** | **Runway**（`/v1/video_upscale`） | ✅ 可行（**超分/补帧可分开买**） | `POST /v1/video_upscale`，model = `magnific_video_upscaler_creative` 或 `enhance_frame_rate` | 超分 $0.007/帧@720p·1k（**60fps 1 分钟 ≈$12.9**）；**补帧极便宜：$0.005/秒输入（1 分钟仅 $0.30）** | 未公布 | ⚠️ **超分比托管替代品贵 5–25 倍**；超分端点**上限 30 秒**（补帧端点 300 秒）；**若要省钱可只买它的补帧** |
| **13** | **HitPaw API** | ⚠️ 可行但**贵** | `POST api-base.hitpaw.com/api/video-enhancer`（`Apikey`）+ `/api/task-status` 轮询 | 1080p 超分 $0.015/s + **补帧 60–120fps $0.078/s** → **≈$5.58/分钟** | 未公布 | ①**是桌面厂商里唯一同时有超分+独立补帧 API 的**；②⚠️ **若能一次调用完成则降至 ≈$1.80（差 3 倍）—— P0 待实测** |
| **14** | **AVCLabs Media MCP** | ⚠️ 可行但**贵且不补帧** | **MCP over stdio** + JS/TS SDK（MIT） | **≈$4.79/分钟** | 未公布 | ❌ **无补帧能力** → **不满足本需求**；✅ 但 Enterprise 可**私有化部署**（合规备选） |
| **15** | **Vidu / PixVerse** | ⚠️ 仅超分 | `POST api.vidu.com/ent/v2/upscale-new`；`POST /openapi/v2/video/upscale/generate` | Vidu 1080p **$0.05/s ≈ $3.0/分钟**；PixVerse 5 credits/s（美元**未证实**） | 未公布 | ❌ **均无补帧** → 不满足本需求 |
| **16** | **VanceAI Open API v1** | ⚠️ 待证实 | `POST vanceai.com/api/v1/jobs` → 轮询；两阶段直传 ≤4.9GB；失败全额退款 | **未证实**（但响应含 `credits_estimated`，可 5 秒任务实测） | 未公布 | ⚠️ **`video_upscale` 的 `fps` 参数语义未证实**（是插帧还是重新计时？）→ **必须实测**；官网有 "Smoother With AI" 但**不在 API tool 表内** |

### 6.2 推荐方案

**第 0 步（先做，且与写代码无关但决定成败）——把「授权」和「支付」两条前置条件钉死**

1. **发邮件给 `enterprise@topazlabs.com`**，书面确认四件事：
   ①Topaz 输出用于**面向终端用户的商业 SaaS**是否许可（含是否需要 Pro/企业档）；
   ②是否需要署名或水印；
   ③企业档与 **on-premise deployment** 的形态与报价（这是唯一能同时解决"授权 + 跨境 + 数据合规"的方向）；
   ④**同一问题也要问第三方托管路径**——因为我们已确认 **Replicate 把 Marketplace 模型的合规责任推给使用者**（§2.7），**换平台不等于换授权**。
   → **在拿到书面答复前，Topaz 只能作为"可选增强档"，不得进入产品关键路径。**
2. **确认支付与发票通道**：实测已证 **fal.ai / Replicate / freepik / Topaz 官方 API 从中国大陆均可直连（0.6–2.3s）**，网络不是瓶颈；**瓶颈是跨境支付与能否开中国增值税发票**（四家开票能力**全部未证实**）。其中 **WaveSpeedAI 明确支持微信支付+支付宝**，是唯一可无障碍付款的境外平台。
   → **建议把"支付通道"当作独立的技术选型维度**，而不是等选定 API 后再去解决。

**第一阶段（最快验证画质，三路并行小额试产）**

因为**三条路的参数形态高度不同**，建议直接用同一批 480p 测试片段同时跑，用出账与画质决定：

| 路线 | 调用形态 | 试点要点 |
|---|---|---|
| **A. 🥇 `bytedance/video-upscaler`（fal）** | `fal-ai/bytedance-upscaler/upscale/video`，fal 队列 API + webhook | **最贴合本需求**：官方简介直接写 *"AI video, **short-form drama**"*，且 *"does both spatial upscaling and **frame interpolation in one pass**"*；**1080p@60fps = $0.864/分钟（比 Topaz 官方 API 的 $1.12–2.40 便宜 1.3–2.8×，比 Replicate/fal 的 Topaz 便宜 2.6–4×）**；⚠️ 必须验证**短剧画风下的实际画质**，以及 face/skin 镜头是否需要 `pro` 档（×10 价） |
| **B. Topaz 官方 API** | 一次请求串 `[{"model":"prob-4"},{"model":"apo-8","fps":60}]`，输出 `resolution:{1920,1080}` + `frameRate:60` + `audioTransfer:"Copy"` | 功能最全（可串去噪/超分/插帧、可选 Starlight 档、可 webhook、可 `source/destination.external`、**能保音轨**）；**授权待确认** |
| **C. Replicate `topazlabs/video-upscale`** | `target_resolution:"1080p"` + `target_fps:60` | **Topaz 系里最省事、单价最低（≈$2.24/分钟）**；但**参数最薄**、**计价口径四套数字需实测对账** |
| **D. WaveSpeedAI 非 Topaz 替代** | `wavespeed-ai/video-upscaler` + `wavespeed-ai/rife` | **成本最低（1080p ≈ $0.31/分钟）**，且**可微信/支付宝付款**；代价是不是 Topaz、画质需自测 |
| **E. 腾讯云 CI**（若合规要求必须境内） | 腾讯云 CI 媒体处理 | **境内、人民币、可开票**，约 15.2 元/分钟；**API 封装形态待核实** |

> **建议的验证顺序**：**A 与 B 先各跑同一批 480p 短剧片段**（A 便宜、B 可控且能保音轨），**用出账与画质决定主路径**；C 作为 Topaz 侧的省事兜底；D 用于压成本；E 仅在必须境内结算时启用。
> **千万不要在只看了官方文案的情况下就选型** —— 本调研已发现 **fal 文案宣称 8×/120fps 而 Schema 实际封顶 4×/60fps**、**Replicate 四套计价口径并存**、**Topaz 帧插值两套计价冲突**三处官方自相矛盾，**唯有实测出账可信**。

**模型选择建议（针对「GenAI 漫剧/短剧 + 480p 源」）**：

- **保真优先**（不改变画面语义、适合全片默认）→ **`prob-4`(Proteus)**，最便宜最稳，官方称 "The default choice"。
- **官方对 480p→1080p 的 GenAI 短剧首选推荐是 `slp-2.6`(Starlight Precise 2.6)**，但它**贵约 8.6 倍** → 建议只用于**关键镜头 / 片头片尾 / 人物特写**。
- **动画风格保持** → `ganim-1`(Gaia 2 Animation)：**全表最便宜（300 帧/credit @1080p）**，但**只有 2×**，480p 只能到 960p → **要 1080p 需配合其它模型或接受 960p**。
- **补帧**：用 **`apo-8`(Apollo) + `fps:60`**，**不要加 `slowmo`**（`fps` 提帧率不变时长；`slowmo` 会改动时长）。成本敏感时可用 **`apf-2`(Apollo Fast)** 省一半——官方对「24→60 这类非整数倍转换」推荐的正是 Apollo Fast。

**工程上必须先落的两条约束**（无论走哪条路）：

1. **超过 5 分钟的成片要切段**——这一条只对 **fal.ai 托管端点**成立（fal 侧声明 5 分钟上限）；**Topaz 官方 API 与 Replicate 均未公布时长上限**，但仍建议按段落处理以降低单点失败成本。
2. **音轨处理**——Topaz 官方 API 可用 `audioTransfer:"Copy"` 保音轨；而 **fal/Replicate 的托管端点与桌面版帧插值都可能丢音频**，需要选带音频透传的参数或后期用 `ffmpeg` 合并回原音轨。**这是最容易被漏掉的工程细节。**

**第二阶段（确定主路径并产品化）**

- 在第一阶段实测出账后，按「画质 × 单价 × 授权确定性 × 支付可行性」四维打分，锁定 1 条主路径 + 1 条兜底。
- **务必接 webhook**：官方 API 用 `notifications.webhookUrl`；fal 用队列 `subscribe`+webhook；Replicate 用 prediction webhook。**不要纯轮询**（官方耗时上限到 4–17 小时，轮询会浪费配额且易踩 429）。

**第三阶段（长期自主可控 / 降本）**

- 并行推进**自建 Real-ESRGAN + RIFE** 流水线作为成本下限与合规兜底（数据不出境、无席位限制、可水平扩容），与 Topaz 做画质/成本 A/B。
- 若自建达到可接受质量，把 Topaz 降级为"高价值镜头"的可选档位。

### 6.3 成本速算（供预算参考）

以 **480p @30fps → 1080p @60fps** 为口径，每 **1 分钟**成片：

| 路径 | 美元 | 人民币（≈7.1） | 备注 |
|---|---|---|---|
| **🥇 `bytedance/video-upscaler`（fal，standard）** | **$0.864** | **≈ ¥6.1** | **超分+补帧一次调用**，官方点名"short drama" |
| `bytedance/video-upscaler`（fal，**pro** 档） | $8.64 | ≈ ¥61 | 人脸/皮肤镜头建议用；**×10 价** |
| **WaveSpeedAI 非 Topaz 替代**（`video-upscaler` + `rife`） | **≈ $0.31** | **≈ ¥2.2** | **全场最低**；支持微信/支付宝 |
| **Topaz 官方 API**（Proteus 8 + Apollo 6–12 credits） | **$1.12–2.40**（$0.08–0.12/credit） | **≈ ¥8–17** | 唯一能保音轨 + 可串去噪/超分/插帧 |
| Topaz 官方 API（改用 Starlight Precise 2.6 超分） | $6.0–9.7 | ≈ ¥43–69 | 贵约 8.6×，建议只用于关键镜头 |
| **Replicate `topazlabs/video-upscale`**（$0.187/5s） | **≈ $2.24** | **≈ ¥16** | 参数最薄、计价口径四套数字 |
| **fal.ai Topaz**（`precision` + `interpolate`） | **$2.4–3.6** | **≈ ¥17–26** | 5 分钟上限；`interpolate` 不超分需两段拼接 |
| **腾讯云数据万象 CI**（超分基础版 + 插帧） | **≈ $2.14** | **¥15.2** | **境内、可开票**；超分增强版方案 ¥24 |
| **火山引擎 VOD**（`SR` + `VFI`） | **≈ $1.51** | **¥10.7** | **境内**；**闲时仅 ¥3.2**；**模板预设含「短剧」** |
| **HitPaw**（超分 + 独立补帧，两段调用） | **≈ $5.58** | ≈ ¥40 | ⚠️ 若一次调用可完成 → **≈$1.80**，P0 待实测 |
| **AVCLabs Media MCP** | ≈ $4.79 | ≈ ¥34 | ❌ **不含补帧** |
| **Runway**（1k 超分 60fps + 补帧） | ≈ $12.9 | ≈ ¥92 | ⚠️ 最贵；但**只买它补帧仅 $0.30/分钟** |
| **Vidu**（仅超分） | ≈ $3.00 | ≈ ¥21 | ❌ 无补帧 |
| `fal-ai/flashvsr`（$0.0005/MP） | ≈ $3.73 | ≈ ¥26 | ⚠️ **按 MP 计费，1080p@60fps 反而比 Topaz 贵** |
| `fal-ai/seedvr`（$0.001/MP） | ≈ $7.47 | ≈ ¥53 | ⚠️ 同上 |
| `bitflow/video-super-resolution-rife-pro` | $0.19/次 | ≈ ¥1.35 | 超分+RIFE 一体，**但 runs 仅 444，长尾** |
| Freepik/Magnific `video-upscaler-topaz` | **未证实** | — | **无任何公开 credit 数字** |
| VanceAI Open API v1 | **未证实** | — | 响应含 `credits_estimated`，可实测 |
| 桌面版云渲染（Proteus Tier2 + 插帧） | $1.3–3.8（$0.055–0.125/credit） | ≈ ¥9–27 | ❌ 无法编程调用 |
| **自建**（Real-ESRGAN + RIFE） | **仅 GPU 成本** | — | ⚠️ 吞吐仅 **35–60×**（1 分钟成片需 35–60 分钟单卡） |

> **量级结论（五条）**：
> 1. **Topaz 系三条路径**（官方 API / Replicate / fal）**都落在 $1.1–3.6 / 分钟**，**彼此差异不大** —— 选 Topaz 时**不要为单价纠结，应优先看「授权确定性 + 支付开票 + 参数能力（能否保音轨/串去噪）」**。
> 2. **🥇 `bytedance/video-upscaler` 的 $0.864/分钟比 Topaz 各档都便宜（1.3–4×，取决于对标哪一档），且一次调用同时超分+补帧、官方点名短剧** —— 这是本次调研**最贴合 libtv 需求**的发现，**建议优先做画质 A/B**。
> 3. **境内最优是火山引擎 VOD（¥10.7/分钟，闲时仅 ¥3.2）**，比腾讯云 CI（¥15.2）更便宜，且**模板预设含「短剧」**；两者都**人民币、可开票**。**若合规要求境内结算，这是首选。**
> 4. **桌面厂商的 API 产品线（HitPaw $5.58 / AVCLabs $4.79）比托管方案贵 5–6 倍，且 AVCLabs 不补帧** → **只能作为合规备选，不进首选路径**。
> 5. **自建路线的真实瓶颈不是钱，是吞吐（35–60×）** —— 1 分钟成片单卡要 35–60 分钟，**容量规划必须按这个量级做**，否则会成为产品体验瓶颈。
>
> **交叉验证**：官方计算器 CSV 中「**1080p 输出 @30fps = 0.2333 credits/秒**」→ **14 credits/分钟**，与上表 Proteus+Apollo 的推算下限一致，说明 Topaz 量级可靠。

---

## 7. 未证实事项清单（**禁止作为决策依据**）

| # | 事项 | 说明 / 已尝试 |
|---|---|---|
| 1 | **API 输出用于商业 SaaS 二次分发的授权** | 官方文档无说明；`watermark` 只是技术参数；EULA 链接 `https://www.topazlabs.com/eula` **返回 404**。**必须发邮件问 enterprise@topazlabs.com** |
| 2 | **API 的典型处理耗时** | 官方只公布**超时上限**（GAN 视频 ~4h / 生成式 ~17h），未公布典型时长。已知接口会返回耗时区间估计，但需 API Key 才能实测 |
| 3 | **并发/速率限制的具体数字** | 官方只说过载 429 + 指数退避，**无数字配额** |
| 4 | **是否有输入时长上限** | 文档明确"未指定"；但**无实测验证**（>5 分钟、>30 分钟的长片未跑过） |
| 5 | **`stab-1`（稳定）是否在正式 API 中可用** | `stab-1` 在 OpenAPI 枚举里，但**不在 `/video/status` 的 50 个模型中**；且桌面云渲染**不支持**稳定 |
| 6 | **帧插值计费的两套口径冲突** | 「家族页 = Fast 1 / Quality 2 per 10s@1080p30」 vs 「Apollo 模型页 = 2× 慢放 @1080p 10s = 1 credit」。**两者不一致，需实际调用对账** |
| 7 | **fal.ai `precision` 端点的计价两套口径冲突** | 同页既写"$0.10/10s@720p"，又写"1 分钟 $0.40@720p"，按前者应为 $0.60。**投产前必须实测出账** |
| 8 | **Replicate 上 Topaz 模型的「Additional Terms」** | 已确认 `topazlabs/video-upscale` 是官方模型（1.1M runs、2026-09-18 更新），但**未找到 Topaz 的附加条款文本**；而 Replicate ToS 明确把 Marketplace 模型的合规责任推给使用者 → **授权风险未解，必须问 Topaz** |
| 8b | **Replicate `video-upscale` 的实际结算口径** | 页面同时存在 4 套数字：README 表格 `$0.187/5s`、JSON `"price": "$0.0001 per second"`、`p50price $0.0060`、`current_tiers {"price":"$0.08","per-unit"}`。**必须实测出账** |
| 8c | **Freepik/Magnific `video-upscaler-topaz` 的价格** | `docs.freepik.com/pricing.md` 只说是 credit 制，**无任何数字**；`llms-full.txt`（935KB）grep `[0-9]+ credits` **零命中**；`freepik.com/api` 与 `magnific.com/ai/docs/...credits` 均被 **WAF 403**。**须联系销售或查控制台** |
| 8d | **WaveSpeed `video-fps-increaser` 是否支持任意 `target_fps`** | 页面仅自称 "**doubles** your video frame rate"，**未给出任意目标 fps 参数**；`wavespeed-ai/rife` 的参数亦未逐项核实 |
| 9 | **中国大陆对 `api.topazlabs.com` 的延迟/稳定性/长时大文件上传** | 仅确认"可直连、~0.7s 返回 401"（`video/express`）；**>100MB 上传与长任务的稳定性未测** |
| 10 | **跨境支付与开票能力**（本项目最大未知项） | fal / Replicate / Freepik 的**支付方式与能否开中国增值税发票全部未证实**。仅确认 **WaveSpeedAI 支持微信支付+支付宝**；Topaz 官方 API 仅 Stripe 月付信用卡。**这比网络连通性更可能成为阻断点** |
| 11 | **`topazvideo.cn` / `topazstudio.cn` 等中文站是否为官方授权渠道** | 疑似镜像/联盟站，**未证实** |
| 12 | **官方 CLI 是否仍随桌面版发布、参数是否与 2024 年示例一致** | CLI 文档页已 404；示例来自 2024 年 v4.0.9；**当前版本行为未验证** |
| 13 | **Topaz Video 桌面版 Cloud Rendering 的 credit 成本是否与 API credits 同池** | 未证实；两类 credit 单价明显不同（$0.055 起 vs $0.08 起），疑为两套体系 |
| 14 | **权重/模型是否可本地部署** | API 的 Enterprise 档提到 **on-premise deployment**，但**具体形态、门槛、报价未证实**（值得作为降低跨境与授权风险的方向去问） |
| 15 | **`source.external` / `destination.external` 的实际可用性与 S3 兼容性** | 规范原文确认存在，**但未实测**（需 API Key 与预签名 URL） |
| 16 | **多 filter 的实际执行顺序** | 官方**明确不保证**按数组顺序执行；「去噪→超分→插帧」三段式的真实效果**未验证** |
| 17 | **第三方平台（fal/Replicate/WaveSpeed）是否也有「优先使用 Topaz 模型」的商业条款** | 未证实；若我们要做商用产品，须一并确认 |
| 18 | **腾讯云 CI 的 API 层封装形态与并发配额** | 本次只核实了**计费页**（原文价格已逐格确认）；**其超分/插帧的 API 调用方式、是否有专门的媒体处理模板、并发与时长上限均未核实**。另需确认其**画质是否满足漫剧/短剧需求** |
| 19 | **`fal-ai/topaz/video/enhance` 已被证伪**（OpenAPI 404），**但 fal 是否还有其他未列出的 Topaz 端点** | 子任务按命名规律猜的额外 id 均实测失败；**以已确认的 8 个端点为准** |
| 20 | **国内聚合站是否有 Topaz**（302.AI / AIHubMix / 云雾） | 302.AI：`topaz`/`超分`/`补帧`/`插帧` 全 0 命中，只有**图片**超分 `302ai-Upscale-Fast`（$0.005/次）；**AIHubMix 与云雾从大陆双方独立测试全部 HTTP 000 超时 → 无法核实**；**EchoAPI 不是模型平台**（是 Postman 类调试工具）；**CloseAI 是纯 OpenAI 文本转发代理**。→ **均无 Topaz 视频能力** |
| 21 | **`bytedance/video-upscaler` 在 Replicate 侧的价目** | fal 侧有逐字单价（$0.0072/s @1080p 30fps，60fps 翻倍）；**Replicate 侧价目 tab 由客户端 JS 渲染，`/pricing` 404、`/api/models/bytedance/video-upscaler` 403** → **未证实，须实测出账** |
| 22 | **`bytedance/video-upscaler` 在 480p 短剧上的实际画质** | 官方文案自称适配 "AI-generated content, short dramas"，**但无任何第三方画质评测**；且 `pro` 档要 ×10 价（$8.64/分钟）。**必须自测，不能只信文案** |
| 23 | **`fal-ai/rife/video` / `fal-ai/film/video` 的"每分钟成片"总价** | 单价是 **$0.0013/compute second（GPU 计算秒）**，**不是输出视频秒**；官方**未公布典型耗时** → 总价无法推算【未证实】，须实测 |
| 24 | **`bytedance/video-upscaler` 的时长上限与并发** | 官方只说 "5-second clip typically takes 3–5 minutes"，**未公布时长上限**；fal 的 Topaz 端点是 5 分钟上限，**该端点是否同样受限未证实** |
| 25 | **自建流水线的显存占用与吞吐倍数** | Real-ESRGAN / RIFE 的 README **均未公布显存占用表**；「480p 整帧不分块推理需要多少显存」**未证实**；**必须按 §5.3.5 的基准测试方法自测**（秒/帧、峰值显存、单卡并发上限） |
| 26 | **HitPaw 能否一次调用同时完成超分+补帧** | 若能，成本从 **$5.58 降至 ≈$1.80/分钟（差 3 倍）**。官方文档把超分与补帧列为不同 model，但**是否支持单请求组合未证实** → **P0 待实测**。另：HitPaw 官网免费额度 1000 vs 5000 **自相矛盾** |
| 27 | **VanceAI `video_upscale` 的 `fps` 参数语义** | 官方三处文本（`vanceai-api-doc.md` / 文档站 / `SKILL.md`）**都只列参数名，均未解释是"插帧"还是"重设输出帧率"**。官网有 "Smoother With AI" 产品但**不在 API tool 表内**。→ **必须实测**：30fps 片段带 `fps:60`，看输出**帧数是否真翻倍**（帧数翻倍且时长不变 = 真插帧） |
| 28 | **Media.io 的 API / CLI 是否覆盖超分与补帧，以及价格** | ⭐ **最高优先级续查项**。其官方首页 HTML **确实含** `developer.media.io` 与 `media.io/cli/` 两个官方入口 → ✅ **极可能有官方 API + CLI**，与 VideoProc「无 API 无 CLI」**形成直接对照**（注意 Media.io 与 VideoProc 同属 Digiarty/Wondershare 生态圈）。但**两个地址的内容、能力范围与价格全部未证实**（直连 000；代理对子域/路径持续 500·520·522，共 9 次重试）。**证据强度：代理证据，低于直连。** 请在**网络畅通环境**优先访问这两个 URL |
| 28b | **Cutout.pro / Neural.love 是否有 API** | Cutout.pro：首页经代理可取，**href 扫描无任何开发者入口**（但**不等于没有**）；Neural.love：**直连与代理均失败**。→ **均未证实**，**「失败 ≠ 没有 API」** |
| 29 | **各厂商 API 的商用条款** | HitPaw / AVCLabs / VanceAI / Krea / Magnific / Runway / Vidu / PixVerse 的 **API 商用授权条款均未逐字找到** → 若用于商业 SaaS，须逐家确认 |
| 30 | **Magnific 是否确已被 Freepik 收购** | 已证实的只是**同一法律主体 + `docs.freepik.com` 301→`docs.magnific.com`**；`magnific.com` 主站**全程 403**，**收购公告本身未证实** |
| 31 | **火山引擎 VOD 超分的输入分辨率下限** | 场景模板页写「最高支持片源分辨率：1920*1080」，**但 480p 输入是否被接受、以及超分到 1080p 的实际档位未证实** → 须实测（这直接影响本项目能否用） |
| 32 | **明确拒绝采信的来源** | `klingapi.com`（**非快手官方域名**）、`kreaai.app` / `krea.im` / `kreacn.com`（**仿冒站**）、`www.krea.com`（实为另一家公司 "IT solutions - KREA"）、**全部搜索引擎摘要**（本环境搜索完全不可用，污染严重） |

---

## 附：本报告主要来源 URL

**官方 API / 文档**
- API 产品与定价页：https://www.topazlabs.com/api （2026-10-04）
- 开发者文档首页：https://developer.topazlabs.com/
- 文档索引：https://developer.topazlabs.com/llms.txt
- **Video API OpenAPI 规范（YAML）**：https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/video-12-25-updated.yaml
- Image API OpenAPI 规范：https://openapi.gitbook.com/o/HctdcUHRfIWXBVA1egPp/spec/image-yaml-feb-2026.yaml
- 视频快速开始：https://developer.topazlabs.com/getting-started/video-quickstart
- 模型选择：https://developer.topazlabs.com/getting-started/model-selection
- 模型计价：https://developer.topazlabs.com/getting-started/model-pricing
- 逐模型计价：https://developer.topazlabs.com/getting-started/individual-model-pricing
- 计价计算器：https://developer.topazlabs.com/credit-calculator
- **计算器主价格表 CSV**：https://hebbkx1anhila5yf.public.blob.vercel-storage.com/master_price_table-dccnxGID3lbiE98svUZkCXHqT8nIZl.csv
- API Playground：https://playground.topazlabs.com/
- **实时模型列表（无需鉴权）**：https://api.topazlabs.com/video/status
- FAQ（超时/退款/C2PA）：https://developer.topazlabs.com/resources/faq
- 家族页：`/video-models/proteus`、`/video-models/starlight`、`/video-models/astra`、`/video-models/denoise`、`/video-models/frame-interpolation`、`/video-models/video-utilities`
- 模型页：`/video-models/frame-interpolation/apollo`、`/aion`、`/chronos`；`/video-models/starlight/starlight-precise-2.6`、`/starlight-hq`、`/starlight-mini`、`/starlight-fast-3`；`/video-models/astra/astra-2`；`/video-models/proteus/proteus`、`/rhea`、`/gaia-2-animation`
- 企业与 Starlight 方案：https://www.topazlabs.com/enterprise 、https://www.topazlabs.com/starlight
- 产品页：https://www.topazlabs.com/topaz-video 、https://www.topazlabs.com/astra 、https://www.topazlabs.com/topaz-gigapixel

**官方支持文档（桌面版）**
- 系统要求（**Linux/VM/eGPU 不支持**）：https://docs.topazlabs.com/topaz-video/system-requirements
- 云渲染（**9000 帧限制 + SD 480p 成本表 + credit 价格**）：https://docs.topazlabs.com/topaz-video/cloud-rendering
- 帧插值滤波器说明（**补帧会移除音频**）：https://docs.topazlabs.com/topaz-video/filters/frame-interpolation
- 席位数与商用授权：https://docs.topazlabs.com/sales-account-licensing/before-you-buy/how-many-computers-can-i-use-my-apps-on
- 条款与条件：https://docs.topazlabs.com/sales-account-licensing/before-you-buy/terms
- EULA 页：https://docs.topazlabs.com/sales-account-licensing/end-user-license-agreements （其中指向的 `https://www.topazlabs.com/eula` **已 404**）

**社区论坛（CLI 证据）**
- CLI 选项（含 `tvai_up`/`tvai_fi` 串联示例，2024-02-29）：https://community.topazlabs.com/t/command-line-documented-options/64122
- CLI 与 Starlight Mini（官方确认不支持，2025-06-05）：https://community.topazlabs.com/t/cli-starlight-mini/92066
- Linux Beta（2023-12-08）：https://community.topazlabs.com/t/topaz-video-ai-linux-beta-v4-0-7-0-b/58180

**第三方 / 交叉参考**
- fal.ai 相关：见 `04-hosted-apis-and-gpu-cloud.md` §1 与 §附录（含 fal ToS / DPA / 隐私政策 / 并发文档 URL）
- **fal 公开模型目录接口（免鉴权，含逐字定价）**：https://fal.ai/api/models?keywords=upscale%20video
- **Replicate 公开搜索接口（免鉴权）**：https://replicate.com/api/search?query=upscale
- **`bytedance/video-upscaler`**：https://replicate.com/bytedance/video-upscaler 、 https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video
- **Replicate Topaz 官方账号**：https://replicate.com/topazlabs 、 https://replicate.com/topazlabs/video-upscale
- **Replicate 服务条款（Marketplace Models 合规责任）**：https://replicate.com/terms
- **Freepik / Magnific API**：https://docs.freepik.com/ 、 https://docs.freepik.com/api-reference/video/video-upscaler-topaz/upscale-video.md
- **WaveSpeedAI**：https://wavespeed.ai/pricing（支付方式）、https://wavespeed.ai/api/models（1054 个模型）
- **腾讯云数据万象 媒体处理费用**：https://cloud.tencent.com/document/product/460/58120 （⚠️ 需 `curl --compressed`）
- **ChaiNNer**：https://github.com/chaiNNer-org/chaiNNer 、 https://chainner.app/ 、 https://github.com/chaiNNer-org/chaiNNer/blob/main/docs/05--CLI.md
- **Real-ESRGAN**：https://github.com/xinntao/Real-ESRGAN ；ncnn 版：https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan
- **RIFE**：https://github.com/hzwer/Practical-RIFE ；ncnn 版：https://github.com/nihui/rife-ncnn-vulkan
- **GFPGAN（许可红线）**：https://github.com/TencentARC/GFPGAN/blob/master/LICENSE
- **Video2X（AGPL-3.0 高风险）**：https://github.com/k4yt3x/video2x
- **Wondershare AILab API**：https://ailab.wondershare.com/doc
- **HitPaw API**：https://developer.hitpaw.com/enhance/video-enhancement 、 https://developer.hitpaw.com/get-started/pricing 、 https://developer.hitpaw.com/get-started/available-models 、 https://www.hitpaw.com/hitpaw-api.html
- **AVCLabs Media MCP**：npm `@avclabs.ai/media-mcp`
- **VanceAI Open API v1**：https://vanceai.com/developers/ 、 https://vanceai.com/doc/ 、 https://github.com/VanceAI/VanceAI-Skills/blob/main/vanceai-api-doc.md
- **Krea API**：npm `@krea-ai/sdk`；**Magnific API**：https://api.magnific.com
- **Runway API**：https://docs.dev.runwayml.com/api.md 、 https://docs.dev.runwayml.com/guides/pricing.md
- **火山引擎 VOD（SR/VFI）**：https://www.volcengine.com/docs/4/2124632 、 https://www.volcengine.com/docs/4/117971 、 https://www.volcengine.com/docs/4/1941013
- **Vidu**：https://api.vidu.com/ent/v2/upscale-new ；**PixVerse**：https://app-api.pixverse.ai/openapi/v2/video/upscale/generate
- **PicWish API**：https://picwish.com/api
- **Media.io 开发者/CLI 入口（内容未取证，**最高优先级续查**）**：https://developer.media.io/ 、 https://www.media.io/cli/

**兄弟报告（本报告刻意不重复其内容）**
- `02-cn-cloud-video-enhance-apis.md` —— 国内云厂商（阿里云 / 腾讯云 MPS / 火山引擎）视频增强 API 与价格
- `03-open-source-selfhost.md` —— 开源自建的画质与选型讨论（本报告 §5.3.5 只保留工程落地细节）
- `04-hosted-apis-and-gpu-cloud.md` —— 托管 API 与云 GPU