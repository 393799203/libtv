# RTC / CDN / 云存储厂商「视频超分 / 插帧 / 画质增强 / 老片修复」API 调研

> 项目背景：libtv（Go 后端，漫剧/短剧 AI 视频生成平台）需要把生成的 **480p 成片**做「清晰化」：
> 视频超分（480p→720p/1080p，2~3 倍）、去噪/去块/锐化、老片修复、补帧（24/30→60fps）。
> 本文只回答一件事：**这些厂商有没有可以直接调用的「文件级」（对已生成的 MP4 做处理）API。**

调研/抓取日期：**2026-10-04**（下文逐条列出抓取到的页面自身标注的「最近更新时间」）
调研方式：**直接 curl 官方文档站 / 官方 OpenAPI 文档**，`--compressed` + 完整浏览器 UA。**全程未使用任何搜索引擎**（按任务说明 Bing 结果被严重过滤；DuckDuckGo 亦不可达）。
**所有结论均来自实际抓取到的页面文本，未使用任何二手转述；抓不到的写「未证实」。**

---

## 0. 结论速览（TL;DR）

| 厂商 | 是否有**文件级**超分/插帧/画质增强 API | 一句话结论 |
|---|---|---|
| **七牛云** | ✅ **有，且很完整** | 唯一一家提供真正「文件级」超分 API 的厂商。`aicvt` 超分 fop 2x/3x、`avthumb` SDR→HDR、音频降噪、图像超分，走 `pfop` 异步持久化处理 + `prefop` 查询。**无插帧/补帧**。 |
| **又拍云** | ❌ **完全没有** | 官方异步/同步音视频处理参数**全量枚举后无任何**超分、插帧、去噪、锐化、HDR、修复参数；站内搜索「超分」零结果。 |
| **即构 ZEGO** | ❌ 只有**拉流端实时超分** | `super-resolution` 是客户端 SDK 在**拉流端对视频流画面**倍增（360p→720p），限制 1 条流、原始分辨率不建议 >640×360、**需联系 ZEGO 技术支持特殊编包**。不是文件处理。 |
| **网易云信** | ❌ 只有 **RTC 实时 AI 超分** | `enableSuperResolution` 作用于**本端接收到的第一路 360P 视频流**，需技术支持开通。全库检索无文件级超分/插帧/画质增强。 |
| **声网 Agora / 声网** | ❌ 完全没有 | 媒体服务只有云端录制/旁路推流/输入在线媒体流/云端转码/RTMP 网关/服务端 SDK/PPT 转码；云端转码是**直播流转码**（RTC 频道 → RTC 频道），不是文件处理。云市场插件是 SDK 管道内的**实时**帧处理（美颜/变声）。 |
| **UCloud** | ❌ 完全没有 | OpenAPI「视频服务」只有 **云直播 ULive** 和 **实时音视频 URTC**，两者 API 全量列表中无任何画质增强 Action；文档索引里**没有视频点播/多媒体处理产品**。 |
| **京东云**（补充） | ❌ 无 | 视频点播只有转码/剪辑/模板管理，关键词零命中。 |
| 金山云 / 移动云 / 天翼云 / 联通云（补充） | 见本文件 §7A（金山云，已核实 **❌ 无**）与 §7B + `rtc-cdn-optional.md` | **金山云 ❌ / 移动云 ❌ / 天翼云 ❌ / 联通云 ❓未证实**（站点 403+502，抓不到官方文档） |

### ⚠️ 对 libtv 最关键的判断

**「实时视频增强」≠「对 MP4 成片做超分」。** 本次调研的 6 家里有 **2 家**（即构 ZEGO、网易云信）确实有「超分」这个词，但**全部是 RTC 实时链路里对视频流做增强**（声网虽无「超分」产品，但其云市场插件同样是实时帧处理，属同类混淆风险）：

- 处理对象是**实时的音视频流帧**（RTC 拉流端 / 推流端 / SDK 媒体管道），不是磁盘上的 MP4 文件；
- 输入被强约束为**低分辨率小流**（云信：第一路 360P；即构：建议 ≤640×360）；
- 需要**客户端 SDK 集成**（拿到的是 SDK 接口如 `enableSuperResolution`，不是 HTTP API），即构还需要**厂商特殊编包**；
- 没有任务 ID、没有轮询、没有回调、没有按分钟计价 → **无法用于后端的「成片批处理流水线」**。

**因此：在本次调研的全部 10 家厂商（6 家必需 + 4 家补充）里，只有七牛云可以直接解决 libtv 的 480p 成片清晰化需求。** 补帧（24/30→60fps）则**10 家全无**。

---

## 1. 七牛云（qiniu.com）—— ✅ 确实有文件级超分 API

七牛云「智能多媒体服务（Dora）」有独立的 **画质增强** 产品分类，包含 5 个能力：
`视频色彩增强`、`音频降噪`、`视频超分`、`倍速视频超分`、`图像超分`。
来源（官方文档导航）：https://developer.qiniu.com/dora （页面日期未知，站内页脚 © 2026 七牛云）

### 1.1 视频超分 `aicvt`

- **接口 / fop 参数名**（官方文档页，最近更新时间 **2024-08-15 17:21:51**）：
  - URL：https://developer.qiniu.com/dora/12508/video%20super%20resolution
  - fop 串：`aicvt/format/<Format>/vcodec/<VideoCodec>/srMode/<SRMode>/superResolution/<SuperResolution>`
  - 参数：
    - `/format/<Format>`（必填）：输出封装格式，**暂不支持 m3u8**
    - `/vcodec/<VideoCodec>`（选填）：`H.264`（默认）/ `H.265`
    - `/srMode/<SRMode>`（选填）：`base`（默认，基础版）/ `faceEnhance`（人脸增强版，独有人脸增强模块）
    - `/superResolution/<SuperResolution>`（选填）：**取值范围 [2,3] 的整数**，按源视频宽高 **2 倍或 3 倍**输出
- **能力覆盖**：
  - 超分倍率：**仅 2x / 3x**（整数，无 4x）
  - 人脸增强：有（`srMode/faceEnhance`）
  - 去噪/去块/锐化：文档表述为「基于深度学习算法，提高视频的清晰度、画质和主观质量」，**未单列去噪/去块/锐化参数** → 未证实可单独控制
  - 插帧/补帧：**无**（见 1.5）
  - SDR→HDR：**不在本接口**，在 `avthumb` 的 `hdr` 参数（见 1.3）
  - 老片修复：文档「应用场景」明确写「**升级老旧片源**：针对画质不理想的老片源进行升级……可将低分辨率的视频，增强转化为高分辨视频」，即定位覆盖老片修复场景（但无专门的「修复」参数）
- **输入限制**（同页「使用限制」）：
  - **输入分辨率仅支持 ≤1920×1080**
  - 输出帧率**默认等于源视频帧率**，取值范围 [1,60]，超出取 60 帧
  - **当前仅支持华东区域的资源处理**
- **调用形态**：**异步持久化处理**，两种触发方式
  1. 对已有资源手动触发：`POST /pfop/`（`Host: api.qiniu.com`）带 `bucket`、`key`、`fops`、`notifyURL`
  2. 上传时自动触发：上传凭证上传策略里设 `persistentOps`（+ `persistentNotifyUrl`）
  - 官方示例：`fops=aicvt/format/mp4/superResolution/2`（2 倍输出）
  - 返回 `persistentId`，用 **`GET /status/get/prefop?id=<persistentId>`** 查询状态
  - 也可配置 `notifyURL` 回调
- **计费**（同页）：`视频超分费用 = 输出文件时长 × 单价`；按分钟计费，**累计总时长不足一分钟不计费**；输出规格按「输出视频分辨率的长边和短边」判定档位（例：长边 ≤2560 且短边 ≤1440 属 2K 档）

### 1.2 倍速视频超分 `aifast`

- **接口 / 参数名**（官方文档页，最近更新时间 **2024-11-01 16:21:33**）：
  - URL：https://developer.qiniu.com/dora/12825/aifast
  - fop 串：`aifast/<Format>/vcodec/<VideoCodec>/superResolution/<SuperResolution>/srMode/<SRMode>/faceFilter/<FaceFilter>`
  - `/superResolution/`：**[2,3] 的整数**，2 倍或 3 倍
  - `/srMode/`：`base`（默认）/ `faceEnhance`
  - `/faceFilter/`：设 `faceFilter/1` 才生效 —— **过滤掉 faceEnhance 模式下人脸过小、人脸角度太大的增强**
  - 编码：`libx264`（默认）/ `libx265`
  - HLS 额外参数：`/segtime/<SegSeconds>`（2–120 秒，默认 10）、`/savePattern/<Pattern>`
- **与 `aicvt` 的差别**：这是「加速版」超分，用于**时长更长的视频**。
- **输入限制**：**仅华东区域**；输入分辨率 ≤1920×1080；输出帧率默认等于源视频帧率 [1,60]；**输出仅支持 mp4 和 m3u8**；
  「若输入文件过小，可能无法达到预期的加速效果，仍按照当前功能计费；**建议用于时长大于 5 分钟的视频**」
- **计费**：同页未列价，价格表见 1.6（表中**没有单列「倍速超分」行**，需按官方定价页确认 → 未证实具体单价，可能按「视频超分」档计费）

### 1.3 视频色彩增强 / SDR→HDR `avthumb`

- **接口 / 参数名**（官方文档页，最近更新时间 **2024-03-29 16:31:35**）：
  - URL：https://developer.qiniu.com/dora/12665/VideoColorEnhancement
  - fop 串：`avthumb/<format>/sdr/<SDR>/colorspace/<ColorSpace>/hdr/<HDR>/maxLuminance/<MaxLuminance>`
  - `/sdr/1`：启用增强 SDR（**HDR 源 → SDR**，不含 HDR 的设备也能尽量还原 HDR 效果）
  - `/colorspace/`：暂只支持 `bt709`；**输入是 HDR 时必须同时设 `sdr/1` 才生效**
  - `/hdr/1`：**启用 SDR 转 HDR**；条件是**输入为 SDR 且指定输出 H.265 编码**；**不能与锐智转码参数（`avsmart`、`smtMaxvbr`、`smtQuality`）和 `pixFmt` 同时使用**
  - `/maxLuminance/`：输出 HDR 最大亮度，单位 nit，**范围 500~1000**，默认 0（自适应）；必须设 `hdr/1` 才生效
- **SDR 转 HDR 的效果指标**（同页）：色域提升至 **BT2020**，色深提升至 **10bit**，亮度最高 **1000nit**
- 响应：文档写「**锐智转码为异步处理**，因此响应分为 2 步：创建异步处理任务，成功则返回异步处理任务 ID，示例 `16864pauo1vc9nhp12`」（即 `persistentId`）

### 1.4 音频降噪 `aicvtAudio`

- **接口 / 参数名**（官方文档页，最近更新时间 **2024-07-24 18:41:59**）：
  - URL：https://developer.qiniu.com/dora/12737/adenoise
  - fop 串：`aicvtAudio/format/<Format>/adenoise/<AudioDenoiseNo>`
  - `/format/`：**当前只支持 mp4**；`/adenoise/1` 开启
  - **开启降噪后音频输出单声道、16000Hz、AAC 编码**（对漫剧成片是有损的，需注意）
- **输入限制**：仅华东区域；**输入分辨率不能大于 2560×1440**
- **可链式**：示例 `aicvtAudio/format/mp4/adenoise/1|avthumb/mp4/loudnorm/1/...`
- **计费**：**0.1 元/分钟**

### 1.5 插帧 / 补帧：**七牛云没有**

- Dora 全站导航的「画质增强」分类只有：视频色彩增强、音频降噪、视频超分、倍速视频超分、图像超分 —— **没有插帧/补帧功能页**。
- 帧率只能通过 `avthumb` 的帧率控制参数设置（官方文档页 https://developer.qiniu.com/dora/1248/audio-and-video-transcoding-avthumb ，页面日期未知）：
  - `/r/<FrameRate>`：视频帧率，默认等于源视频帧率；**`HighFrameRate=0` 取值 [1,30]，超出取 25 帧；`HighFrameRate=1` 允许高帧率，取值 [1,60]，超出取 60 帧**
  - `/HighFrameRate/`：`HighFrameRate=1` 表示保留高帧率
  - 文档**未把 `/r/` 表述为 AI 插帧/补帧**，它是常规帧率控制 → **「七牛云是否提供 24/30→60fps 的 AI 补帧 API」= 未证实（证据倾向为无）**
  - 另外：使用 `avthumb` 且不启用锐智转码、**视频实际处理帧率在 (30,60] 时按「普通转码高帧率价格」收费**

### 1.6 图像超分 `aisr`（视频之外的同类能力，价格实惠）

- 官方文档页，最近更新时间 **2025-06-17 16:35:08**：https://developer.qiniu.com/dora/12509/Image%20super%20resolution
- **输出支持倍数：2 倍、4 倍**；`srMode`：`base`（普通版）/ `enhance`（增强版）
- 文档表述：「有效恢复图像细节和纹理、**降低图像模糊、噪声**」
- 计费：**图像超分（增强版）0.1 元/次；图像超分（普通版）0.04 元/次**

### 1.7 定价（官方定价页）

- **来源（官方定价页）**：https://developer.qiniu.com/dora/12730/volumetric-billing ，**最近更新时间 2024-08-28 14:25:30**
- 计费口径：**后付费**，每月 3~5 日生成上月账单结算；音视频转码按分钟收费
- 帧率分档：**普帧 `<=30` fps；高帧 `30 < r <= 60` fps**

**画质增强 — 中国大陆用户（普通任务单价）：**

| 类型 | 输出规格 | 普通任务单价 | 闲时任务单价 |
|---|---|---|---|
| SDR to HDR（普帧） | 1080p 及以下 / 2K / 4K / 8K | **0.4 / 0.75 / 1.5 / 1.8 元/分钟** | 0.12 / 0.225 / 0.45 / 0.54 元/分钟 |
| SDR to HDR（高帧） | 1080p 及以下 / 2K / 4K / 8K | **0.8 / 1.5 / 3 / 3.6 元/分钟** | 0.24 / 0.45 / 0.9 / 1.08 元/分钟 |
| **视频超分-普通版（普帧）** | 1080p 及以下 / 2K / 4K / 8K | **0.8 / 1.6 / 3.2 / 4.8 元/分钟** | *（表内该行闲时列空白）* |
| **视频超分-普通版（高帧）** | 1080p 及以下 / 2K / 4K / 8K | **1.6 / 3.2 / 6.4 / 9.6 元/分钟** | *（空白）* |
| **视频超分-人脸增强版（普帧）** | 1080p 及以下 / 2K / 4K / 8K | **1.6 / 3.2 / 6.4 / 9.6 元/分钟** | *（空白）* |
| **视频超分-人脸增强版（高帧）** | 1080p 及以下 / 2K / 4K / 8K | **3.2 / 6.4 / 12.8 / 19.2 元/分钟** | *（空白）* |
| 音频降噪 | — | **0.1 元/分钟** | — |
| 图像超分（增强版） | — | **0.1 元/次** | — |
| 图像超分（普通版） | — | **0.04 元/次** | — |

**海外用户（USD，同一页）：** 视频超分-普通版（普帧）1080p 及以下 **0.1232 USD/分钟**、2K 0.2464、4K 0.4928、8K 0.7392；人脸增强版（普帧）1080p 及以下 **0.2464 USD/分钟**；SDR to HDR（普帧）1080p 及以下 **0.0616 USD/分钟**；音频降噪 0.0154 USD/分钟。

**价格量级参照（同页，中国大陆，H.264 普通转码）：** SD480（640×480）**0.0072 元/分钟**、SD（1080×720）0.0189 元/分钟、HD（1920×1080）**0.0324 元/分钟**；锐智转码 HD 0.16 元/分钟。
→ **即：视频超分（0.8 元/分钟 @1080p 普帧）约等于普通 1080p 转码（0.0324 元/分钟）的 25 倍。**

**闲时任务：超分不支持。** `pfop` 文档明确列出「当前只有部分多媒体处理支持设置闲时任务」：1) 普通转码（GPU 转码不支持）2) 锐智转码 2.0 3) 音视频拼接 4) 音视频分段 5) 视频截图 —— **不含视频超分 / SDR→HDR / 音频降噪**。定价表中超分各行闲时列也为空白。
来源：https://developer.qiniu.com/dora/1291/persistent-data-processing-pfop （最近更新时间 **2025-05-16 11:32:24**）

### 1.8 调用形态与轮询（官方文档）

| 环节 | 接口 | 来源 |
|---|---|---|
| 触发（已有资源） | `POST /pfop/ HTTP/1.1`，`Host: api.qiniu.com`，`Content-Type: application/x-www-form-urlencoded`，`Authorization: Qiniu <AccessToken>`；表单参数 `bucket` / `key` / `fops` / `notifyURL` | https://developer.qiniu.com/dora/1291/persistent-data-processing-pfop |
| 触发（上传时） | 上传策略字段 `persistentType`、`persistentOps`、`persistentNotifyUrl`、`persistentPipeline`；`persistentType=1` 为闲时任务 | 同上 |
| 任务 ID | 返回 `persistentId`（未设 returnUrl/callbackUrl 时在响应里直接返回；否则用魔法变量 `$(persistentId)`） | 同上 |
| 状态轮询 | `GET /status/get/prefop?id=<persistentId>`（**目前支持查询 10 天以内**的持久化处理任务） | https://developer.qiniu.com/dora/1294/persistent-processing-status-query-prefop （**2024-11-20 16:02:19**） |
| 回调 | 处理完成后 POST 到 `persistentNotifyUrl` / `notifyURL` | 同上 |
| 管道 | `persistentPipeline` 指定队列名（仅普通任务可指定，闲时任务不能指定队列） | pfop 页 |
| 多命令链式 | `persistentOps` 用 `;` 分隔多命令、`|` 做链式管道，如 `avthumb/mp4|saveas/<urlsafe_base64>` | pfop 页 |
| 结果另存 | `saveas` / `savePattern` | https://developer.qiniu.com/dora/1305/processing-results-save-saveas |

**prefop 响应关键字段**（官方示例）：`id`、`code`、`creationDate`、`desc`、`inputKey`、`inputBucket`、`items[]`（每项含 `cmd`/`code`/`desc`/`error`/`hash`/`key`/`returnOld`）、`pipeline`、`reqid`、`type`、`taskFrom`。

### 1.9 输入限制 / URL 直传 / 开通前置 / 区域

- **输入形态：不支持公网 URL 直传。** `pfop` 的入参是 `bucket` + `key`，处理对象必须是**已在七牛空间中的资源**。文档中未发现「直接对公网 URL 做超分」的 fop 参数 → **未证实（证据倾向为不支持，需先上传或先抓取入库）**。
- **区域：仅华东。** 视频超分、倍速视频超分、音频降噪三页的「使用限制」都明确写「**当前仅支持华东区域的资源处理**」。控制台「使用限制」页也写：「区域……默认为华东。所有任务、任务触发器、工作流和自定义预设只能选择该区域内的空间和文件」（https://developer.qiniu.com/dora/6505/use-the-information ，**2020-12-30 14:21:56**，注意这页较旧且是控制台配额页：每用户最多 50 个任务触发器 / 50 个工作流模板（每模板 ≤50 节点）/ 150 个自定义预设 / 4 个队列）。
- **中国大陆节点：是**（价格体系区分「中国大陆用户 / 海外用户」两套）。
- **开通前置（企业认证/实名、工单开白名单）：未证实。** 在这几页 Dora 文档（视频超分、pfop、产品简介）中检索「实名」**零命中**；也未见「需工单开白名单」的表述。七牛通用开户通常需实名认证，但**本次未抓到官方文档证据，故记为未证实**。
- 文档另提及：持久化处理「资源使用共享资源池……**在特殊请求量集中情况下会有积压**，如果用户有资源保障需要，可以联系我们，付费购买保障力」（pfop 页）。

### 1.10 对 libtv 480p→1080p 的实操要点（基于上述官方文档推导）

- 480p 16:9 = 854×480。`superResolution/2` → **1708×960**；`superResolution/3` → **2562×1440**。
  **七牛只支持整数 2/3 倍，无法一次输出精确的 1920×1080** → 需要后续 `avthumb` 缩放一步，或接受 2K 档（价格跳到 1.6/3.2 元/分钟）。
- 若源为 24/30fps（普帧），走「普通版普帧」**0.8 元/分钟**；若源 ≥30fps 以上会被判高帧，价格翻倍。
- 输入 ≤1920×1080 满足要求（480p 远低于上限）。
- 想同时拿 SDR→HDR：`hdr/1` **必须输出 H.265**，且**不能与 `avsmart`/`pixFmt` 同用**；若还要超分则需用管道/链式命令组合。

---

## 2. 又拍云（upyun.com）—— ❌ 完全没有超分 / 插帧 / 画质增强

### 2.1 核查范围（官方文档页，均为「页面日期未知」）

- 云处理产品导航：https://help.upyun.com/docs/cloud_process/
  - 音视频处理（异步）：https://help.upyun.com/knowledge-base/av/
  - 视频处理（同步）：https://help.upyun.com/knowledge-base/sync_video/
  - 上传预处理：https://help.upyun.com/knowledge-base/av_pretreatment/
- 站内搜索：https://help.upyun.com/?s=超分 （无结果）
- WordPress REST 检索：`https://help.upyun.com/wp-json/wp/v2/posts?search=超分` 返回 `[]`；`wp-json/wp/v2/search` 路由 404
- 官方**定价页**（真实 SSR 页面，含计价器 UI，86KB）：https://www.upyun.com/pricing —— 页面产品线含「CDN / 直播云 / 云存储 / 点播云 / **云处理** / 融合云存储 / 区块链服务」，但**全页对 `超分`/`超分辨`/`画质增强`/`插帧`/`补帧`/`视频增强`/`修复`/`去噪`/`锐化`/`HDR`，甚至泛词 `增强` 的出现次数全部为 0** → 官方连「增强」这个卖点都没在定价页出现过。
- 图片处理（异步）文档 https://help.upyun.com/knowledge-base/async_image/ 同样 **0 命中**（连**图像**超分都没有）。
- 其他产品线导航页也做了同样的关键词扫描，**全部 0 命中**（`超分`/`画质增强`/`插帧`/`视频增强`/`修复`/`锐化`/`增强`）：
  - 短视频：https://help.upyun.com/docs/short_video/ （200，6381 B）
  - 直播云：https://help.upyun.com/docs/live/ （200，6420 B）
  - 内容识别：https://help.upyun.com/docs/content_recognition/ （200，6316 B）
  → 又拍云在「CDN / 直播云 / 云存储 / 点播云 / 云处理 / 融合云存储」全部产品线里都没有画质增强类能力。
- ⚠️ 排除项：`https://www.upyun.com/products/av` 与 `https://www.upyun.com/products/cloud-process` 均返回 **404 页面**（「您访问的页面不存在 / 2 S 后自动返回首页」），**因此这两个 URL 不作为证据使用**。

### 2.2 音视频处理（异步）参数全量枚举 —— 无任何 AI 画质参数

产品形态（官方文档 `av/`）：
- 提交任务：`POST http://p0.api.upyun.com/pretreatment/`，表单 `service` / `notify_url` / `source` / `tasks`（JSON 串 Base64）/ `accept=json`
- **task `type` 取值**：`video`（标准转码）、`nbhd`（窄带高清，官方描述「通过对视频的编码进行优化，**平均降低视频大小 30%**」）、视频拼接（`i`/`h`）、视频截图、音频转码、元数据获取等 —— **没有超分 / 画质增强 / 修复 type**
- 进度查询：`GET http://p0.api.upyun.com/status?service=&task_ids=`（返回百分比，100=完成，-1=失败，null=未开始）
- 结果查询：`GET http://p0.api.upyun.com/result?service=&task_ids=`（返回回调信息）
- 回调：POST 到 `notify_url`
- 一次 `tasks` 最多 10 个任务；`task_ids` 最多 20 个

**视频转码 `avopts` 全部参数（逐条核对，无一与超分/插帧/去噪/锐化/HDR/修复相关）：**
`/vb/`（码率）、`/s/`（分辨率/预置模板）、`/as/`（自动按比例调整）、`/r/`（帧率，推荐 25/30）、`/sp/`（旋转）、`/sm/`（保留元数据）、`/acodec/`、`/vcodec/`（libx264/libtheora/libx265/libvpx-vp9/libvpx/copy）、`/an/`、`/vn/`、`/su/`（**视频加速倍数 [1.0,10.0]**）、`/ar/`、`/ac/`、`/sar/`、`/dar/`、`/pv/`、`/level/`、`/f/`；
切片 `/ht/`；水印 `/wmImg/ /wmGravity/ /wmDx/ /wmDy/`；剪辑 `/ss/ /es/`；动图 `/cr/`；拼接 `/i/ /h/ /codec/`；加密 `/encSch/ /encKid/ /encKey/`。

**结论：参数表里没有任何「ML/AI 超分」「插帧」「去噪/降噪」「锐化」「HDR」「修复」参数。**
`/su/` 是**倍速（时间轴加速）**，不是超分；`nbhd` 是**编码优化省带宽**，不是画质增强。

### 2.3 输入 / 输出格式（同页）

- 输入视频容器：AVI、MP4、FLV、MOV、3GP、ASF、WMV、M3U8(TS)、MPG、F4V、M4V、MKV、VOB（SVCD/DVD）等
- 输出：MP4、FLV、M3U8(TS)、GIF/WebP（动图）
- 输出视频编码：H.264/AVC、VP8、H.265/HEVC、VP9 等
- 预置模板：2160p(16:9) 3840×2160 ≤8000Kbps …… 240p(4:3) 320×240 ≤300Kbps（**是转码模板，不是超分档位**）
- **预置模板/分辨率参数 `/s/` 是普通缩放（resize），不是超分辨率重建** —— 这一点必须区分清楚。

### 2.4 定价 / 开通前置

- 异步音视频处理文档只写「收费方面，见 **价格**」，未在文档页给出单价。官方定价页 https://www.upyun.com/pricing **本次未抓取** → **具体单价未证实**。
- 开通前置：文档写「请确保您已经注册又拍云账号并完成**实名验证**，请确保您已经创建**云存储服务**」（`av/` 页）→ **需实名认证 + 创建云存储服务**。
- 中国大陆节点：又拍云是中国大陆厂商，服务域名为 `p0.api.upyun.com`（杭州/华东）→ 支持中国大陆，但**「是否有海外节点」未证实**。

**一句话：又拍云在音视频领域只做「转码/转封装/水印/剪辑/拼接/加密/窄带高清/截图」，没有任何文件级画质增强能力。**

---

## 3. 即构科技 ZEGO（zego.im）—— ❌ 只有拉流端实时超分

### 3.1 超分辨率（官方文档页，**页面日期未知**）

- URL：https://doc-zh.zego.im/real-time-video-android-java/video/super-resolution
  （同页 iOS 版：https://doc-zh.zego.im/real-time-video-ios-oc/video/super-resolution ；纯文本源可直接取 `.../super-resolution.md`）
- **功能定义（原文）**：「超分辨率（简称超分）功能可以在**拉流端**，对拉取到的视频流画面的宽和高的像素进行倍增。例如：拉流端拉取到的原始画面分辨率为 640p × 360p，对画面进行超分处理后分辨率将提升为 1280p × 720p。」
- **API（客户端 SDK，非 HTTP）**：
  - 初始化：`initVideoSuperResolution`
  - 回调：`onPlayerVideoSuperResolutionUpdate(String streamID, ZegoSuperResolutionState state, int errorCode)`、`onPlayerVideoSizeChanged(String streamID, int width, int height)`
  - 枚举：`ZegoSuperResolutionState { Off, On }`
  - 相关类/枚举文档：`ZegoSuperResolutionState`、`ZegoVideoEncoderEnhancementConfig`、`ZegoLowlightEnhancementMode`、`ZegoColorEnhancementParams`
- **使用限制（原文）**：
  - 「由于同一台设备**同时只能对 1 条流**开启超分功能，因此超分功能**仅适用于在只有单流或者有 1 路焦点流的场景**」
  - 「目前**仅支持对一路拉流画面开启超分**，且该条流的**原始分辨率不建议超过 640p × 360p**」
  - **前提条件**：「已**联系 ZEGO 技术支持进行特殊编包**」+ 集成 ZEGO Express SDK + 控制台创建项目申请 AppID/AppSign
  - Android 12+ 需在 AndroidManifest.xml 声明 `libOpenCL.so` / `libOpenCL-pixel.so`
- **错误码（原文）**：`1004004` 该设备不支持超分；`1004005` 超分流数量超过限制（仅支持一条流超分）；`1004006` 超分原始分辨率超过限制；`1004007` 超分设备性能不足；`1004008` 超分未初始化
- **性能数据（原文举例）**：360p 超分，OPPO R11 电流增量 <60mA、半小时温升 <1.5°C、>95% 设备 CPU 增量 <2% 且内存增量 <100MB → 明显是**端侧实时算力优化**的表述
- **适用场景（原文）**：1V1 视频通话、直播（单流/焦点流）、在线教育（教师板书/发言学生）

### 3.2 推流视频增强（官方文档页，页面日期未知）

- URL：https://doc-zh.zego.im/real-time-video-android-java/video/publish-video-enhancement
- 原文：「ZEGO Express SDK 提供多种**视频前处理增强能力**，开发者可以根据业务需要，**在推流端**对画面的效果进行调整」
- 能力清单：**基础美颜**（美白、磨皮、**锐化**、红润）、**低照度增强**（暗光增强，支持自动模式、传统算法与 AI 级算法按设备性能选择）、**视频降噪**（减少画面噪点，降噪强度可调）、**色彩增强**（保护肤色的前提下增强欠饱和色彩）
- → 这些**全部是推流端实时前处理**，不是对 MP4 文件处理。注意其中的「锐化」「视频降噪」是**美颜链路**里的能力，与「成片去噪锐化」不是一回事。

### 3.3 全站扫描结论

- 抓取官方文档站 sitemap：`https://doc-zh.zego.im/sitemap.xml`（**6413** 条 `<loc>`）
- 用 `enhanc|super|resolution|restore|repair|denoise|interpolat|sharpen` 过滤全部 URL，命中的全部落在**客户端 SDK 产品线**：
  - `real-time-video-{android-java,ios-oc,macos-cpp,macos-oc,windows-cpp,flutter,u3d-cs}/video/super-resolution`
  - `live-streaming-*/video`、`live-streaming-kit-{android,ios}/enhance-the-livestream/advanced-beauty-effects`
  - `client-sdk/api/class/zegosuperresolution*`、`zegolowlightenhancement*`、`zegocolorenhancementparams`、`zegovideoencoderenhancementconfig`
  - **没有任何** `cloud-*` / 服务端产品线出现超分/插帧页
- ZEGO 的云端产品线（sitemap 中有）：`cloud-player`、`cloud-player-server`、`cloud-recording`、`cloud-recording-server`、`aigc-digital-human-server`、`aiagent-server`。对这 6 个产品命名空间下的**全部 URL** 再过滤 `super|resolution|enhanc`：**命中为空**（这些产品的页面只有 `api-reference`/`create-player`/`describe-players`/`create-upload-task`/`describe-tasks`/`describe-record-status`/`callback`/`guides`/`quick-start` 等，全是播放器与录制任务管理）。
- **结论：ZEGO 没有文件级 MP4 超分/插帧/画质增强 API。**
- **计价方式与单价：未证实**（未找到超分的独立计费项；实时超分应随 Express SDK 计费，但**未抓到官方定价证据**）。
- 中国大陆节点：是（有 `doc-zh.zego.im` 中文站、`console.zego.im` 控制台）。

---

## 4. 网易云信（yunxin.163.com）—— ❌ 只有 RTC 实时 AI 超分

### 4.1 AI 超分（官方文档页）

- URL：https://doc.yunxin.163.com/nertc/guide/zYzMjc0NTA?platform=android
  （同内容的互动直播 2.0 版本：https://doc.yunxin.163.com/live-streaming/guide/DgyOTc3ODE?platform=android ）
- **页面更新时间：2025/06/11 16:45:39**
- **产品归类**：音视频通话 2.0（NERTC）→ 集成开发 → **AI 融合功能 → AI 超分**（也就是说它明确属于 **RTC 产品线**，与「点播」无关）
- **功能定义（原文）**：「网易云信自研 AI 超分算法（Super-Resolution, SR）……在视频通话和互动直播场景下，AI 超分功能可以**实时复原低质视频**，提升视频通话体验。」
- **API（原文）**：`NERtcEx.getInstance().enableSuperResolution(enableFlag);`
- **注意事项（原文）**：
  - 「使用 AI 超分功能之前，**请联系技术支持开通** AI 超分功能。」
  - 「AI 超分功能**仅对以下类型的视频流有效**：**必须为本端接收到的第一路 360P 的视频流**；**必须为摄像头采集到的主流大流视频**。AI 超分功能**暂不支持复原重建小流和屏幕共享辅流**。」
- **实现方式（原文）**：本端加入房间并通过 `enableSuperResolution` 开启后，「SDK 会针对接收到的第一路符合条件的视频流进行 AI 超分……该用户离开房间之后，SDK 会选择下一路符合条件的视频流进行 AI 超分。」
- 示例项目源码：`SuperResolution`
- → **处理对象是实时 RTC 接收流，且被约束为「第一路 360P 主流大流」，没有任务 ID/轮询/回调，不可用于成片批处理。**

### 4.2 其他相关实时能力（同一产品线的实时特效）

- `NERtcVideoLowlightEnhanceLevel`（暗光增强等级，枚举）
- `kNERtcBeautyFaceSharpen`（美颜链路里的**锐化**，`NERtcBeautyEffectType`）
- AI 降噪（文档导航「AI 融合功能 → AI 降噪」）
- 「视频色彩空间」功能（官方动态：视频色彩空间功能支持多种色彩标准，出现在 `nertc/concept/TE5MzI1MzA` 的更新日志里）→ **仍是 RTC 实时能力**
- 视频美颜生态：云信美颜 / 相芯美颜 / 商汤美颜 / 腾讯美颜 / 火山美颜 —— 全部是**实时客户端美颜 SDK**

### 4.3 全库检索方法与结论（重要）

网易云信文档站的正文是客户端渲染的（首页 `GET https://doc.yunxin.163.com/` 只返回壳；`.json` 路径会被反爬拦成 "Bot not welcome at this time"；SSR 出来的搜索页**永远**渲染"没有找到您查询的内容"，用它对关键词做判断会全部误判为「无」）。

**可行的检索路径**：从其**公开的 JS bundle** 中还原出文档站自己的公开搜索接口：

- 接口：`GET https://doc-interface.yunxin.163.com/fe/search?keyword=<kw>&limit=20&offset=0`
- 必需请求头：`appid: 2`、`timestamp: <毫秒>`、`signature: <base64(HMAC-SHA256)>`
- 签名串（从 `pages/_app-*.js` 里读出的公开前端常量）：
  `HMAC-SHA256(key = "cca8e25de0694acf8532d9d470877db1", msg = "appId=2&secretKey=cca8e25de0694acf8532d9d470877db1&timestamp=<ts>")` → base64
- 其他可用端点：`/fe/directory`、`/fe/product`、`/fe/pageConfig`、`/fe/changePost`
- 返回：`data.docs[]`，每条含 `title`、`content`（正文摘要，带 `<em>` 高亮）、`path[]`（产品/分类/平台面包屑）、`aid`、`pName` 等

**用该接口全库检索的关键词与命中情况：**

| 关键词 | 命中情况 |
|---|---|
| `超分` / `超分辨率` | **只命中 RTC 产品线**的「AI 超分」（音视频通话 2.0、互动直播 2.0，Android/iOS 等平台），以及无关的「如何调整视频分辨率/帧率」（视频会议组件） |
| `画质增强` | 只命中 `NERoomVideoLowlightEnhanceLevel`、`NERtcVideoLowlightEnhanceLevel`（**暗光增强等级枚举**）和「媒体补充增强信息」(SEI) —— 均为实时能力 |
| `插帧` | 无相关命中（命中的是「火山美颜」「质量指标」「NERtcPreDecoderVideoInfo」等噪音） |
| `老片修复` | 无相关命中（命中的是更新日志） |
| `去噪` | 无视频侧命中（命中的是 IM 的 CollectInfo 等噪音） |
| `锐化` | 只命中 `kNERtcBeautyFaceSharpen`（**美颜锐化**）与 `NERtcBeautyEffectType`、`NERoomBeautyEffectType` |
| `HDR` | 只命中 IM 的 FAQ / Features（与视频画质无关） |
| `转码` | 命中「直播/直播实时转码」「互动白板/文档转码」「点播/防盗链公告」—— **注意「直播实时转码」是直播流，不是文件 AI 处理** |

**结论：网易云信没有文件级（对 MP4）超分 / 插帧 / 画质增强 / 老片修复 API。**「AI 超分」完全属于 RTC 实时链路。

### 4.4 点播（VOD）产品与计价 / 开通前置

- 云信确实有独立的「**点播**」产品（`alias=vod`，产品首页 https://doc.yunxin.163.com/vod/getting-started ，产品定位原文：「基于分布式处理集群和大规模分发系统资源……提供极速稳定的视频上传、存储、**转码**、播放和下载等云服务」），其文档分类为 `concept` / `guide` / `server-apis` / `client-apis`。
- 但 **点播产品在官方文档全库检索中对「超分/画质增强/插帧/修复」零命中**；点播侧能查到的是**转码**（`点播 转码` 检索命中「直播/直播实时转码」与点播公告）→ **文件级 AI 画质增强：未证实（证据倾向为无）**。
  > 说明：点播文档正文同样在客户端渲染，本次未能逐页抓取点播全部服务端 API 列表；上述结论基于**官方文档全库搜索接口**的检索结果，属于间接证据。
- **计价方式与单价：未证实。** 未抓到「AI 超分」的独立计费项或单价（推测随 RTC 音视频通话时长计费，无官方文档证据支撑，故不作断言）。
- **开通前置**：AI 超分**明确「请联系技术支持开通」**（官方文档原文）。
- **中国大陆节点：是。**
- 相关页面（页面日期未知）：https://doc.yunxin.163.com/ 、https://doc.yunxin.163.com/vod/getting-started

---

## 5. 声网 Agora / 声网（agora.io / shengwang.cn / doc.shengwang.cn）—— ❌ 完全没有文件级画质增强

### 5.1 媒体服务产品清单（官方文档站导航，「媒体服务」分组）

抓取 https://doc.shengwang.cn/ 与各产品页导航后，「媒体服务」下**全部**产品为：

**云端录制、本地服务端录制、旁路推流、输入在线媒体流、云端转码、RTMP 网关、RTC 服务端 SDK、PPT 转码服务**

实时互动扩展能力分组：实时转录翻译、互动白板、微呼叫、Status Page、内容审核、云市场、SDK 拓展插件。
→ **没有任何「视频超分 / 画质增强 / 老片修复 / 媒体处理（文件）」产品。**

### 5.2 云端转码（官方文档页，**页面日期 2026/05/08 14:25:36**）

- URL：https://doc.shengwang.cn/doc/cloud-transcoder/restful/overview/product-overview
- 原文：「声网的云端转码服务是专为**实时互动产品**中的**直播场景**而开发。云端转码服务允许你在服务器端**获取 RTC 频道中主播的音视频源流**，并对其进行转码、混音、合图等音视频处理，最后将处理后的音视频流**发布到声网的 RTC 频道**，供观众端订阅。」
- → 处理对象是 **RTC 频道中的实时流**，输出还是 **RTC 流**。**不是文件处理**，更没有画质增强参数。
- 相关 API（RESTful，路径含 `/v1/projects/{appId}/rtsc/cloud-transcoder/tasks`）、`/v1/projects/{appId}/rtls/abr-config/codecs` 等，见 https://doc.shengwang.cn/doc/cloud-transcoder/restful/cloud-transcoder/operations/post-v1-projects-appId-rtsc-cloud-transcoder-tasks
- 计费页存在（https://doc.shengwang.cn/doc/cloud-transcoder/restful/overview/billing ）但**本次未抓取具体数字 → 具体单价未证实**；且该计费与「视频超分」无关。

### 5.3 输入在线媒体流 / 云端播放器（官方文档页，**页面日期 2024/10/09 15:36:01**）

- URL：https://doc.shengwang.cn/doc/media-pull/restful/overview/product-overview
- 原文：「输入在线媒体流功能可以将**一路在线媒体流输入到正在进行直播的房间**……相当于创建了一个云端播放器（cloud player）」
- 服务端 API：创建/更新/查询/销毁云端播放器、查询消息通知服务器 IP（路径 `/v1/projects/{appId}/cloud-player/players`）
- → 是**直播流注入**，不是文件转码/增强。

### 5.4 SDK 拓展插件 / 云市场（**实时**帧处理，非文件）

- URL：https://doc.shengwang.cn/doc/marketplace/android/overview/product-overview
- 原文：「插件可以获取 **SDK 媒体传输管道内**的音视频数据，进行相应处理，然后返回给 SDK，从而实现**美颜、变声**等音视频插件功能。」「云市场插件需要与 **RTC SDK v4.x** 搭配使用」
- 插件开发接口（https://doc.shengwang.cn/doc/marketplace/android/create-extensions/video-filter ）：`IExtensionVideoFilter`（`adaptVideoFrame` / `pendVideoFrame` / `deliverVideoFrame`）、`IExtensionProvider`，`ProcessMode` 有 `Sync` / `Async`
- 对 https://doc.shengwang.cn/doc/marketplace/android/landing-page 做关键词统计：`美颜` 出现 6 次、`变声` 1 次；**`超分` / `插帧` / `画质增强` / `视频增强` / `修复` / `锐化` / `降噪` 全部 0 次**
- → **云市场里的画质类插件是 RTC 实时帧处理（美颜/变声/AI 视觉），不是文件超分。**

### 5.5 全站扫描结论

- 抓取 sitemap `https://doc.shengwang.cn/sitemap.xml`（**8219** 条 `<loc>`），产品命名空间完整清单为：
  `aigc, analytics, art-class, breakout-classroom, chatroom, cloud-recording, cloud-transcoder, console, content-moderation, conversion-ppt, convoai, digital-learning, flexible-classroom, fusion-cdn, game-voice, marketplace, media-pull, media-push, meeting, one-to-one-classroom, one-to-one-live, online-ktv, online-music-class, recording, rtc, rtc-server-sdk, rtm2, rtmp-gateway, rtsa, sdk-extension, showroom, small-classroom, smart-camera, smart-doorbell, smart-watch, speech-to-text, status-page, teleoperation, toybox, voip-callkit, whiteboard`
  → **没有「媒体处理 / 视频增强 / 超分」类产品。**
- 对以下重点产品页做正文关键词扫描（超分/超分辨/插帧/补帧/画质增强/老片修复/去噪/降噪/去块/锐化/SDR/HDR/super resolution/interpolation）：**全部 0 命中**
  - `cloud-transcoder/restful/overview/product-overview`
  - `cloud-transcoder/restful/api/video-profile`
  - `media-pull/restful/overview/product-overview`
  - `recording/restful/overview/product-overview`
  - `marketplace/android/overview/product-overview`
- **结论：声网没有文件级视频超分 / 插帧 / 画质增强 / 老片修复 API。**
- **计价方式与单价：未证实**（无对应产品，无价可列）。
- **开通前置**：媒体服务各产品需在声网控制台（https://console.shengwang.cn ）开通对应服务，各产品文档有 "开通服务"（enable-service）页 —— **具体是否需企业认证/工单白名单未逐一核实 → 未证实**。
- 中国大陆节点：是（中国站 doc.shengwang.cn + console.shengwang.cn；国际站 docs.agora.io）。

---

## 6. UCloud（ucloud.cn）—— ❌ 完全没有

### 6.1 官方 OpenAPI 文档索引：视频服务只有「云直播」和「实时音视频」

- 来源（官方文档）：https://docs.ucloud.cn/api/README.md （「UCloud API 文档中心」，**页面日期未知**）
  该页「文档索引」的 **### 视频服务** 分组**只有两个产品**：

| 产品 | 文档 |
|---|---|
| 云直播 ULive | https://docs.ucloud.cn/api/ulive-api/ |
| 实时音视频 URTC | https://docs.ucloud.cn/api/urtc-api/ |

→ **索引里没有视频点播（VOD）、没有多媒体处理、没有任何 AI 媒体处理产品。**

### 6.2 ULive（云直播）API 全量列表 —— 无任何画质增强 Action

- 来源：https://docs.ucloud.cn/api/ulive-api/_sidebar.md （页面日期未知）
- 全部 Action（逐条核对，原文）：
  `BreakLiveStream` 直播断流、`DelULiveRecordFile` 删除录制文件、`DescribeULiveIPListInfo` 查询 IP 是否归属 CDN、`DisableLiveDomain` 停止直播域名、`ForbidLiveStream` 禁播、`GetDomainPlayOnline` 观众在线人数、`GetDomainPublishOnline` 主播在线人数、`GetLiveBandwidthTraffic` 带宽流量、`GetLiveDomainConfigV2` 域名配置、`GetLiveTrafficRemainV2` 剩余流量、`GetStreamDownloadBandwidth`、`GetStreamPlayOnline`、`GetStreamUploadBitRate`、`GetStreamUploadFrameRate`、`GetULiveBandWidthData`、`GetULiveConfigAppInfo`、`GetULiveDomRealStreamListInfo`、`GetULiveDomainHttpCode`、`GetULiveDomainRequestInfo`、`GetULiveForbidStreamList`、`GetULiveHistoryStreamList`、`GetULiveLinkControlList`、`GetULiveRealBandwidth`、`GetULiveRecordFileInfo`、`GetULiveRecordStatistic`、`GetULiveShiftStatistic`（时移统计）、`GetULiveSnapshotStatistic`（截图计费统计）、`GetULiveStreamDiagnosisInfo`、`GetULiveStreamMonitor`、`GetULiveStreamTrafficData`、`GetULiveTranscodeCnt`（转码并发总数）、`GetULiveTranscodeConfigInfo`（转码配置）、`GetULiveTranscodeStatistic`（转码计费统计）、`GetULiveUshiftDomainLog`、`GetUliveBandwidth`、`GetUliveDomainLog`、`GetUliveProIspBandwidth`、`SetULiveLinkControlList`、`UnforbidLiveStream`
- → **全部是直播流管理/统计/配置类接口，没有任何超分/插帧/画质增强/修复 Action。**

### 6.3 URTC（实时音视频）API 全量列表 —— 无任何画质增强 Action

- 来源：https://docs.ucloud.cn/api/urtc-api/_sidebar.md （页面日期未知）
- 全部 Action：`CreateUrtcApp`、`DescribeURtcStreamByCallId`、`EnableURtcApp`、`GetURtcDaliyConsumption`、`ModifyURtcProjectName`、`QueryURtcApp`、`QueryURtcCallDetail`、`QueryURtcOnlineUsers`、`QueryURtcOrderDetail`、`QueryURtcRoomUsers`、`QueryURtcTargetQosIndex`、`QueryURtcTotalQosIndex`、`QueryURtcUserEvent`
- → 全部是 App 管理 / 房间 / 通话详单 / QOS 指标查询，**无画质增强**。

### 6.4 其他

- UCloud 文档站是 docsify（`basePath: '/'`, `loadSidebar: true`），正文是 markdown，可直接抓 —— 用 `/<路径>/_sidebar.md` 拿导航。根 `/_sidebar.md` 返回 200 但**内容为空**（0 字节）；`/sitemap.xml` 不存在（回落到首页 HTML）。→ **「文档站是否存在媒体处理类产品页」未能通过根导航穷尽核查，本条为限制说明。**
- **结论：UCloud 没有文件级视频超分/插帧/画质增强 API（基于官方 OpenAPI 索引 + 两个视频服务产品的 API 全量列表，证据充分）。**
- **计价方式与单价：不适用**（无对应能力）。
- 中国大陆节点：是。

---

## 7. 京东云（补充核查，非必需清单但顺手做了）—— ❌ 无

- 来源（官方文档页，页面日期未知）：https://docs.jdcloud.com/cn/video-on-demand/product-overview
- 京东云有「**视频点播**」产品，文档导航显示的能力为：视频上传/查看/播放、视频管理、**视频处理**、事件回调（文件上传回调、**转码完成回调**、视频剪辑完成回调）、转码模板管理、转码模板组管理、音视频管理、分类管理……
- 对该页做关键词扫描：`超分`、`插帧`、`画质增强`、`视频增强` **全部 0 命中**；`转码` 命中。
- `https://docs.jdcloud.com/cn/media-processing/product-overview` 返回「页面无法访问」→ **京东云没有名为 media-processing 的产品文档**。
- → **京东云有文件转码，但没有文件级超分/插帧/画质增强。**

---

## 7A. 金山云（补充核查，本人亲自抓取）—— ❌ 无文件级超分/画质增强

（补充清单厂商，完整版另见 `rtc-cdn-optional.md`；以下是本次已**实际抓取并核实**的部分）

**金山云文档站是可抓的（不是纯 SPA）**：https://docs.ksyun.com/ 首页返回约 79KB HTML，含**全产品文档索引**。其中「**视频云服务**」分组只有：`云直播(KLS)`、`云转码(KET)`、`边缘节点计算`；对象存储 `KS3` 在「存储与云分发」下。

### 7A.1 KS3 对象存储：不做视频处理，只做图片处理

- 官方 FAQ 页（**最近更新时间 2024-03-05 14:12:50**）：https://docs.ksyun.com/documents/42274?type=3
  - 原文问：「4. KS3有视频转码服务吗？」**原文答：「请咨询视频云及相关产品，参见 金山云转码服务文档。」**
    → **KS3 本身不提供视频转码/处理，视频类处理一律外挂到「视频云」（云转码 KET）。**
  - 原文问：「1. KS3对象存储支持图片处理吗？」答：「支持。具体信息参见 图片处理文档。」
- KS3「新版图片处理」能力清单（导航列出）：缩放、格式转换、图片信息、获取图片平均色值、质量变换、图片瘦身、渐进显示、去除图片元信息、旋转、自适应方向、镜像翻转、自定义裁剪、内切圆、索引剪切、圆角矩形、模糊、灰度、亮度、对比度、**锐化**、水印、持久化。
  → **有「锐化」但仅是图片处理算子**（与 libtv 要的「视频成片锐化」无关）；**全站 `超分`/`画质增强`/`插帧`/`视频增强`/`修复` 命中为 0**。
- KS3 相关文档页（导航壳 + 侧栏，关键词均 0 命中）：https://docs.ksyun.com/products/25 、https://docs.ksyun.com/documents/45443?type=3（「智能媒体处理（Python）」——该标题实为 KS3 SDK 的媒体处理能力封装，正文未出现任何画质增强关键词）

### 7A.2 云转码 KET：只有转码/截图/水印/剪辑/拼接，无超分

- 产品文档索引：https://docs.ksyun.com/products/34 （导航含「直播转码API」「点播转码API」「模板管理」「任务管理」「SDK」等）
- **「产品功能」页（最近更新时间 2024-08-15 11:33:58）**：https://docs.ksyun.com/documents/1195?type=3
  - 原文能力清单：文件格式及编码格式转换、音视频信息提取、预设转码模板、自定义转码模板、**截图和采样截图**、**水印**、音视频切片处理、Dash 多码率、**视频剪辑**、**音视频拼接**、**视频画面旋转**、外挂字幕、视频转 GIF、音视频抽取；直播侧：直播转码、推/拉流实时转码、**直播截图**、**直播收录**。
  - 关键词扫描：`超分` 0、`画质增强` 0、`插帧` 0、`视频增强` 0、`修复` 0、`锐化` 0、`去噪` 0。
- **点播转码 API 的 Action 全量**（来自 https://docs.ksyun.com/products/34 导航原文）：
  `Preset`（创建模板）、`UpdatePreset`、`DelPreset`、`GetPresetList`、`GetPresetDetail`、`CreateTask`（创建任务）、`DelTaskByTaskID`、`TopTaskByTaskID`、`GetTaskList`、`GetTaskByTaskID`、`GetTaskMetaInfo`（查询 META 信息）
  → **全部是「模板 CRUD + 任务 CRUD」，没有任何画质增强类 Action。**
- **调用方式（已核实）**：点播转码 OpenAPI 调用方式页（**最近更新时间 2025-04-14 14:18:58**）https://docs.ksyun.com/documents/2386?type=3
  - 签名：**AWS 签名算法（AWS4-HMAC-SHA256）**
  - 服务地址（Host）：`kvs.cn-beijing-6.api.ksyun.com`（北京）、`kvs.cn-shanghai-2.api.ksyun.com`（上海）→ **地域只有北京/上海**
  - 请求形式：`/?Action=<Action>&Version=2017-01-01&X-Amz-Algorithm=AWS4-HMAC-SHA256&...`；**支持 GET 或 POST**（GET 参数走 querystring；POST 公共参数走 querystring、接口参数走 JSON Body）
  - 有 QPM（Requests Per Minute）限流
- **创建任务接口（已核实）**：`CreateTask`（**最近更新时间 2024-04-12 17:29:01**）https://docs.ksyun.com/documents/2397?type=3
  - 入参：`Preset`、`SrcInfo`（json array；其 `path` 描述为「**源文件在 ks3 的相对路径**」← **源文件必须在 KS3**）、`DstBucket`、`DstDir`、`DstObjectKey`、`DstAcl`、`IsTop`、`CbMethod`、`CbUrl`、`ExtParam`（JSON 字符串）
  - 异步进度回调：`ExtParam` 里可带 `"Callback":{"progress_cburl":..., "progress_cbmethod":..., "progress_interval":2}`
  - 该页关键词扫描：`超分` 0、`插帧` 0、`增强` 0、`去噪` 0
- **注意一个容易被误读的参数：`kshd`。** 模板说明页（**最近更新时间 2024-08-15 10:42:07**）https://docs.ksyun.com/documents/2387?type=3 的公有参数里有：
  - `Kshd` int 选填 —— 原文：**「集智高清开关参数，0：关闭（默认）1：开启」**
  - → 这是金山云的**感知编码/高清编码优化开关（对标七牛的「锐智转码 avsmart」）**，属于编码器层面的质量优化，**不是超分辨率、不是插帧、不是修复**。务必与「超分」区分。
  - 该页 `VIDEO` 参数详情中**无任何超分/插帧/去噪/锐化/HDR 字段**（关键词全部 0 命中）。
- **KET 里唯一的「AI」能力是「智能封面」，不是画质增强**：同页模板类型共 6 种 —— `avtrans`（转码/拼接/格式转换/水印/切片）、`avsnapshot`（单张截图）、`avinfo`（音视频信息）、`avsample`（采样截图）、`audiowave`（音频波形）、**`aiproduction`（智能媒体生产）**；而 `aiproduction` 的 Param 只有一个字段 `function_name`，**唯一取值 `smart_cover`（智能封面）**。→ 即「AI 挑封面图」，**与视频超分/插帧毫无关系**。
- **直播转码模板另有一个关键限制**：直播转码模板页（**最近更新时间 2022-03-02 16:08:31**）https://docs.ksyun.com/documents/2358?type=3 的 `format` 结构里
  - `kshd`、`output_format`、`width`/`height`（**取值范围 0-3000**）、`abr`（5000~320000 bps）、`vbr`（20000~30000000 bps）、**`fr`（自定义帧率，取值范围 1~30）**、`gop`、`suffix`、`remuxflag`、`exstream`
  - → **`fr` 上限只有 30** 这一点很关键：金山云直播转码模板**连 60fps 输出都不支持**，更谈不上补帧到 60fps。
- **开通前置（有价值的一条硬信息）**：点播转码接入文档（**最近更新时间 2024-08-15 10:47:58**）https://docs.ksyun.com/documents/5855?type=3 原文：
  「Step1 开通KS3服务，创建存储空间（Bucket）…… Step3 开通点播转码服务 …… **注意：以上 Step1、3 需要联系商务开通**，其他步骤如有问题请联系技术支持。」
  → **需要联系商务（销售）开通，不是自助开白名单。**
- **定价**：https://docs.ksyun.com/documents/1200?type=3 （**最近更新时间 2020-10-27 20:11:24**）正文只有一句「价格总览详见 转码产品价格」，**指向外部页面，本次未抓取 → 具体单价未证实**。且**不存在超分计费项**，故对 libtv 不适用。

### 7A.3 金山云结论

**金山云没有文件级视频超分 / 插帧 / 画质增强 / 老片修复 API。** 它的视频能力 = 转码 + 截图 + 水印 + 剪辑 + 拼接 + 切片的常规流水线；`kshd`（集智高清）是编码质量优化，`aiproduction` 只是「智能封面」，`fr ≤ 30` 甚至连 60fps 输出都没有。

---

## 7B. 其余补充厂商（移动云 / 天翼云 / 联通云）—— 结论：均无

完整核查过程与「未证实清单」见独立文件 **`docs/research/parts/rtc-cdn-optional.md`**（554 行）。以下为要点与**我本人交叉复核过**的关键项：

| 厂商 | 结论 | 关键证据 |
|---|---|---|
| **移动云（中国移动）** | ❌ **完全没有**（RTC 侧也没有实时增强） | 视频点播 API 全量清单（`/vodupload/create_task`、`/vod2/t1/trans/create`、`queryTransStatus`、`queryTransPercent`、模板 CRUD、**窄带高清模板 `addRapidHDTemplate`**、Logo 模板、分类、分发、回调 `/trans/finish_callback`、统计）**无任何增强接口**；窄带高清模板字段纯编码器参数（gopsize/refs/bframes/rateControl/frameRate/crf/codecName），**不是超分**；音视频通信只有「码率和帧率的智能调节」，**无美颜/暗光/实时超分**；EOS 的 `image/sharpen,[50,399]` **仅图片**。三重穷举（全站搜索 + 157 个产品目录树 + 5827 条 API 文档树）均无命中。价格页也无增强计费项。 |
| **天翼云** | ❌ **完全没有** | 云点播《功能介绍》「媒体处理」只有转码/多分辨率多码率/水印/截图；新增转码模板 API 字段仅 `codec/bitRate/frameRate/height/width/autoRotate` + 音频参数。官方文档检索接口对 `超分/超分辨率/插帧/画质增强/视频增强/图像增强` **零命中**；视频直播明确「**暂不支持窄带高清转码**」。XStor/ZOS 的 `image/sharpen,[50,399]` **仅图片**。 |
| **联通云** | ❓ **未证实** | `https://cloud.wo.cn/` 根路径 **403**（WAF/tengine），`/op-help-center/`、`/document`、`/docs`、`/product`、`/sitemap.xml`、`/robots.txt` 全部 **502 Bad Gateway**；`docs.cloud.wo.cn`/`yun.wo.cn`/`docs.wo.cn`/`api.cloud.wo.cn` **DNS 不存在**。→ **抓不到任何官方文档，不作结论。** |

### ⚠️ 一个必须警惕的「坑」：天翼云的社区投稿文章

站内检索「超分」时，天翼云唯一命中是一篇标题极具误导性的文章：
《画质提升技术：深度解读天翼云所使用的智能超分、HDR、画质修复等AI增强处理能力》
https://www.ctyun.cn/developer/article/797889601941573

**我本人已抓取该页并核实：它是「天翼云开发者社区」的用户投稿，页脚明确声明「系天翼云实名用户自发贡献，版权归原作者所有」；正文通篇是「某图像超分辨率技术」式的泛论，未点名任何天翼云接口、未给出任何 API 或参数。**
→ **属于「二手来源（可信度低）」，不构成产品能力证据，绝不能作为「天翼云有超分」的依据。** 正确做法是用天翼云的**官方文档检索接口**（`POST https://www.ctyun.cn/v2/search/api/doc/search`，参数 `objectType` 可区分 `help`(官方帮助文档) / `book` / `developArticle`(社区投稿)）做区分——按 `objectType=help/book` 过滤后**官方文档零命中**。

### 7B.1 补充厂商的共性结论（对 libtv 有用）

1. **4 家全部没有公开可调用的「文件级」超分/插帧/画质增强/老片修复 API。**
2. **「窄带高清 / 集智高清」是编码压缩档位，不是画质增强** —— 金山云的错误码甚至直接写「**禁止分辨率、码率小转大**」，从设计上就禁止放大分辨率。
3. **「锐化」在金山云/移动云/天翼云的存储产品里只存在于「图片处理」**（`image/sharpen,[50,399]`），与视频成片无关。
4. **「超清/高清」在多数转码模板里只是分辨率档位名**，不是超分能力。
5. 这些厂商的媒体处理开通普遍**需要联系商务/客户经理或提工单**（金山云 KET 原文「Step1、Step3 需要联系商务开通」；天翼云 XStor 视频截帧需工单/客户经理申请）。

---

## 8. 汇总对比表

### 8.1 能力矩阵（✅ 有 / ⚠️ 仅实时 / ❌ 无 / ❓ 未证实）

| 厂商 | 文件级超分 | 超分倍率 | 插帧/补帧 | 去噪/去块 | 锐化 | SDR→HDR | 老片修复定位 | 调用形态 |
|---|---|---|---|---|---|---|---|---|
| **七牛云** | ✅ `aicvt` / `aifast` | **2x / 3x（仅整数）** | ❌（只有 `/r/` 帧率控制，非 AI 补帧） | ✅（超分算法内含「降低模糊/噪声」，**无独立参数**） | ❌ 无独立参数 | ✅ `avthumb/hdr/1`（需 H.265） | ✅（官方列为「升级老旧片源」场景） | **异步**：`pfop` → `persistentId` → `prefop` 查询 / 回调 |
| **又拍云** | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | 异步 `pretreatment`（仅转码/水印/剪辑/拼接/加密/窄带高清） |
| **即构 ZEGO** | ⚠️ 拉流端实时 | 640×360 → 1280×720（约 2x，实际由 SDK 决定） | ❌ | ⚠️ 推流端实时视频降噪 | ⚠️ 推流端美颜锐化 | ❌ | ❌ | 客户端 SDK `initVideoSuperResolution`，**无 HTTP API** |
| **网易云信** | ⚠️ RTC 实时 | 仅「第一路 360P 主流大流」，输出倍率文档未量化 | ❌ | ❌ | ⚠️ 美颜锐化 `kNERtcBeautyFaceSharpen` | ❌ | ❌ | 客户端 SDK `enableSuperResolution`，**无 HTTP API** |
| **声网 Agora** | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | 无（媒体服务仅录制/推拉流/直播转码） |
| **UCloud** | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | 无 |
| **京东云**（补充） | ❌ | — | ❌ | ❌ | ❌ | ❌ | ❌ | 有文件转码 API，无增强 |
| **金山云**（补充） | ❌ | — | ❌（模板帧率上限仅 30） | ❌ | ❌（KS3 只有图片锐化算子） | ❌ | ❌ | 云转码 KET：模板 CRUD + 任务 CRUD；`kshd`「集智高清」是**编码优化**非超分 |

### 8.2 计价 / 输入限制 / 开通前置对比

| 厂商 | 计价方式 | 具体单价 | 输入限制 | 支持 URL 直传 | 开通前置 | 中国大陆 |
|---|---|---|---|---|---|---|
| **七牛云** | 按**输出文件时长**（元/分钟），后付费，月度结算 | **有**：超分普通版普帧 1080p及以下 **0.8 元/分钟**；高帧 1.6；人脸增强版普帧 1.6、高帧 3.2；2K/4K/8K 逐档翻倍；SDR→HDR 1080p及以下 0.4 元/分钟（普帧）；音频降噪 0.1 元/分钟；图像超分 0.04~0.1 元/次 | 超分输入 **≤1920×1080**；音频降噪输入 ≤2560×1440；输出帧率 [1,60]；超分输出**不支持 m3u8**（aifast 支持 mp4/m3u8）；**仅华东区域** | ❌ **不支持**（`pfop` 入参为 `bucket`+`key`，文件须已在七牛空间） | ❓ 未证实（Dora 文档无「实名」表述，未见白名单要求；但需有七牛空间） | ✅ |
| **又拍云** | 按量（具体口径未抓） | ❓ 未证实（定价页是交互式计价器，无单价表可引用；无任何 AI 增强售卖项） | 音视频异步处理：容器/编码格式见上；`tasks` 单次 ≤10 个任务 | ❌（`pretreatment` 入参为 `service` + `source` 相对路径，须已在云存储） | **需实名认证 + 创建云存储服务**（文档原文） | ✅ |
| **即构 ZEGO** | ❓ 未证实（无独立超分计费项证据） | ❓ 未证实 | 原始流**不建议超过 640×360**；同时**仅 1 条流** | ❌（客户端 SDK，非 HTTP） | **需联系 ZEGO 技术支持特殊编包** | ✅ |
| **网易云信** | ❓ 未证实 | ❓ 未证实 | **仅本端接收的第一路 360P 主流大流**；不支持小流/屏幕共享辅流 | ❌（客户端 SDK，非 HTTP） | **需联系技术支持开通 AI 超分** | ✅ |
| **声网** | ❓ 不适用 | ❓ 不适用 | — | — | ❓ 未证实（各产品需控制台开通） | ✅ |
| **UCloud** | 不适用 | 不适用 | — | — | — | ✅ |
| **京东云** | 不适用 | 不适用 | — | — | — | ✅ |

---

## 9. 未证实清单（明确没拿到的信息 + 试过的 URL）

### 9.1 未证实的结论要点

1. **七牛云「是否支持 URL 直传」** —— 结论倾向「不支持」，`pfop` 必须以 `bucket`+`key` 指定空间内资源。已抓页面中未找到「对公网 URL 直接做超分」的 fop 参数。尝试过：
   - https://developer.qiniu.com/dora/1291/persistent-data-processing-pfop （2025-05-16）
   - https://developer.qiniu.com/dora/3688/the-third-party-data-processing （200，未发现 URL 直传超分）
   - https://developer.qiniu.com/kodo/12663/urls_to_kodo （「以 URL 作为源地址的**数据迁移**至 Kodo」——迁移用途，非按次处理）
   - 猜测并尝试的 fetch API 路径均 404：`/kodo/1234/the-fetch-api`（302→ upload-types）、`/kodo/api/1267/fetch`（404）、`/kodo/1267/fetch`（404）
2. **七牛云开通前置（企业认证/实名、工单白名单）** —— 在 `视频超分`、`pfop`、`产品简介` 三页中检索「实名」均 **0 命中**，未见白名单表述。**未证实**。
3. **七牛云「倍速视频超分（aifast）」的具体单价** —— 定价页「画质增强」表中**没有单列 aifast 行**。**未证实**（需按官方定价页或商务确认）。
4. **七牛云是否有 AI 插帧/补帧** —— 导航与定价页均无对应条目，`avthumb` 只有 `/r/`+`/HighFrameRate/` 常规帧率控制。**证据倾向为「无」，但官方未显式说「不支持」，故记为未证实。**
5. **七牛云视频超分是否有独立的去噪/锐化参数** —— 文档只描述算法效果，**未单列参数**。**未证实**。
6. **又拍云具体单价 / 计价口径** —— 是否抓到定价页：**已抓取** https://www.upyun.com/pricing ，但它是**交互式计价器**页面（拖滑杆估算月费），**没有可直接引用的单价表格**，且全页无「云处理/AI 增强」类计费项 → **单价仍为未证实**。（该页可确认的是：又拍云的产品线里**没有**任何 AI 画质增强售卖项。）
7. **又拍云是否有海外节点** —— 未抓取 → **未证实**。
8. **即构 ZEGO 超分的计费方式与单价** —— sitemap 全站未见独立计费项，未抓定价页 → **未证实**。
9. **即构 ZEGO 超分的实际输出倍率** —— 文档只举例「640×360 → 1280×720」，**未给出可配置的倍率范围** → **未证实**。
10. **网易云信「AI 超分」的计费方式与单价** —— 无官方计价证据 → **未证实**。
11. **网易云信点播（VOD）服务端 API 的完整清单** —— 点播文档正文客户端渲染，本次**未逐页抓取**；「点播无文件级超分」的结论来自**官方文档全库搜索接口**的检索结果（间接证据）→ **建议后续核实**。
12. **网易云信 / 声网 / UCloud 的开通前置（是否需企业认证、工单白名单）** —— 未逐一核实 → **未证实**（其中网易云信 AI 超分明确「请联系技术支持开通」）。
13. **声网云端转码的具体单价** —— 计费页 https://doc.shengwang.cn/doc/cloud-transcoder/restful/overview/billing 本次未抓取 → **未证实**（且与超分无关）。
14. **UCloud 文档站根导航是否还有未覆盖的媒体处理产品** —— 根 `/_sidebar.md` 返回 200 但 0 字节，未能穷尽根导航 → **限制说明**（但 OpenAPI 索引「视频服务」分组只有 ULive/URTC，证据已足够支撑「无超分」的结论）。
15. **金山云转码（KET）具体单价** —— 价格总览页 https://docs.ksyun.com/documents/1200?type=3 正文只有一句「价格总览详见 转码产品价格」，**指向外部页面，未抓取 → 未证实**（且无超分计费项，对 libtv 不适用）。
16. **金山云 KS3「智能媒体处理」的完整能力清单** —— 该标题页 https://docs.ksyun.com/documents/45443?type=3 返回的是带完整侧栏导航的页面，正文中未见画质增强类条目；**其正文能力边界未完全穷尽 → 部分未证实**（但「KS3 不做视频处理、需转视频云」有官方 FAQ 原文直接支撑）。

### 9.2 检索过程中遇到的站点障碍（供后续调研复用）

| 站点 | 障碍 | 可用的绕行方案 |
|---|---|---|
| `developer.qiniu.com` | 无（SSR 正常） | 直接 curl；导航里拿 `href="/dora/<id>/<slug>"` 即可枚举全部文档 |
| `help.upyun.com` | 无（WordPress SSR 正常） | `wp-json/wp/v2/posts?search=` 可用；`wp-json/wp/v2/search` 路由不存在；`/sitemap.xml` 404；站内搜索 `/?s=` 可用 |
| `doc-zh.zego.im` | `docs.zego.im` DNS/连接失败（curl 000），正确域名是 **`doc-zh.zego.im`** | 有 `sitemap.xml`（6413 条）可全量枚举；**页面加 `.md` 后缀可直接拿纯 markdown 源**（例：`.../video/super-resolution.md`） |
| `doc.yunxin.163.com` | 正文客户端渲染；`.json` 被反爬拦（"Bot not welcome at this time"）；SSR 搜索页**恒定**渲染「没有找到您查询的内容」（会误导） | **从其公开 JS bundle 还原文档站自身的公开搜索接口** `doc-interface.yunxin.163.com/fe/search`（带 `appid`/`timestamp`/`signature` 头）。签名算法在 `pages/_app-*.js` 中：`base64(HMAC-SHA256("cca8e25de0694acf8532d9d470877db1", "appId=2&secretKey=cca8e25de0694acf8532d9d470877db1&timestamp=<ms>"))`。注意 `limit` 为必填参数 |
| `doc.shengwang.cn` | Docusaurus，SSR 正常；但**短 UA（如 `Mozilla/5.0`）会被过滤** | 必须带完整 Chrome UA；有 `sitemap.xml`（8219 条）可枚举所有产品命名空间 |
| `docs.ucloud.cn` | docsify SPA，根 `_sidebar.md` 为空 | 用 `/<路径>/_sidebar.md` 拿各产品导航（如 `/api/_sidebar.md`、`/api/ulive-api/_sidebar.md`）；markdown 正文可直接抓 |
| `docs.ksyun.com` | Vue SPA，首页抓不到正文（**补充清单厂商，见 `rtc-cdn-optional.md`**） | 需另找其文档 JSON 接口 |
| `ecloud.10086.cn` | SPA（**补充清单厂商**） | 同上 |
| `cloud.wo.cn` | **403** | 未解决 |
| `html.duckduckgo.com` | 连接失败（000，被墙/被拦） | 不可用；本次**全程未依赖任何搜索引擎**，只抓官方站 |
| 搜索引擎 | 按任务说明，Bing（cn.bing.com / www.bing.com）结果被严重过滤，未使用 | — |

---

## 10. 对 libtv 的直接建议（结论性，非新增事实）

1. **如果要在本次调研的这批厂商里做「480p 成片 → 720p/1080p 超分」，唯一可选是七牛云**：
   - 用 `pfop` 提交 `aicvt/format/mp4/vcodec/H.264/srMode/base/superResolution/2`；
   - `saveas` 另存结果，`persistentNotifyUrl` 接回调，或轮询 `GET /status/get/prefop?id=<persistentId>`；
   - 成本量级：**0.8 元/分钟起（1080p 及以下、普帧、普通版）**，人脸增强版 1.6 元/分钟起；480p 的 3 倍（→2562×1440）会落到 **2K 档（1.6 或 3.2 元/分钟）**，需要权衡。
   - **注意三个硬约束**：① 只支持整数 2x/3x，**拿不到精确 1080p**；② **仅华东区域**；③ 输出**不支持 m3u8**（主接口）。
2. **补帧（24/30→60fps）在这批厂商里找不到任何可用 API**（七牛只有常规帧率控制，其余三家只有实时链路）。补帧需要另找专门的 AI 视频增强厂商/自建（如 RIFE/FILM 类模型）——**不在本次调研范围内**。
3. **SDR→HDR 也只有七牛有**（`avthumb/hdr/1`，要求输出 H.265 且不能与 `avsmart`/`pixFmt` 混用），0.4 元/分钟（1080p 及以下普帧）。
4. **不要把 RTC 厂商的「超分」当成成片超分**：即构 `initVideoSuperResolution`、云信 `enableSuperResolution` 都作用于**实时 RTC 流的接收端画面**，且被限制在 360p 级别、单路流、需厂商特殊编包/技术支持开通 —— 对后端的「成片批量清晰化」**完全不可用**。