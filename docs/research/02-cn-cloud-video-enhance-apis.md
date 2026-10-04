# 国内云厂商「视频超分 / 插帧 / 画质增强」API 调研

> 调研对象：libtv（漫剧 / 短剧 AI 视频生成平台，Go 后端）
> 需求：把生成的 **480p 成片**做「清晰化」——视频超分（480p→720p/1080p，2~3 倍）、去噪 / 去块 / 锐化、老片修复、补帧（24/30fps→60fps）
> 调研日期：**2026-10-04**
> 调研方式：内置 web_search 不可用；Bing（cn.bing.com / www.bing.com）结果被严重过滤、不可用。全部结论来自**直接 curl 官方文档页 / 官方 OpenAPI 元数据 JSON / 官方定价页**（腾讯云文档需 `curl --compressed`）。

## 可信度标注约定

| 标记 | 含义 |
|---|---|
| ✅ 官方文档页 | 直接抓到官方文档/定价页正文 |
| ✅ 官方 API 元数据 | 抓到官方 OpenAPI 元数据 JSON（阿里云 `api.aliyun.com/meta/v1/...`） |
| ⚠️ 仅导航可见 | 只抓到官方文档站的导航标题，正文为 JS 渲染、未能抓取 |
| ❌ 未证实 | 未找到官方来源，或官方文档未写明 |

**重要说明**：阿里云帮助中心多数页面的「更新时间」由 JS 注入，SSR 输出为空，故标注「页面日期未知」；腾讯云页面给出了「最近更新时间」，逐页标注。

---

## 0. 结论速览（TL;DR）

1. **能直接调、且最贴合 480p→720p/1080p 2~3 倍 + 补帧的组合，是两家**：
   - **腾讯云 MPS**：`ProcessMedia` + 转码/增强模板（`EnhanceConfig.VideoEnhance`），原生支持 **超分（2 倍）/ 插帧 / 降噪 / 去毛刺 / 去划痕 / 综合增强 / SDR2HDR / 人脸增强 / 低光照 / 色彩增强**，并且有 **`EnhanceSceneType` 场景预设，明确包含 `ai_comic`（AI 漫剧）、`short_play`（短剧 & AI 仿真人剧）、`LQ_material`（低清素材/老片修复）、`AIGC`** —— 与本项目业务几乎一一对应。
   - **阿里云视觉智能开放平台（videoenhan）**：`EnhanceVideoQuality`（**一次调用同时做超分 + 插帧 + SDR转HDR**）、`SuperResolveVideo`（2 倍超分）、`InterpolateVideoFrame`（插帧，可指定 1~120fps）。异步 + `GetAsyncJobResult` 轮询。价格透明。
2. ⭐ **阿里云 IMS 音画增强有一条「官方为 AIGC 视频超分写的实践教程」，与本项目需求几乎完全对口**：官方原文即「先用模型生成 720P 等较低分辨率视频，再通过 IMS 音画增强用 AI 超分放大并修复为 1080P/4K 成片」，主打场景含 **AIGC 视频降本增效 / AIGC 成片画质打磨（边缘模糊、纹理不足、轻微压缩失真）/ 老片高清重制 / 低质量片源修复**。预置模板 **`S00000004-401040`（720P→1080P）、`S00000004-401070`（1080P→4K）**，接口 **`SubmitMediaConvertJob` → `GetMediaConvertJob`/回调 `MediaConvertComplete`**。**但没有插帧**，需**提交工单开通**，且输入输出**必须在 OSS**。
3. **项目已接入的万相模型 `wan2.7-videoedit` / `wan3.0-video-prime` 都不提供超分或画质增强**（已核实，见 §1.5）。它们是**生成/编辑**模型，会重新生成画面，不是保真的清晰化。
4. **火山引擎（国内侧）✅ 已证实：视频点播 VOD「画质增强」**（另一条等价路径是 **AI MediaKit 画质增强**，按量单价完全相同）。场景预设 `common / ugc / **short_series(短剧)** / **aigc** / **old_film(老片修复)**`，档位 `Fast/Standard/Pro`，**`Target.Fps` 设高于原片会自动启用智能插帧**。**标准版 1080P≤30fps = 1.5 元/分钟、1080P 30–60fps = 3 元/分钟** —— **这是三家里最便宜的**。子代理已攻克其文档站公开 JSON API（`getDocDetail` + `Result.MDContent`）。父任务线索中的 fal.ai `bytedance-upscaler` 已证实「底层是 BytePlus VOD」，且价格阶梯为 国内 ¥1.5 → BytePlus ≈¥2.93（1.96×）→ fal.ai ≈¥3.07（2.05×）。
5. **百度智能云 ✅ 有开放 API**：音视频处理 MCP「智感超清」含**智能超分（3–5 倍）、智能插帧、老片修复、智能 HDR**，预置模板 `mcp.video_mp4_1080p_h264_sr` 正对 480p→1080p；**智能超分 HD 0.9 + 智能插帧 HD 1.5 ≈ 2.4 元/分钟**（比腾讯/火山都便宜）。但**白名单工单 + 仅华北-北京 + 必须入 BOS（无 URL 直传）**。
6. **华为云 MPC ✅ 有独立「视频增强」API**（`video_superresolution` scale 2~8、`video_denoise`、`video_deblock`、`video_sharp` 等 6 算子，`execution_order` 可控），**但无插帧**（帧率高于片源会被自动降回），且**单价未证实**（定价页是 JS SPA）。
7. **声网 / 即构 / 网易云信 / 又拍 / UCloud / 金山云 / 移动云 / 天翼云 / 京东云：全部没有文件级超分/插帧 API**。**七牛云是这一批里唯一有的**（`aicvt ... superResolution/2|3`，0.8 元/分钟起），但只支持整数 2x/3x、仅华东、且**拿不到精确 1920×1080**。**补帧在这 10 家里一个都没有。**
8. **国内垂直厂商没有一家「公开文档 + 公开定价 + 自助开通」的视频超分 API**（美图有「视频超清」但申请制、单价未公开；商汤/影谱/相芯/虹软/海康/大华均无）。**唯一公开自助可用的视频超分 + 视频插帧 REST API 是美国的 Topaz Labs**（$0.10/credit，Developer $50/mo 起），但**无中国大陆节点，数据出境风险明确**。
9. **合规红线**：《互联网信息服务深度合成管理规定》第二十三条第（五）项**明确把「图像增强、图像修复等生成或者编辑图像、视频内容中非生物特征的技术」列为深度合成技术**。也就是说「超分/修复」这一动作本身即落入深度合成监管范围；**后处理链路必须保留（不得剥离）AI 生成标识的隐式元数据**。《人工智能生成合成内容标识办法》2025-09-01 施行。

### 0.1 最终推荐

**按 480p→1080p + 补帧到 60fps 的单分钟成本排序（全部基于官方公开单价推算，非厂商报价）**：

| 排名 | 方案 | 元/分钟 | 关键权衡 |
|---|---|---|---|
| 1 | **百度 MCP「智感超清」**（超分 0.9 + 插帧 1.5） | **2.4** | 最便宜且超分+插帧齐备；但**白名单工单 + 仅华北-北京 + 必须入 BOS（无 URL 直传）** |
| 2 | **火山 AI MediaKit / VOD 画质增强**（标准版，`short_series`+`fps=60`） | **3.0** | 单接口含超分+插帧+降噪，`short_series`/`aigc` 预设；AI MediaKit 用 Bearer 鉴权（Go 工程量最小），资源包 4.5 折后 ≈1.35 |
| 3 | **腾讯云 MPS**（超分 1.2 + 插帧 2.7 + 转码 0.063） | **3.96** | 综合最优：官方**漫剧场景**预设 + 媒体质检/无参考评分闭环 + 资料最完整 + 免工单 |
| 4 | 阿里云 IMS 音画增强（`S00000004-401040`，@30fps） | 5.86 | **官方唯一为「AIGC 视频超分」写的教程**；**但不含插帧**，需工单 + 必须 OSS |
| 5 | 阿里云视觉智能 `EnhanceVideoQuality` | 8.0 | **单接口 = 超分 + 插帧 + SDR2HDR**，接入最简单；输出 URL 仅 30 分钟 |
| — | 七牛云超分（0.8，最便宜的纯超分） | 0.8 | **无补帧**、仅整数 2x/3x、**拿不到精确 1080p**、仅华东、不支持闲时 |
| — | 华为云 MPC / 美图 / 其余国内厂商 | ❌ | 华为无插帧且单价未证实；美图为申请制且单价未公开；其余无公开自助 API |

> **最终建议（三句话）**
> 1. **主力选腾讯云 MPS**：唯一同时具备「**官方预置「漫剧场景-大模型增强」模板（`327002`/`327004`/`327006`/`327008`）+ 超分 + 插帧 + 全场景预设（`ai_comic`/`short_play`）+ 媒体质检 / 无参考评分验收闭环**」的厂商，且资料完整度最高（页面日期齐全）、`AWS-S3` 输入源支持有官方表述、**免工单**、单价 ≈**3.96 元/分钟**。
> 2. **降本走火山引擎**：**单价最低（1080P≤30fps 1.5 元/分钟、30–60fps 3 元/分钟）**，`short_series`/`aigc` 预设 + `fps` 设高即**自动插帧**，资源包最低 4.5 折；**起步用 AI MediaKit（Bearer 鉴权，Go 工程量最小）**，用量上来再切 VOD 场景式。百度更便宜但受三重准入约束，建议并行提工单。
> 3. **阿里云适合「单接口快速接入」或「必须 3 倍超分」的对照通道**：`EnhanceVideoQuality`（8 元/分钟，一接口全含）；IMS 音画增强最贴 AIGC 场景且有官方教程（§1.3.2），**但无插帧、必须 OSS、需工单**。
>
> **千万注意**：`wan2.7-videoedit` / `wan3.0-video-prime` **都不能做清晰化**（§1.5）；**不要把「窄带高清/极速高清/集智高清」当超分**（§7.1）；**没有任何厂商支持把结果直存天翼云 ZOS**（§8.3）。

---

## 1. 阿里云

### 1.1 【推荐】视觉智能开放平台 · 视频生产 videoenhan

**产品页**：https://vision.aliyun.com/videoenhan ✅（页面日期未知）
**OpenAPI 元数据**：`https://api.aliyun.com/meta/v1/products/videoenhan/versions/2020-03-20/api-docs.json` ✅（version `2020-03-20`）
**计费页**：https://help.aliyun.com/document_detail/202487.html （「视频生产计费介绍」）✅（页面日期未知）
**异步查询接口文档**：https://help.aliyun.com/document_detail/607824.html ✅（页面日期未知）
**文件 URL 处理**：https://help.aliyun.com/document_detail/155645.html ✅（页面日期未知）

这是**最直接的「一句话接口」**：能力本身就是为「老片修复 / 低清转高清 / 补帧」设计的。

#### 1.1.1 接口清单与能力覆盖

| 接口名 | 中文名 | 能力 | 关键参数 |
|---|---|---|---|
| `EnhanceVideoQuality` | 视频综合增强 | **超分 + 插帧 + SDR转HDR 三合一**，并抑制块噪声与压缩噪声 | `VideoURL`(必选)、`OutPutWidth`、`OutPutHeight`、`FrameRate`、`HDRFormat`(PQ/HLG)、`MaxIlluminance`、`Bitrate` |
| `SuperResolveVideo` | 视频超分辨 | **固定放大 2 倍**输出，H.264/MP4 | `VideoUrl`(必选)、`BitRate`(1~20 Mbps，默认 10) |
| `InterpolateVideoFrame` | 视频插帧 | 深度学习帧率上变换（补帧） | `VideoURL`(必选)、`FrameRate`(默认 50，范围 1~120)、`Bitrate`(8~200 Mbps，默认 20) |
| `EnhancePortraitVideo` | 视频人像增强 | GPEN 人像增强模型，提升人脸清晰度 | `VideoUrl`(必选) |
| `GetAsyncJobResult` | 查询异步任务结果 | 所有上述异步能力的统一轮询接口 | `JobId`（= 提交时返回的 `RequestId`） |
| `AdjustVideoColor` | 视频校色 | SDR 调色 | — |
| `ChangeVideoSize` | 视频画幅变换 | 智能裁切/填充输出任意分辨率 | — |
| `EraseVideoSubtitles` / `EraseVideoLogo` | 字幕/标志擦除 | 去字幕、去台标 | — |

**能力覆盖核对（本项目需求）**

| 需求 | 覆盖情况 |
|---|---|
| 超分倍率 | `SuperResolveVideo` **仅 2 倍**（文档原文「将输入视频放大2倍尺寸输出」）；`EnhanceVideoQuality` 可**指定任意输出宽高**，约束为「输出宽高不小于原始宽高的 1/2 且不大于原始宽高的 4 倍」→ 480p 精确输出 1280×720 或 1920×1080 **可以** |
| 插帧 | ✅ `InterpolateVideoFrame`（1~120fps）；`EnhanceVideoQuality` 内置插帧（`FrameRate` 默认 50） |
| 去噪 / 去块 / 锐化 | ✅ `EnhanceVideoQuality` 文档明确「抑制块噪声和压缩噪声」「优化画面细节、纹理和锐度」；产品页另列「视频降噪」（**见 §1.1.4 未证实**） |
| SDR→HDR | ✅ `EnhanceVideoQuality` 的 `HDRFormat`（仅 PQ / HLG）；PQ 模式最大亮度固定 600nit，HLG 500~1000nit |
| 老片修复 | ✅ 文档「应用场景」第一条即「旧视频翻新」；`EnhancePortraitVideo` 场景写明「老旧视频的人脸增强修复」 |

#### 1.1.2 调用形态：**异步 + 轮询**

文档原文（`EnhanceVideoQuality` / `SuperResolveVideo` / `InterpolateVideoFrame` / `EnhancePortraitVideo` 均同）：

> 该能力为异步能力，需分两步进行调用。第一步调用 `Xxx` 接口提交任务，请求成功后，得到一个任务 ID。第二步调用 `GetAsyncJobResult` 接口查询结果，根据任务 ID 查询任务执行状态和结果。

- 提交返回的 `RequestId` 即作为 `JobId` 传给 `GetAsyncJobResult`
- `Data.Status` 枚举：`QUEUING` / `PROCESSING` / `PROCESS_SUCCESS` / `PROCESS_FAILED` / `TIMEOUT_FAILED` / `LIMIT_RETRY_FAILED`
- **结果文件有效期为 30 分钟**（原文：「异步任务的文件有过期时间，有效期是 30 分钟。如需长期使用，需及时将文件下载到本地服务器或存储在 OSS 中」）→ **工程上必须立刻转存**
- Endpoint 示例：`viapi.cn-shanghai.aliyuncs.com`
- 文档建议「同一个任务还未处理完时，建议不要重复提交任务」

#### 1.1.3 输入限制

| 接口 | 格式 | 大小 | 分辨率 | 时长 |
|---|---|---|---|---|
| `SuperResolveVideo` | MP4、AVI、MKV、MOV、FLV、TS、MPG、MXF | ≤ 1 GB | > 360×360 且 **< 1920×1080** | 文档未写 |
| `EnhanceVideoQuality` | 同上 | ≤ 1 GB | > 360×360 且 < 1920×1080；输出宽高 ∈ [180,7680]×[180,4320]，且为原始宽高的 1/2 ~ 4 倍 | **≤ 10 分钟** |
| `InterpolateVideoFrame` | 同上 | ≤ 1 GB | ≥ 360×360 且 ≤ 1920×1080 | 文档未写 |
| `EnhancePortraitVideo` | 同上 | ≤ 1 GB | < 1920×1080 | 文档未写 |

- **URL 直传**：✅ 支持。`VideoURL` 直接传 URL；文档「推荐使用上海地域的 OSS 链接」，非上海地域 OSS 或本地文件「推荐您使用 SDK 进行调用」（新版 SDK 支持 `xxxAdvanceRequest` 以 stream 传入，或 `viapiutils` 生成临时 URL）。**URL 地址中不能包含中文字符**。
- 视觉智能平台各服务支持的地域：**华东 2（上海）**（原文：「当前视觉智能开放平台各服务支持的区域为 华东 2（上海）」）。
- ⚠️ 官方 OSS-Bucket 临时存储「非官方推荐方式，不保证 SLA，所有用户共享总共 1 万 QPS…请勿在生产环境使用」。生产必须自建 OSS。

#### 1.1.4 计价（官方计费页原文）

按量付费；**分辨率按输入视频分辨率、帧率按输出视频帧率、时长按输出视频时长**计费，不足 1 秒按 1 秒。

**视频综合增强 `EnhanceVideoQuality`**（元/分钟，中国大陆）

| 输入分辨率 \ 输出帧率 | ≤30 帧 | 30<帧率≤60 | 60<帧率≤120 |
|---|---|---|---|
| ≤720P | **4** | **8** | 16 |
| 720P<分辨率≤1440P | 8 | 16 | 32 |
| 1440P<分辨率≤2160P | 24 | 48 | 96 |

**视频插帧 `InterpolateVideoFrame`**

| 输入分辨率 \ 输出帧率 | ≤30 帧 | 30<帧率≤60 | 60<帧率≤120 |
|---|---|---|---|
| ≤720P | **3** | **6** | 12 |
| 720P<分辨率≤1440P | 6 | 12 | 24 |
| 1440P<分辨率≤2160P | 18 | 36 | 72 |

**视频超分辨 `SuperResolveVideo`**

| 输入分辨率 \ 输出帧率 | ≤30 帧 | 30<帧率≤60 | 60<帧率≤120 |
|---|---|---|---|
| ≤720P | **0.4** | **0.8** | 1.6 |
| 720P<分辨率≤1440P | 0.8 | 1.6 | 3.2 |
| 1440P<分辨率≤2160P | 2.4 | 4.8 | 9.6 |

- 其他能力参考单价：视频校色 0.4 元/分钟、视频字幕擦除 0.4、视频画幅变换 0.4、视频标志擦除 0.8、通用视频生成 0.8
- **`EnhancePortraitVideo`（视频人像增强）文档写明「目前处于公测期，可免费调用」**
- 预付费资源包：有效期 1 年，5,000 点=50 元（125 分钟，40 点/分钟，≤720P≤30 帧档）… 最大 150,000,000 点=1,500,000 元；**视频类资源包不可与图像类跨类目使用**
- 异步能力调用失败不计费；通过 `RequestId` 查询结果不计费

#### 1.1.5 开通前置

- 需先**开通「视频生产服务」**：https://vision.aliyun.com/videoenhan → 「立即开通」（商品码 `viapi_videoenhan_public_cn`）
- 需创建 AccessKey；子账号需授权 `AliyunVIAPIFullAccess`
- QPS 限制：资源包档位标注 2QPS；更高 QPS「请通过咨询服务联系我们」
- **未发现**要求企业认证/备案的官方表述（❌ 未证实）

#### 1.1.6 产品页宣传但 OpenAPI 元数据中找不到对应操作（❌ 未证实）

`https://vision.aliyun.com/videoenhan` 页面列出「**视频SDR调色**」「**SDR转HDR**」「**视频降噪**」三项独立能力，但在 `videoenhan`（2020-03-20，共 16 个 API）与 `viapi`（2023-01-17，仅 3 个 API）的官方元数据中**均未找到对应的独立操作**。相关功能目前只能通过 `EnhanceVideoQuality` 的 `HDRFormat` 达成。**这三项独立 API 是否存在/可购买，未证实。**

---

### 1.2 【推荐】媒体处理 MPS · 「分辨率倍增」（超分）

**操作指南**：https://help.aliyun.com/zh/mps/create-a-resolution-redoubling-transcoding-job ✅（页面日期未知）
**预置模板**：https://help.aliyun.com/zh/mps/preset-templates ✅（页面日期未知）
**计费页**：https://help.aliyun.com/zh/mps/product-overview/audio-and-video-enhancement-fees ✅（页面日期未知）

#### 1.2.1 产品/接口名与调用形态

- 能力名：**「分辨率倍增」**（Resolution Redoubling），属 媒体处理 MPS（API 产品码 `Mts`，version `2014-06-18` / `2021-07-28`）
- 提交：**`SubmitJobs`**（提交转码作业）— 需传入
  - `PipelineId`：**必须使用「窄带高清 2.0」类型的管道 ID**
  - `TemplateId`：超分预置模板或定制模板 ID
- 查询：**`QueryJobList`**（通过作业 ID）；**`ListJob`**（遍历转码作业，按管道 ID / 状态 / 时间区间批量查）
- 回调：可配置管道 MNS 消息队列事件通知
- **异步**（提交 → 回调/MNS 或轮询查询）

#### 1.2.2 预置超分模板 ID（原文表格）

| 模板 ID | 模板名 | 中文名 | 视频码率 | 分辨率-宽 | 备注 |
|---|---|---|---|---|---|
| `S00000001-400040` | MP4-SDToHD | MP4-标清转高清 | ≤6000 kbps | ≤1280 | 旧版本超分模板，需使用窄标准管道 |
| `S00000001-400070` | MP4-2KTo4K | MP4-2K 转 4K | ≤20000 kbps | ≤3840 | 同上 |

文档原文：「下表为**旧版本**超分预置模板，建议您使用新版本模板」，且「全平台（MP4）-SDToHD、全平台（MP4）-2KTo4K 模板，目前**仅支持华东 1（杭州）、华东 2（上海）地域**使用」。**新版本超分模板的具体模板 ID 在该页未列出（❌ 未证实）**；定制模板「请联系您的商务，提供 UID、媒体处理开通区域、转码模板 ID、定制需求」。

#### 1.2.3 输入限制与限制条件

- 输入：**必须上传至 OSS**（原文：「将需要处理的视频上传至 OSS」）；MPS 需把 OSS Bucket 绑定为输入/输出媒体 Bucket
- 地域：**仅华东 1（杭州）、华东 2（上海）**
- **文档明确提示处理速度**：「分辨率倍增转码速度较慢，**建议使用 3 分钟以内的短视频测试**」← 这是本项目评估处理耗时的**唯一官方口径**
- 使用前需**开启「窄带高清 2.0」管道**

#### 1.2.4 计价（官方计费页原文）

**视频增强按「处理成功的帧数」收费**（音频增强按分钟）。

**超分标准版**（元/帧，中国内地）

| 输出规格 | 中国内地 | 新加坡 |
|---|---|---|
| HD (1920×1080) 及以下 | **0.003255 元/帧** | 0.007811 |
| 2K (2560×1440) 及以下 | 0.007 元/帧 | 0.0175 |
| 4K (3840×2160) 及以下 | 0.014 元/帧 | 0.042 |
| 8K (7680×4320) 及以下 | 0.049 元/帧 | 0.147 |

**超分专业版**：HD 0.05、2K 0.08、4K 0.12、8K 0.42 元/帧（中国内地）
**HDR 标准版**：HD 0.00217、2K 0.0047、4K 0.0093、8K 0.032667 元/帧（中国内地）
**音频增强**：杜比音效制作 3.5 元/分钟、虚拟环绕声 2.0、音效增强 2.0、音量归一专业版 0.1

**⚠️ 计费陷阱（本项目重点）**：超分按**输出帧数**计费 = 输出时长 × **输出帧率**。
- 1 分钟、输出 1080p@30fps → 1800 帧 × 0.003255 = **≈5.86 元**
- 若先插帧到 60fps 再超分 → 3600 帧 × 0.003255 = **≈11.72 元**
- **因此顺序应为「先超分（低帧率）后插帧」，但阿里云 MPS 本身不提供插帧**（见 §1.3）

官方计费示例（原文）：「200 分钟 × 60 秒/分钟 × 25 帧/秒 × 0.003255 元/帧 = 976.5 元」。
计费规则：按小时出账；处理失败不收费；**「音视频增强暂无可用资源包」**。
注明：「本文涉及的计费单价仅供参考，实际价格以阿里云产品定价为准。更多音视频增强定价请咨询商务。」

---

### 1.3 阿里云「智能媒体服务 IMS / 点播媒体处理」· 音画增强（含 **2 倍与 3 倍**超分，**无插帧**）⭐ 有官方「AIGC 视频超分」教程

**转码模板文档**：https://help.aliyun.com/zh/ims/user-guide/transcoding-template ✅（页面日期未知）
**ICES OpenAPI 元数据**：`https://api.aliyun.com/meta/v1/products/ICE/versions/2020-11-09/api-docs.json` ✅

#### 1.3.1 能力清单（文档原文）

> 音画增强是指通过对输入视频执行去噪、色彩与对比度增强、**超分辨率**和 SDR 转 HDR 等操作……
> **如果您需要开通音画增强功能，请提交工单联系阿里云客服咨询。**

点播媒体处理音画增强当前支持以下六种类型：

| 类型 | 说明 |
|---|---|
| 隔行处理 | 去除隔行帧后将帧率翻倍，转逐行（适合广电/老旧视频） |
| 多帧降噪 | 去时域噪声；**降噪强度参数范围 [0.5, 5]，取值越小去噪越强** |
| 去压缩失真 | 去边缘毛刺与块效应，同时增强边缘/细节纹理 |
| 色彩与对比度增强 | 局部+全局对比度，**饱和度增强程度范围 [0,1]，取值越小增强越强** |
| **超分** | 「提升视频分辨率和边缘纹理……**目前支持 2 倍和 3 倍超分放大**」，建议与「去压缩失真」配合 |
| SDR 转 HDR | 支持 HLG 与 PQ；**仅当输出编码为 H.265 时生效** |

**输出尺寸**：预设分辨率 或 自定义宽高（**取值范围 [128, 4096] px**）；不填则为「原视频 × 放大倍率」的尺寸。

**⚠️ 关键缺口：音画增强的六种类型里没有「插帧」。** 阿里云侧补帧只能走 §1.1 的 `InterpolateVideoFrame`（或 `EnhanceVideoQuality`）。

#### 1.3.2 ⭐ 官方「用音画增强为 AIGC 生成视频超分增强」实践教程 —— 与本项目需求几乎完全对口

**来源**：https://help.aliyun.com/zh/ims/use-cases/enhance-aigc-generated-videos-with-audio-visual-super-resolution ✅（**主调研员已独立抓取复核**，页面日期未知）

官方原文（开头即直击本项目场景）：

> 「**AIGC 模型直接生成 1080P/4K 视频成本高、耗时长。更经济的做法是先用模型生成 720P 等较低分辨率视频，再通过智能媒体服务（IMS）的音画增强能力，用 AI 超分（Super Resolution）放大并修复为 1080P/4K 成片。** 本文提供控制台与 API 两种提交方式的完整操作指引。」

官方主打场景（原文）：
- **AIGC 视频降本增效**：用文生/图生视频模型生成 720P 等较低分辨率片段，再经音画增强超分为 1080P/4K（**正是 libtv 的 480p/720p→1080p 路径**）
- **AIGC 成片画质打磨**：对生成视频常见的**边缘模糊、纹理不足、轻微压缩失真**做修复增强（**正是 AI 视频的通病**）
- **老片高清重制**：历史片库、老剧老综的标清片源
- **低质量片源修复**：UGC、翻录等受压缩失真、噪点较多的低质量片源

**预置音画增强模板（✅ 官方表格原文，均基于 SR5 = 超分 SR 系列第 5 代能力）**

| 模板名 | **模板 ID** | 输出分辨率 | 码率 | 编码 | 封装 | 适用场景 |
|---|---|---|---|---|---|---|
| `MP4-HD-UHD-SR5` | **`S00000004-401040`** | 宽（自适应）× 高 **1080** | 6000 Kbps | H.264 | MP4 | **720P → 1080P** |
| `MP4-4K-UHD-SR5` | **`S00000004-401070`** | 宽（自适应）× 高 **2160** | 14000 Kbps | H.264 | MP4 | **1080P → 4K** |

官方说明原文：「超分模板中，**超分开关默认开启，放大倍率为 2 倍**，输出宽度自适应、高度固定（1080/2160），最终输出分辨率以模板设定的目标高度为准。」「还可按需组合**去压缩失真、多帧降噪、色彩与对比度增强、SDR 转 HDR** 等能力。」「预置模板为系统模板，仅支持**查看**操作，不支持编辑或删除。如需自定义音画增强参数，可创建转码模板。」
⚠️ 注意「放大倍率 2 倍」与「720P→1080P（1.5 倍）」在文档中并存，**实际倍率逻辑以模板目标高度为准**，落地前建议按官方建议「先用一小段片源试跑」。

**接口与调用形态（✅ 官方文档 + 已由主调研员在 ICE OpenAPI 元数据中确认 API 存在）**

| 环节 | 内容 |
|---|---|
| 提交 | **`SubmitMediaConvertJob`**（提交媒体转码任务）— **异步**，返回 `JobId` |
| 查询 | **`GetMediaConvertJob`**（查询媒体转码任务） |
| 回调 | **`MediaConvertComplete`**；官方建议「超分（尤其 4K）任务计算量较大……**建议通过回调而非高频轮询**获取结果」 |
| 核心用法 | 把音画增强模板 ID 填入 `Config` 每个 `Output` 的 **`TemplateId`** 字段 |
| 权限 | RAM 权限 **`ice:SubmitMediaConvertJob`** |
| 计量 | `DescribeMeterImsMediaConvertUHDUsage`（IMS 的 MPS 转码 UHD 计量查询），**Specification 示例值 `SuperResolution.Standard.1080P`** |
| 其他参数 | `PipelineId`（选填，管线/并发控制）、`UserData`（选填，随回调原样返回） |

> 主调研员交叉验证：`SubmitMediaConvertJob` / `GetMediaConvertJob` / `DescribeMeterImsMediaConvertUHDUsage` 均在 ICE（`2020-11-09`）官方 OpenAPI 元数据中存在（标题分别为「提交媒体转码任务」「查询媒体转码任务」「IMS的MPS转码UHD计量查询」）✅

**前提条件（✅ 官方原文）**：
1. 已**开通智能媒体服务（IMS）**，并完成基础配置（媒资 Bucket、回调等）
2. 已开通**对象存储 OSS**，且**待处理视频已上传至 OSS，输出目录同样必须位于 OSS**
3. 使用 API 提交时需准备 RAM 访问控制，具备 `ice:SubmitMediaConvertJob` 权限
4. **音画增强功能需提交工单联系阿里云客服开通**（见 §1.3.1）

**计费（官方原文）**：
> 「音画增强（超分）转码费用**高于普通转码**……**计费维度：按转码类型（标准/音画增强）× 输出规格 × 处理时长计费**。」「此外还会产生对应的 OSS 存储与流量费用，需一并评估。」「**建议先用一小段片源试跑**，确认画质与耗时符合预期后再批量处理。」
→ **具体单价见 §1.2.4 的 MPS 超分按帧价目表**（超分标准版 HD≤1080p **0.003255 元/帧**；专业版 HD 0.05 元/帧）。

⚠️ **换算成「元/分钟」（官方计费页是按帧，本表的元/分钟为主调研员推算，非官方报价）**：
| 档位 | 元/分钟（@25fps） | 元/分钟（@30fps） | 元/分钟（@60fps） |
|---|---|---|---|
| 超分标准版 HD ≤1080p | **≈4.88** | **≈5.86** | ≈11.72 |
| 超分标准版 2K ≤1440p | ≈10.5 | ≈12.6 | ≈25.2 |
| 超分专业版 HD ≤1080p | ≈75 | ≈90 | ≈180 |
（官方原文示例可校验：720P→1080P、H.264、25fps、200 分钟 → `200 × 60 × 25 × 0.003255 = 976.5 元`，即 4.88 元/分钟 ✅）

#### 1.3.3 API 侧证据（OpenAPI 元数据 ✅）

在 ICE（`2020-11-09`，399 个 API）官方元数据中检索确认：

- `GetPlayInfo` → `TransTemplateType` 取值含 **`UHD：音画增强（超高清）`**（另有 `Normal` / `AudioTranscode` / `Remux` / `NarrowBandV1` / `NarrowBandV2`）
- `DescribeMeterImsMediaConvertUHDUsage`（IMS 点播**超高清用量**统计）→ `Specification` 示例值为 **`SuperResolution.Standard.1080P`**，即超分有独立计量规格
- `DescribeMeterImsSummary` → `MpsTranscodeUHDDuration` 字段说明为「**音画增强时长**」
- `SubmitMediaConvertJob` / `GetMediaConvertJob` 存在（§1.3.2）
- ❌ **未在 ICE 元数据中找到任何名为 `*Enhance*` / `*SuperResolution*` 的独立 API 操作**；音画增强是通过**转码任务 + 音画增强模板**（`TemplateId`）发起的，不是独立命名的增强接口

#### 1.3.4 接口清单（阿里云 IMS = ICE API 家族，供参考）

- 提交转码：`SubmitTranscodeJob`；查询：`GetTranscodeJob`
- 模板：`AddTemplate` / `GetTemplate` / `GetSystemTemplate` / `AddCustomTemplate` / `GetCustomTemplate`
- 工作流：`CreateWorkflow` / `GetWorkflowTask`
- 用量：`DescribeMeterImsSummary` / `DescribeMeterImsMediaConvertUHDUsage` / `DescribeMeterImsMpsAiUsage`
- 其他相关：`SubmitVideoTranslationJob`（视频翻译）、`SubmitAvatarVideoJob`（数字人）、`SubmitVideoCognitionJob`（内容理解）
- ICE API 目录页「更新时间 2026-01-14」✅

#### 1.3.5 计价

**音画增强的超分定价 = §1.2.4 的 MPS 超分价目表**（同一份计费文档「音视频增强费用」即挂在 MPS 产品下，IMS 文档也指向它）。公开计费页**只单列了「超分 / HDR / 音频增强」三类收费项**，**多帧降噪 / 去压缩失真 / 色彩与对比度增强是否单独收费，文档未列（❌ 未证实）**。

#### 1.3.6 开通前置（明确）

- **需提交工单联系阿里云客服开通「音画增强」功能**（文档原文，✅ 证实）
- 转码场景（非超分预设）：文档列有「短剧 / 教育 / UGC / 电商 / 高清影视 / 通用」六种**转码场景**与「画质优先 / 码率优先 / 极致降码 / 综合最佳 / 高清焕彩」五种**转码策略**
- ⚠️ **注意**：「短剧」在这里是**转码场景**（码率/画质平衡策略），**不是超分预设**。阿里云**未发现**类似「短剧 / 动漫」的超分增强预设，也**未发现内置补帧**（见 §7 问题回答）

---

### 1.4 阿里云 视频点播 VOD / 智能媒体服务 ICE 的 API 侧核实

**OpenAPI 元数据**：`vod`（`2017-03-21`，188 个 API）、`Mts`（`2014-06-18`，97 个 API）、`ICE`（`2020-11-09`，399 个 API）✅

对三个产品的**全部 API 定义**做了关键词扫描（超分 / 超分辨 / 插帧 / 画质增强 / 视频增强 / 去噪 / 锐化 / 老片 / 修复 / SuperResolution / Interpolate / Enhance / Denoise / HDR）：

- **阿里云 VOD 的 188 个 API 中，没有任何视频超分 / 插帧 / 画质增强接口。** 命中的只有智能审核、媒资信息等无关接口。
- **阿里云 MPS (`Mts`) 的 97 个 API 中没有超分接口**；但 `SubmitIProductionJob`（智能生产作业）的 `FunctionName` 枚举值得记录（完整枚举，✅ 官方元数据）：
  `VideoH2V`(视频横转竖)、`VideoDelogo`、`Cover`(智能封面)、`VideoClip`(视频摘要)、`ImageH2V`、`ImageDelogo`、`CaptionExtraction`、`VideoDetext`、`VideoGreenScreenMatting`、`MusicSegmentDetect`、`AudioMixing`、`AudioBeatDetection`、`ImageCartoonize`、`AudioQualityAssessment`、**`FaceBeauty`(视频美颜)**、**`SpeechDenoise`(智能降噪，音频)**。
  → **没有视频超分、没有视频插帧。**
- **ICE 的 399 个 API 中也没有独立的超分/插帧接口**（超分走转码模板，见 §1.3.2）。

**结论**：阿里云的「视频超分」对外提供两个入口——**(a) 视觉智能开放平台 videoenhan（纯 API，最易接）**、**(b) IMS/VOD 音画增强（转码模板 + 工单开通）**。VOD 自身的 OpenAPI 不直接暴露超分操作。

---

### 1.5 【关键核实】项目已接入的万相（Wan）模型是否自带画质增强 / 超分 → **否**

项目 `server/configs/models.yaml` 与 `server/internal/llm/video.go` 显示：libtv 通过华数 / 电信网关调用 **`wan3.0-video`**（阿里万相，走 DashScope 异步协议 `services/aigc/video-generation/video-synthesis` + `tasks/{id}`）。调研任务中提到的 `wan2.7-videoedit`、`wan3.0-video-prime` 未出现在仓库中——本节直接核实这两个模型名在官方文档中的真实身份。

#### 1.5.1 `wan3.0-video` / `wan3.0-video-prime` — 同为「视频生成」，**无增强能力**

**来源**：https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference/ ✅（页面日期未知）

文档原文（模型名可选值）：

> - **`wan3.0-video-prime`**：高速版，能力对齐标准版，端到端速度显著提升。
> - **`wan3.0-video`**：标准版。

- 产品定位：「万相 3.0 是**全能参考视频生成模型**（All-in-One），统一支持文生视频、图生视频（首帧/首尾帧）和参考生视频等多种用法。最长可生成 30 秒视频，输出帧率为 30fps。」
- `parameters.resolution` 可选值：**`1080P`（默认）/ `720P` / `480P`** ← 与本项目「输出可选 480p/720p/1080p」一致，但这是**生成档位**，不是超分
- 全文检索 `超分` / `增强` / `插帧` 关键词：**命中 0 次**。`prime` 命中 2 次，均为「高速版」含义
- 输入：`reference_video` 单个 [1,15] 秒、总时长 ≤15 秒、帧率 ≥16fps、单边 [240,4096] px、单文件 ≤100MB；`reference_image` 最多 10 张；`reference_audio` 最多 5 段
- 异步：「创建任务 → 轮询获取」，`task_id` 有效期 24 小时
- 有 `watermark` 参数（**默认 `false`**，「是否添加水印标识」，`true` 时添加）
- 接口：北京 `POST https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis`

#### 1.5.2 `wan2.7-videoedit` — 存在，但是**视频编辑**模型，**无增强能力**

**来源**：https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference/ ✅（页面日期未知）——标题即「**万相2.7-视频编辑API参考**」

- 文档原文：「万相 2.7-视频编辑模型，支持输入多模态（文本/图像/视频），可完成**指令编辑和视频迁移**任务。」
- `model` 示例值：`wan2.7-videoedit`；`input.media[].type` ∈ {`video`(必传，待编辑视频), `reference_image`(可选，最多 4 张)}
- `parameters.resolution` 可选值：**`720P` / `1080P`（默认 1080P）**；`ratio` ∈ {16:9, 9:16, 1:1, 4:3, 3:4}；`duration` [2,10] 秒（仅用于截断）；`audio_setting`(auto/origin)；`prompt_extend`；`watermark`（**默认 false**，「水印位于视频右下角，文案固定为"AI 生成"」）；`seed`
- 视频输入限制：mp4/mov、2~10s、宽高 [240,4096] px、≤100MB
- 全文检索 `超分` / `增强` / `插帧`：**命中 0 次**

> **决策含义**：把 480p 成片丢给 `wan2.7-videoedit` 选 `resolution: 1080P` **不会得到保真的清晰化**，而是**扩散模型重新生成一遍画面**（可能改变内容与角色一致性，对本项目的角色/画风一致性是风险）。同理，用 `wan3.0-video` 重新生成 1080P 也属于「重新生成」而非「超分」。
> **结论：项目已接入的两个 Wan 模型都不具备可用作「清晰化」的超分/画质增强能力，必须外接第三方超分 API。**

---

### 1.6 阿里云小结

| 入口 | 超分倍率 | 插帧 | 去噪/去块 | SDR2HDR | 老片修复 | 调用形态 | 开通条件 |
|---|---|---|---|---|---|---|---|
| **视觉智能 videoenhan** `EnhanceVideoQuality` | 可指定输出宽高（1/2~4 倍，精确到 720p/1080p） | ✅ 内置 | ✅ | ✅ PQ/HLG | ✅ | 异步 + `GetAsyncJobResult` | 开通「视频生产服务」 |
| 视觉智能 `SuperResolveVideo` | 固定 2 倍 | ❌ | ✅ | ❌ | ✅ | 异步 + 轮询 | 同上 |
| 视觉智能 `InterpolateVideoFrame` | ❌ | ✅ 1~120fps | — | ❌ | — | 异步 + 轮询 | 同上 |
| **IMS 音画增强**（预置模板 `S00000004-401040`=720P→1080P / `S00000004-401070`=1080P→4K，SR5） | 超分开关默认开、**放大 2 倍**（文档另称支持 2x/3x 并可自定义输出 [128,4096]） | ❌ | ✅ 多帧降噪 + 去压缩失真 | ✅ 需 H.265 | ✅（老片高清重制/隔行处理） | **`SubmitMediaConvertJob`** → `GetMediaConvertJob` / 回调 `MediaConvertComplete` | **提交工单开通**；输入输出**必须在 OSS** |
| **MPS 分辨率倍增** | 预置 2 倍（SDToHD / 2KTo4K） | ❌ | — | HDR 标准版单列 | — | `SubmitJobs` 异步 + `QueryJobList` | 窄带高清 2.0 管道；仅华东 1/2 |
| 百炼 Wan 模型 | **无** | 无 | 无 | 无 | 无 | — | — |

---

## 2. 腾讯云

### 2.1 媒体处理 MPS —— 功能最全，且场景预设直接命中「漫剧/短剧」

**ProcessMedia API**：https://cloud.tencent.com/document/api/862/37578 ✅（最近更新时间 **2026-09-11 02:35:04**）
**API 概览**：https://cloud.tencent.com/document/api/862/37569 ✅（最近更新时间 **2026-09-08 03:20:48**）
**数据结构**：https://cloud.tencent.com/document/api/862/37615 ✅（最近更新时间 **2026-09-29 02:38:58**）
**按量计费**：https://cloud.tencent.com/document/product/862/36180 ✅（最近更新时间 **2026-09-24 11:44:31**）
**画质提升场景**：https://cloud.tencent.com/document/product/862/116764 ✅（最近更新时间 **2025-03-11 16:34:52**）

#### 2.1.1 接口名与调用形态

- 提交：**`ProcessMedia`**（请求域名 `mps.tencentcloudapi.com`，`Version=2019-06-12`，默认限频 100 次/秒）
  - 文档原文：「对 **URL视频链接** 或 **COS 中的媒体文件**发起处理任务，功能包括：音视频转码（例如普通转码、极速高清转码、**音视频增强**、添加明水印、添加数字水印）…」
  - 批量：`BatchProcessMedia`（限频 20 次/秒）
- 查询：**`DescribeTaskDetail`**（100/s）/ **`DescribeTasks`**（100/s）/ `ManageTask`
- 事件通知：`ParseNotification` / `ParseLiveStreamProcessNotification`；也可用 COS 回调
- **异步**（发起 → `TaskNotifyConfig` 回调 或 轮询 `DescribeTaskDetail`）
- `TaskType`：`Online`（实时任务）/ **`Offline`（闲时任务，不保证时效性，默认 3 天内处理完）**
- `SessionId`：三天内相同识别码会去重报错（幂等去重）；`SessionContext` 最长 1000 字符透传

#### 2.1.2 能力清单（`VideoEnhanceConfig` 完整字段，✅ 官方数据结构）

`EnhanceConfig.VideoEnhance`（被 `CreateTranscodeTemplate` / `ModifyTranscodeTemplate` / `ProcessMedia` / `CreateWorkflow` 引用）字段：

| 字段 | 类型 | 说明（原文摘要） |
|---|---|---|
| `SuperResolution` | `SuperResolutionConfig` | 超分配置。**源分辨率高于目标分辨率时不对视频做处理。注意与大模型增强不可同时开启。** |
| `FrameRate` | `FrameRateConfig` | 插帧帧率配置（**旧**）。新用户建议使用 `FrameRateWithDen`。二者二选一。**源帧率 ≥ 目标帧率时能力不会生效** |
| `FrameRateWithDen` | `FrameRateWithDenConfig` | **新**插帧帧率配置，**支持分数** |
| `Hdr` | `HdrConfig` | HDR 配置 |
| `Denoise` | `VideoDenoiseConfig` | 视频降噪（`weak` / `strong`，默认 `weak`）。与大模型增强不可同时开启 |
| `ImageQualityEnhance` | `ImageQualityEnhanceConfig` | 综合增强。**大模型 / 综合增强 / 去毛刺三项里最多配置一项** |
| `ArtifactRepair` | `ArtifactRepairConfig` | 去伪影（毛刺）。同上三项互斥 |
| `ScratchRepair` | `ScratchRepairConfig` | 去划痕 |
| `ColorEnhance` | `ColorEnhanceConfig` | 色彩增强 |
| `LowLightEnhance` | `LowLightEnhanceConfig` | 低光照增强 |
| `DiffusionEnhance` | `DiffusionEnhanceConfig` | **大模型增强**。与综合增强/去毛刺互斥，**且不可与超分、降噪同时开启** |
| `AiRestoration` | `AiRestorationConfig` | **大模型修复**。同上互斥，且不可与超分、降噪同时开启 |
| **`EnhanceSceneType`** | String | **增强场景配置**（见下表） |

**`SuperResolutionConfig`**（✅ 官方结构）：
- `Switch`：`ON` / `OFF`（默认 ON）
- `Type`：`lq`（针对低清晰度有较多噪声的视频的超分）/ `hq`（针对高清晰度视频超分），默认 `lq`
- **`Size`：超分倍数，`2`：目前只支持 2 倍超分。默认 2。**

**`EnhanceSceneType` 枚举**（✅ 官方原文，**这是本项目最相关的一张表**）：

| 取值 | 场景 | 官方说明 |
|---|---|---|
| `common` | 通用 | 通用增强参数，适用于各种视频类型的基础优化参数 |
| `AIGC` | AIGC | 整体分辨率提升，利用 AI 技术提升视频整体分辨率 |
| `short_play` | **短剧 & AI 仿真人剧** | 增强面部与字幕细节，突出人物面部表情细节和字幕清晰度 |
| **`ai_comic`** | **AI 漫剧** | **增强漫画风格画面细节** |
| `short_video` | 短视频 | 优化复杂多样的画质问题 |
| `game` | 游戏视频 | 修复运动模糊，提升细节 |
| `HD_movie_series` | 超高清影视剧 | 生成 4K 60fps HDR 的超高清标准视频 |
| `LQ_material` | **低清素材/老片修复** | 针对老旧视频的分辨率不足、模糊失真、划痕损伤和色温等问题专门优化 |
| `lecture` | 秀场/电商/大会/讲座 | 人脸区域、噪声消除、毛刺处理专门优化 |

#### 2.1.3 能力覆盖核对

| 需求 | 覆盖情况 |
|---|---|
| 超分倍率 | **仅 2 倍**（`SuperResolutionConfig.Size` 只支持 2）。480p(854×480) × 2 = 1708×960（短边 960）；**精确到 720p 需再配合 `VideoTemplateInfo` 的 `Width`/`Height` 设置** |
| 插帧 | ✅ `FrameRate`（旧）/ `FrameRateWithDen`（新，支持分数）；**源帧率 ≥ 目标帧率时不生效** |
| 去噪 | ✅ `Denoise`(weak/strong)、`AudioDenoiseConfig`（音频） |
| 去块 / 去毛刺 | ✅ `ArtifactRepair`（去伪影/毛刺）；官方说明「由于影片在转码或多次转码过程中对视频进行了多次压缩，会引入块效应、振铃效应、色度渗透和蚊噪等，去压缩失真能有效修复编码引入的失真」 |
| 锐化 / 细节增强 | ✅ 官方「细节增强」能力（**注意：`细节增强` 计费项自 2025 年 12 月起下线，仅维护存量用户，能力已整合至「综合增强」「大模型视频增强」**） |
| SDR→HDR | ✅ `Hdr` 配置；官方「HDR：支持 HDR10、HLG」；计费项 `SDR 2 HDR` |
| 老片修复 | ✅ 双重覆盖：`ScratchRepair`(去划痕，「修复视频中的划痕和雪花点等破坏的内容」) + `EnhanceSceneType=LQ_material`；另有 `AiRestoration`(大模型修复) |
| 人脸增强 | ✅ `FaceEnhance`（另见计费项「人脸增强」） |

**增强项的官方命名（用于计量/对账，✅ 官方 `DescribeUsageData` 说明）**
视频增强规格格式：`{TYPE}.{CODEC}.{SPECIFICATION}.{FPS}`。增强 TYPE 取值：
`Enhance`（通用增强，可能是任意一种原子增强类型）；原子增强类型包括
`Sdr2hdr`(SDR2HDR)、**`SuperResolution`(超分)**、**`InsertFrame`(插帧)**、`ComprehensiveEnhancement`(综合增强)、`NoiseReduction`(视频降噪)、`ColorEnhancement`、`RemoveScratches`(去划痕)、`Deburr`(去毛刺)、`DetailEnhancement`、`LightEnhancement`、`FaceEnhancement`；
音频原子增强：`AudioNoiseReduction`、`VolumeBalance`、`AudioBeautify`、`AudioSeparation`。
`MediaTranscodeItem.CallBackExtInfo` 中会回传 `{"enhance_item":["hdr","color_enhance"]}` 形式的增强项清单。

#### 2.1.4 输入限制（✅ 官方结构，部分未写明）

`MediaInputInfo`：

| 字段 | 说明 |
|---|---|
| `Type` | **`COS`：COS源 / `URL`：URL源 / `AWS-S3`：AWS 源，目前只支持转码任务 / `VOD`：点播专业版** |
| `CosInputInfo` | Type=COS 时必填 |
| `UrlInputInfo` | Type=URL 时使用 |

- **URL 直传**：✅ 支持 `Type=URL`
- **输出**：`OutputStorage`（`TaskOutputStorage`）示例值 `{ "Type": "COS", "CosOutputStorage": { "Bucket": "xxxx-yyy", "Region": "region" } }`；**原文「注意：当 InputInfo.Type 为 URL 时，该参数是必填项」** → **输出必须落 COS**
- **`AWS-S3` 输入源值得注意**：官方明确支持 AWS S3 作为输入源，**但注明「目前只支持转码任务」**。本项目的天翼云 ZOS（S3 兼容）若作为源，**是否可用于「增强」任务未证实**（因为增强在实现上依附转码管线，但文档限制写的是「转码任务」）→ 建议实测
- ❌ **文件大小 / 时长 + 分辨率上限**：MPS `ProcessMedia` 文档正文未给出统一上限（未证实）；时长按不同能力模板要求
- 官方文档提示：增强**基于转码实现**，故一次任务收取**两笔费用**（见下）

#### 2.1.5 计价（✅ 官方按量计费页原文）

**规则**：按**增强后输出文件的时长**收费，按**输出分辨率 + 输出帧率**分档，元/分钟；日结（默认，每日 12:00-18:00 结前一日）或月结（需联系商务）；不足 1 分钟按 1 分钟向上取整（按计费周期累计总秒数换算）。

**⚠️ 关键：增强基于转码实现，因此发起一次增强任务会收「增强 + 转码」两笔费用。**

**视频增强单价（中国内地，元/分钟）**——「帧率 ≤30 帧 / ≤60 帧 / ≤120 帧」三档：

| 计费项 | 分辨率档 | ≤30 帧 | ≤60 帧 | ≤120 帧 |
|---|---|---|---|---|
| **超分** | 高清 HD（短边≤720px） | 0.3 | 0.5 | 1.1 |
| | 全高清 FHD（短边≤1080px） | **0.6** | **1.2** | 2.4 |
| | 2K（短边≤1440px） | 1.1 | 2.1 | 4.3 |
| | 4K（短边≤2160px） | 2.4 | 4.8 | 9.6 |
| | 8K（短边≤4320px） | 9.6 | 19.2 | 38.4 |
| **插帧** | HD | 0.6 | 1.2 | 2.4 |
| | FHD | **1.35** | **2.7** | 5.4 |
| | 2K | 2.4 | 4.8 | 9.6 |
| | 4K | 5.4 | 10.8 | 21.6 |
| **综合增强** | HD | 0.8 | 1.6 | 3.2 |
| | FHD | **1.8** | **3.6** | 7.2 |
| | 2K | 3.2 | 6.4 | 12.8 |
| | 4K | 7.2 | 14.4 | 28.8 |
| **大模型视频增强** | HD | 1.3 | 2.5 | 5.2 |
| | FHD | **2.9** | **5.8** | 11.6 |
| | 2K | 5.2 | 10.3 | 20.7 |
| | 4K | 11.6 | 23.2 | 46.4 |
| **大模型视频修复** | HD | 2.5 | 4.9 | 10 |
| | FHD | **5.6** | **11.2** | 22.4 |
| | 2K | 10 | 19.9 | 39.9 |
| | 4K | 22.4 | 44.8 | 89.6 |
| **大模型视频增强-专业版** | HD | 5.5 | 10.7 | 22 |
| | FHD | 12.3 | 24.6 | 49.2 |
| | 2K | 22 | 43.7 | 87.7 |
| | 4K | 49.2 | 98.4 | 196.8 |
| **降噪** | HD | 0.2 | 0.4 | 0.9 |
| | FHD | 0.5 | 1.0 | 2.0 |
| | 2K | 0.9 | 1.8 | 3.6 |
| | 4K | 2.0 | 4.0 | 8.0 |
| **去划痕** | HD | 1.0 | 2.0 | 4.1 |
| | FHD | 2.3 | 4.6 | 9.2 |
| | 2K | 4.1 | 8.2 | 16.4 |
| | 4K | 9.2 | 18.4 | 36.8 |
| **人脸增强** | HD | 0.7 | 1.3 | 2.7 |
| | FHD | 1.5 | 3.0 | 6.0 |
| | 2K | 2.7 | 5.3 | 10.7 |
| | 4K | 6.0 | 12.0 | 24.0 |
| **去毛刺** | HD | 0.1 | 0.2 | 0.4 |
| | FHD | 0.2 | 0.4 | 0.8 |
| | 2K | 0.4 | 0.7 | 1.4 |
| | 4K | 0.8 | 1.6 | 3.2 |
| **色彩增强** | HD | 0.1 | 0.2 | 0.4 |
| | FHD | 0.2 | 0.4 | 0.8 |
| | 2K | 0.4 | 0.7 | 1.4 |
| | 4K | 0.8 | 1.6 | 3.2 |
| **低光照增强** | HD | 0.1 | 0.2 | 0.4 |
| | FHD | 0.2 | 0.4 | 0.8 |
| | 2K | 0.4 | 0.7 | 1.4 |
| | 4K | 0.8 | 1.6 | 3.2 |
| **SDR 2 HDR** | 不区分分辨率 | **0.4** | | |
| 字体增强 | 自 2025-12 起下线（仅维护存量用户） | | | |
| 细节增强 | 自 2025-12 起下线（仅维护存量用户） | | | |

**必须叠加的转码费（普通转码，中国内地，元/分钟）**：H.264 4K 0.278 / 2K 0.136 / **FHD 0.063** / HD 0.0325 / SD 0.016；H.265 FHD 0.3112；AV1 FHD 0.6224；H.266 FHD 0.7469。音频转码 0.0056，转封装 0.007。

**音频增强**：音频降噪 0.1、音频分离 0.1、音频分离-高级版 0.75、音量均衡 0.1、音频美化 0.1（元/分钟，另加音频转码费 0.0056）

**官方计费示例（原文）**：
> 使用综合增强，H.264，转出 2560×1440、60 帧，100 分钟；又使用音频增强-音频美化 100 分钟。
> 综合增强 2K/60 帧原子项单价 6.4 元/分钟；加收 H.264 2K 普通转码 0.136 元/分钟；音频美化 0.1；音频转码 0.0056。
> 则 01月02日费用 =（6.4 + 0.136）× 100 +（0.1 + 0.0056）× 100 = **664.16 元**

#### 2.1.6 配套「验收」能力：媒体质检 + 无参考评分 ✅

**画质提升场景文档**原文提供了「**质检 + 转码&增强**」的按需处理方案：
- **媒体质检**：格式质检（流状态/流信息/容器封装异常、码流诊断、时间戳异常）+ 视频&音频内容质检（**色彩失真、低光照、暗角、对比度异常、重影、模糊、马赛克、噪点**）+ **无参考评分**
- 价值：先质检再针对性增强，且**处理前后用无参考评分对比，量化画质提升效果**
- 另有 **视频评测** 功能（`CreateMediaEvaluation`，评测类型 `PSNR` / `SSIM` / `VMAF` / `VMAF_NEG`，计费页标注「**限时免费公测中**」）

→ **腾讯云是三家（阿里/腾讯/火山）里「增强 + 质检 + 客观评分」闭环最完整的。**

#### 2.1.7 开通前置

- 快速开始：注册与登录 → **授权管理**（需为 MPS 服务角色授权，例如上传 COS 需创建并授权 `MPS_QcsRole`）
- 计费页未见「增强能力需白名单/工单开通」的表述 → **增强能力开通门槛低（未发现特殊前置）**
- ⚠️ 部分高级能力需联系商务/提交工单，例如「提取 NAGRA NexGuard 数字水印」；月结也需联系商务
- 支持中国大陆节点 ✅（计费表按「中国大陆 / 硅谷、弗吉尼亚 / 中国香港、法兰克福、新加坡、首尔、曼谷、东京」分地域；中国大陆单价最低）

---

### 2.2 腾讯云 云点播 VOD 的「音画质重生」

**数据结构**：https://cloud.tencent.com/document/api/266/31773 ✅（最近更新时间 **2026-09-24 03:24:34**）
**媒体处理接口分类**：https://cloud.tencent.com/document/api/266/33425 ✅

- VOD 的 `EnhanceConfig` / `VideoEnhanceConfig` 结构与 MPS **同名同构**（`EnhanceConfig` 在 VOD 数据结构中出现 109 次、`VideoEnhance` 32 次、`SuperResolution` 70 次、`插帧` 36 次、`超分` 66 次），被 `CreateTranscodeTemplate` / `CreateAdaptiveDynamicStreamingTemplate` / `ModifyTranscodeTemplate` 等引用
- VOD **另有专门的「音画质重生」接口类目**（https://cloud.tencent.com/document/api/266/102571 ），关联结构 `EnhanceMediaQualityOutputConfig`（`MediaName` 最长 64 字符、`ClassId`、`ExpireTime` 默认永久不过期）
- 事件通知类型含 **`QualityEnhanceComplete`（音画质重生任务完成）**、`QualityInspectComplete`（音画质检测）
- ⚠️ 注意：`RebuildMediaComplete（音画质重生完成事件）` 标注「**不推荐使用**」
- ❌ **`EnhanceMediaQuality` 未出现在我抓到的 VOD OpenAPI 元数据快照（`vod` / `2017-03-21`）中**，但 VOD API 导航明确列出了「音画质重生」→ 说明该接口存在且较新，**其完整入参需以该页为准（本次未逐字抓取，未证实细节）**
- VOD 的媒体 AI/增强计费与 MPS 共用同一份「按量计费」页（价格同上）

### 2.3 腾讯云其他相关产品

- **腾讯云数据万象 CI 画质增强（第二条独立产品线）** ✅：`POST /template`（`Tag=VideoEnhance`，节点 `SuperResolution` / `FrameEnhance.FrameDoubling`（**帧率倍增/插帧**）/ `MsSharpen`）+ `POST /jobs`；**超分基础版 3.2 元/分钟、插帧 3–36 元/分钟、细节增强 0.4 元/分钟**。来源：https://cloud.tencent.com/document/product/460/58120 （最近更新 2026-06-05）。→ 即腾讯云有**两条**独立的视频超分/插帧产品线（MPS 与 CI），MPS 更便宜、场景预设更贴合，**CI 可作为备份通道**
- **腾讯云智能创作**：相关能力整合在 MPS/VOD 的增强模板与「AI 创作相关接口」类目下（❌ 未证实存在独立命名的 API）
- **转码模板 ∩ 增强**：腾讯云文档标题即「**转码增强模板相关接口**」（https://cloud.tencent.com/document/api/862/116017 ），包含 `CreateTranscodeTemplate`(100/s)、`ModifyTranscodeTemplate`、`DescribeTranscodeTemplates`、`DeleteTranscodeTemplate`、`Create/Modify/Delete/DescribeAdaptiveDynamicStreamingTemplate`。**增强配置挂在转码模板的 `EnhanceConfig` 上，没有独立的「增强模板」接口**——这是本节对「模板 ID」问题的准确回答：**腾讯云不提供类似「超分模板 ID = 12345」的固定公开模板号，而是由你创建 `TranscodeTemplate` 并在其中填 `EnhanceConfig` + `EnhanceSceneType`，拿到自定义 `Definition`（模板 ID）后再在 `ProcessMedia` 里引用。** 官方画质提升文档亦印证：「在媒体处理控制台上可以创建和管理您的音视频增强模板，每个模板中均预设有各项增强参数，创建模板参数页面也提供了**针对不同场景的预设参数**。」

---

## 3. 火山引擎（Volcengine）/ BytePlus —— 【强烈推荐，国内侧价格最低】

> **本节的国内侧结论来自对火山文档站公开 JSON API 的抓取**（关键突破，可复用）：
> SPA 页面 `www.volcengine.com/docs/<LibraryID>/<DocumentID>` 抓不到正文，但**公开 JSON 接口无需登录**：
> - 正文：`GET https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<id>&type=doc` → **必须读 `Result.MDContent`**（纯 markdown、表格完整；`Content` 在新库是 Quill Delta，表格只剩 `[表格uuid:...]` 占位符）
> - 检索：`GET https://docs.volcengine.com/api/search/openSearchNew?Query=<urlenc>&Caller=doc&...`（参数须大写 `Query`）
> - 列整库：`GET https://docs.volcengine.com/api/doc/getDocList?LibraryID=<lib>&type=doc`（VOD 库 4 有 856 篇）

### 3.1 国内侧有两条等价路径，且**按量单价完全相同**

| | **A. 视频点播 VOD · 画质增强** | **B. AI MediaKit · 画质增强** |
|---|---|---|
| 产品名 | 视频点播 VOD > 媒体处理 > **画质增强**（控制台：媒体处理模板 > **画质增强修复模板**） | **智能媒体处理 / AI MediaKit**（独立售卖、独立计费、独立 API Key） |
| 提交接口 | `POST https://vod.volcengineapi.com?Action=**StartExecution**` → `RunId` | `POST https://mediakit.cn-beijing.volces.com/api/v1/**tools/enhance-video**` → `task_id` |
| 查询 | `Action=**GetExecution**`（传 `RunId`）；或工作流回调 | `GET /api/v1/tasks/{task_id}`（`running`/`completed`/`failed`） |
| 鉴权 | AK/SK（**该 Action 不在官方 Go SDK 内，需手工签名**） | `Authorization: Bearer <API Key>`（**Go 工程量最小**） |
| 异步 | ✅ 异步 | ✅ 异步（另支持 `callback_url` / 幂等 `client_token`） |
| 单价 | 标准版基准 **0.75 元/分钟** | **同** |
| 资源包 | 12 个月 **最低 4.5 折**（50 万分钟 4,882 元） | **固定 8.0 折** |

> ⚠️ **不存在 `SubmitEnhanceTask` / `CreateEnhanceTask` 这类独立提交接口**。该结论为穷举级实证：VOD 全库 856 篇文档标题逐个筛查 + 官方 Go SDK `service/vod/config.go` 的 148 个 Action 交叉验证。唯一含 "Enhance" 的 Action 是 `DescribeVodEnhanceImageData`（**用量统计**，不是任务提交）。

### 3.2 能力覆盖（✅ 官方文档 docs/4/117971，UpdatedTime 2026-09-07）

官方原文：「画质增强修复功能基于业界领先的 AI 算法，通过场景化预设模板……结合**超分辨率、智能插帧、色彩增强、音视频降噪**等多种能力，显著提升视频的清晰度、流畅度和色彩表现力。」

**场景预设（`MoeEnhance.Config` / AI MediaKit `scene`）——与 BytePlus / fal.ai 枚举完全一致**：

| 取值 | 场景 | 核心能力 |
|---|---|---|
| `common` | 通用（默认） | 综合画质增强与修复 |
| `ugc` | UGC 短视频 | 修复多次压缩/传输导致的模糊、块效应、失真 |
| **`short_series`** | **短剧** | 面向精品短剧，**对剧中人像增强和细节美化** |
| **`aigc`** | **AIGC 内容** | AI 大模型生成的低分辨率视频 → **超分重绘** |
| **`old_film`** | **老片修复** | 经典影视/老旧影片，综合解决低分辨率、运动卡顿、色彩失真、划痕噪点 |

**自定义增强原子算子（`VolcEnhanceParam.Type`，✅ 官方文档 + SDK proto 注释）**：
`SR`（智能超分）、**`VFI`（智能插帧）**、`SDREnhance`（SDR 增强）、`SDR2HDR`、`AudioDenoise`（音频降噪）

**增强档位 `EnhanceLevel`**：`Fast`（极速版）/ `Standard`（标准版）/ `Pro`（专业版，**档位名在计费上称"画质重生"**）
**增强强度 `RepairStrength`**：文档仅列 `-50`（轻度高保真）、`0`（中等），**仅标准版/专业版支持**
**色深 `Target.BitDepth`**：8（默认）/ 10 / 12 / 16（**仅专业版**；16bit 输出 FFV1 无损，**输入时长须 ≤40 秒且单任务串行**）

### 3.3 能力覆盖核对

| 需求 | 覆盖情况 |
|---|---|
| 超分倍率 | ✅ 智能超分，**最高支持片源分辨率 1920×1080**；输出档位 `240p/360p/480p/540p/720p/1080p/2k/4k/6k/8k`，或 `Target.ResLimit` 指定短边 **[128, 4320]** 等比缩放 → **480p 可精确输出 720p / 1080p** |
| 补帧 | ✅ **`Target.Fps` 设为 60 即可，官方明确「若设置帧率高于原片，将自动启用智能插帧」**，无需显式开 VFI；`fps` 范围 (0, 120] |
| 去噪 | ✅ 智能分析内置；另有 `AudioDenoise`（音频降噪，0.1 元/分钟） |
| 去块 / 锐化 | ✅ 官方：「修复多次压缩/传输导致的模糊、**块效应**、失真」；`enhance_style` 可选 `hd`（默认，锐利）/ `natural`（自然，锐化痕迹更少）；基础算子含去毛刺、细节增强 |
| SDR→HDR | ✅ `SDR2HDR`（1 元/分钟）、`SDREnhance`（0.5 元/分钟） |
| 老片修复 | ✅ `old_film` 预设 + 去划痕/降噪/色彩失真修复 |

### 3.4 输入限制与开通前置

| 限制项 | 值（✅ 官方） |
|---|---|
| **片源分辨率上限** | **不超过 1080p；片源短边最大支持 1081 px** → **480p 成片完全合规** |
| 输出帧率 | 1~120；**高于原片自动启用智能插帧** |
| 目标码率 | `[10, 50000]` kbps（AI MediaKit 侧 `bitrate` 上限 150000）；实际输出在目标 **0.8~1.5 倍**浮动 |
| AI MediaKit 版本限制 | 标准版/专业版：输入最高 2K，短边 [360,1440] 长边 [360,2560]，建议 ≤10 GB；**大模型版：输入最高 1080p，输出仅 `720p`/`1080p`** |
| 组合约束 | 「结果独立存储」关闭时，必须至少选择一个转码/极智超清任务；**画质增强任务与自定义转码组只能同时存在一个** |
| **URL 直传** | ✅ AI MediaKit `video_url` 支持 **4 种输入协议**：公网 HTTP/HTTPS、本地上传 `mediakit://`、火山 VOD `vod://`、火山 TOS `tos://`（支持 mp4/flv/ts/avi/mov/wmv/mkv） |
| 结果获取 | AI MediaKit 默认返回 **HTTPS 临时链接，有效期 24 小时**；设 `media_output_destination` 可返回 `vod://` / `tos://`；**查询自 2026-08-20 起仅支持 30 天内任务** |
| QPS | AI MediaKit 异步任务**账号级全局 40 QPS**（主子账号合并），超出需提工单 |

**开通前置**：
1. 注册火山引擎账号 → **完成实名认证**（分个人/企业两类）
2. **开通视频点播服务** → 创建空间 →（AI MediaKit 另需开通该产品并创建 API Key）
3. **画质增强本身不是白名单功能**（官方白名单列举为「工作流任务、巨量广告预审、ASR 提取字幕、OCR 提取字幕、智能抠图」）；**但走 `StartWorkflow` 需要工单开通，走 `StartExecution` / AI MediaKit 不需要**
4. **免费额度 = 0**：VOD 新用户礼包含 50GB 存储 + 300 分钟转码 + 10GB CDN，但**官方明列 300 分钟不可抵扣「场景式/自定义画质增强」** —— 300 分钟仅抵扣标准转码与极智超清。→ **libtv 的清晰化必须按量付费或买资源包。**
5. 支持**中国内地**节点 ✅（另有亚太东南柔佛，价格一致，但**柔佛仅对企业用户开放**）

### 3.5 计价（✅ 官方计费文档 docs/4/1941013 / docs/6448/2486473）

**口径**：**按「输出文件的时长」计费（元/分钟）**，触发分辨率/帧率换算系数；**不是按调用次数**。底层精确到毫秒。分辨率档位**按输出视频短边判定**。

| 版本 | 基准单价 | 720P ≤30fps | **1080P ≤30fps** | **1080P 30–60fps** | 1080P 60–120fps | 2K ≤30fps | 4K ≤30fps |
|---|---|---|---|---|---|---|---|
| **极速版 Fast** | 0.2 | 0.2 | **0.4** | **0.8** | 1.6 | 0.8 | 1.6 |
| **标准版 Standard** | 0.75 | 0.75 | **1.5** | **3** | 6 | 3 | 6 |
| **专业版 Pro（画质重生）** | 0.75 ×10 | 7.5 | **15** | **30** | 60 | 30 | 60 |
| **大模型版**（AI MediaKit 独有） | 2.5 | 2.5 | **5** | **10** | 20 | 10 | 20 |

**闲时任务**（不可与资源包叠加）：标准版 720P≤30fps 0.225、**1080P≤30fps 0.45**、1080P 30–60fps 0.9 元/分钟。

官方计费示例原文：「用户 A 使用画质增强模型，输出一个 10 分钟、1080P、60fps 的视频，且为正常任务。画质增强费用 = 10 × 0.75 × 4 = 30（元）」。

**⚠️「自定义画质增强」独立算子价（旧版，**不要当默认报价**）**：智能超分 `SR` **8 元/分钟**（闲时 2.4）、智能插帧 `VFI` **2.7 元/分钟**（闲时 0.81）。
官方原文（docs/4/1578688，2026-09-01）：「**自定义增强（旧版）**：指此前手动组合智能超分、智能插帧等独立算子的增强方式。**新的场景化系统已不再支持创建新的自定义增强模板**，此处仅作旧版说明保留。」→ **仅对已存在的旧版模板/老客户保留，新客户能否下单未证实**（且与 docs/4/117971 仍列出该预设的说法矛盾）。

**AI MediaKit 视频插帧独立接口**（`/api/v1/tools/video-frame-interpolation`，`fps` 必填 [15,120]，**不改变分辨率**，按输出时长）：720P ≤30fps 0.6、**1080P 30–60fps 2.4** 元/分钟。
**视频流畅度提升**（`/api/v1/tools/enhance-video-smoothness`，检测周期性卡顿/重复帧）：仅检测 0.1、**检测并修复 1** 元/分钟。
**VOD 资源包**：12 个月 5 千分钟 86 元（7.9 折）、**50 万分钟 4,882 元（4.5 折）**；官方明列**可抵扣「标准转码、极智超清、场景式画质增强、自定义画质增强、视频剪辑」**；**仅正常任务可抵扣，闲时任务不可**。

**⚠️ 帧率档位口径变更公告**（docs/4/2552696，2026-06-26）：**2026-07-01 起**帧率档位由 2 档（15–30 / 31–120 FPS）改为 **3 档（15–30 / 31–60 / 61–120 FPS）**。→ 本节采用 3 档新口径，**2026-07-01 之前的账单不可直接对比**。

### 3.6 验收：无参考画质评分 —— ✅ **有（VQScore）**

官方原文（docs/4/337732，2026-09-15）：「**VQScore（Video Quality Score）是火山引擎研发的无参考视频质量评价算法**……**相较于需要参考视频的算法如 PSNR、SSIM、VMAF，VQScore 可以独立对输入的视频和图像进行评分，无需参考视频**，直接模拟人类对视频的视觉感受。」
评分区间：0~60 主观感受较差 / 60~70 良好 / **70~100 清晰**。官方适用场景含「**识别伪高清视频（规避分辨率欺骗）**」。
- 入口：VOD `StartExecution` 提交无参考画质检测任务（**QPS 50 次/秒，仅支持 VOD SDK 2.0**）；或 AI MediaKit `POST /api/v1/tools/assess-video-quality`（异步，输入最高支持 4K，支持公网 URL / `mediakit://` / `vod://` / `tos://`）
- **单价 0.1 元/分钟**（按片源时长，**不区分分辨率，暂不支持资源包抵扣**）
- 另有「**画质检测修复**」：支持无参考/有参考多维度评分，并可检测并修复黑帧、水波纹等问题

> 💡 验收建议：清晰化前后各跑一次 VQScore（3 分钟成片 ≈ 0.3 元/次），用「评分从 <60 进到 >70」作自动化门禁。

### 3.7 BytePlus（海外）—— ✅ 全部证实，含官方 USD 价表

- 能力名 **vCube**，**同样五个预设**（英文为 general / UGC / AIGC / **short dramas** / **classic film restoration**）
- 接口：`POST https://vod.byteplusapi.com?Action=StartExecution&**Version=2025-07-01**`（AK/SK），`GetExecution` 同版本，回调事件 `ExecutionComplete`
- ⚠️ **仅支持 Johor（柔佛），不支持 Singapore**
- **官方 USD 价表**（https://www.byteplus.com/docs/byteplus-vod/7848 ，2026-07-07）：Standard **1080P≤30fps = $0.4132/分钟**、720P $0.2066、1080P 30–60fps $0.8264、Pro ×10。原文「**低于 720P 的输出按 720P 计价**」。独立价表，**未复用转码价**（转码 1080p 仅 $0.0115/分钟）

**⭐ 同一引擎的价格阶梯（这是本次调研最有价值的定价洞察）**：

| 渠道 | 1080P≤30fps 标准版 | 折人民币（≈7.1） | 相对国内价 |
|---|---|---|---|
| **火山引擎国内站** | **¥1.5/分钟** | ¥1.5 | **1.00×** |
| BytePlus（官方 USD 价表） | $0.4132/分钟 | ≈¥2.93 | **≈1.96×** |
| fal.ai（第三方转售 `bytedance-upscaler`） | $0.432/分钟（$0.0072/s） | ≈¥3.07 | **≈2.05×** |

各档倍数稳定在 ~1.96×，**唯一例外是 Fast 档（3.67×）**——BytePlus 的 Fast = Standard 的 0.5×，国内极速版 = 标准版的 0.267×，**走 BytePlus 时 Fast 档不划算**。

**fal.ai 线索已亲自证实**：其 schema 原文「**Enhance and upscale a video using BytePlus VOD**」，参数枚举（`enhancement_preset` = general/ugc/**short_series**/aigc/**old_film**；`enhancement_tier` = fast/standard/pro；`target_fps` 24–120；`scale_ratio` 1.1–10.0；`fidelity` high/medium；`bit_depth` 8/10/12）与国内侧**一一对应** → **fal.ai 只是 BytePlus 转售，无价格优势。**
**veImageX 是图片，不是视频**：图像超分 `GetImageSuperResolutionResult`（`Version=2023-05-01`，**同步**，**2.76 元/千次**；画质增强 6.21 元/千次）。**BytePlus 上没有 veImageX**，图片走 `/api/v1/tools-sync/enhance-image`（$1.00/千次 × 系数）。

### 3.8 火山引擎小结

| 入口 | 超分 | 插帧 | 去噪/去块 | SDR2HDR | 老片修复 | 场景预设 | 调用形态 | 单价（1080P） | 开通条件 |
|---|---|---|---|---|---|---|---|---|---|
| **VOD 画质增强**（场景式） | ✅ 片源≤1080p | ✅ `Target.Fps` 自动 | ✅ | ✅ | ✅ `old_film` | ✅ `short_series`/`aigc`/`old_film`/`ugc`/`common` | `StartExecution` 异步 + `GetExecution` | **1.5 元/分（≤30fps）/ 3 元/分（30–60fps）** | 实名 + 开通 VOD；**无需白名单** |
| **AI MediaKit 画质增强** | ✅ 输入≤2K（大模型版≤1080p） | ✅ 同 | ✅ | ✅ | ✅ | ✅ 同上 | REST 异步 + `GET /tasks/{id}` | **1.5 / 3 元/分**（大模型版 5 / 10） | 实名 + 开通 + API Key |
| VOD 自定义增强 ⚠️旧版 | ✅ SR | ✅ VFI | ✅ | ✅ | — | — | 同上 | SR 8 元/分、VFI 2.7 元/分（**新客户能否开未证实**） | — |
| VQScore（验收） | — | — | — | — | — | — | 异步 | **0.1 元/分** | 同 VOD |
| BytePlus vCube | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 英文五预设 | `StartExecution` `Version=2025-07-01` | **$0.4132/分**（仅 Johor） | 未证实 |

---

## 3b. 【重要】腾讯云 MPS 有官方预置「漫剧场景」增强模板

子代理在 https://cloud.tencent.com/document/product/862/118703 （标题「音视频增强接入」，**最近更新时间 2026-09-30**）发现**官方预设增强模板 ID 表**——这是本项目最直接的「开箱即用」资产：

| 预设模板 ID | 模板名称 | 计费 |
|---|---|---|
| 327001 / 327003 / 327005 / 327007 | 真人场景-大模型增强-720P / 1080P / 2K / 4K | 「大模型视频增强」+「极速高清转码」 |
| 327025 / 327026 / 327027 / 327028 | 真人场景-大模型增强-**小脸优化**-720P/1080P/2K/4K | 同上 |
| **327002 / 327004 / 327006 / 327008** | **漫剧场景-大模型增强-720P / 1080P / 2K / 4K** | 同上 |
| **327029 / 327030 / 327031 / 327032** | **漫剧场景-大模型增强-小脸优化-720P/1080P/2K/4K** | 同上 |
| 327021 / 327022 / 327023 / 327024 | 老片/低清场景-**大模型修复**-720P/1080P/2K/4K-帧率随源 | 「大模型视频修复」+「极速高清转码」 |

调用方式（官方示例）：`ProcessMedia` → `MediaProcessTask.TranscodeTaskSet[].Definition = <模板ID>`；输入支持 `"Type":"URL"` 直传或 COS；输出 COS/VODPro；回调 `TaskNotifyConfig`。
官方提示原文：「为确保效果并避免因配置错误导致不合预期的结果，**建议优先使用预设模板**或直接联系我们进行优化配置。」

→ **这意味着 libtv 用 `Definition=327004`（漫剧场景-大模型增强-1080P）一行动作即可拿到「针对漫剧优化的大模型增强」，成本 = 大模型视频增强 FHD(2.9 或 5.8 元/分) + 极速高清转码。**

---

## 4. 百度智能云 / 华为云

### 4.1 百度智能云 · 音视频处理 MCP「智感超清」✅ 有开放 API，且**是「云厂商里唯一支持补帧且资料完整」的一家**

文档路径 `/doc/MCT/`；能力藏在「**智感超清**」下：细节增强 / 色彩增强 / 人脸增强 / 智能超分 / 智能HDR / **智能插帧** / 老片修复（去划痕、去噪、黑白上色）。

- **接口（异步）**：创建 `POST /v3/job/transcoding`（host `media.bj.baidubce.com`）；查询 `GET /v3/job/transcoding/{jobId}`；模板 `POST /v3/preset`
- **Preset 字段（逐字核实）**：`extraCfg.superResolution`（bool，**最多超分 3–5 倍**）、`superResolutionVersion`（0–4 模型）、`aiVideoEnhance` + `enhanceStrength`（0–1，越大越锐利）、`aiVideoDenoise`（0–1）、`aiVideoScratchRemove`（0–1）、`aiVideoColorization`、`colorEnhance`、`aiSdrToHdr`（需 h265/main10）、**`frameInterpolate`**；`transCfg.transMode` 含 `super_resolution` / `super_resolution_vis`
- **预置模板**：`mcp.video_mp4_720p_h264_sr`、`mcp.video_mp4_1080p_h264_sr`（**正对 480p→720p/1080p**）；`mcp.video_mp4_4k_h265_sr_hdr_cz`（超分 + **fps 提到 60** + HDR，**但仅 4K 档**）；老片修复 4 个 `mcp.video_mp4_follow_scratch_noise*`
- **单价**（官方计费项页，更新时间 2024-11-25，元/分钟，按输出分辨率档）：智能超分 SD **0.5** / **HD 0.9**；画质增强（细节/色彩）HD **0.35**；**智能插帧 HD 1.5**；智能HDR HD **0.6**；老片修复去噪/去划痕 HD **6.0**（最贵，比超分贵约 6.7 倍）；黑白上色 HD 0.8。后付费
- **硬约束（工期风险点）**：**白名单开放，需工单申请**（提供 userID + pipeline 名称）；**仅华北-北京**；**不支持自定义模板**（只能用上述预置模板，需自定义再提工单）；输入必须 `sourceKey`（**BOS Key，无 URL 直传**，区域须与 BOS 一致）；单文件 ≤5TB；队列 100/账号
- 百度 VOD **无增强能力**（仅存储+分发）；「图像增强与特效」**仅图片**；**未找到任何「AI视频修复」独立产品或 VisionSeed**

**成本对照（480p→1080p@60fps）**：智能超分 HD 0.9 + 智能插帧 HD 1.5 ≈ **2.4 元/分钟** —— **比腾讯云（≈3.96）便宜，比火山标准版（3 元）便宜**，但受"仅北京 + 必须入 BOS + 白名单工单"三重约束。

### 4.2 华为云 · 媒体处理 MPC「视频增强」✅ 有独立 API，**但缺补帧、单价未证实**

- ⚠️ 官方 API 概览页（2026-09-07）**未收录**增强接口；以下 API 全部取自官方 SDK `huaweicloudsdkmpc==3.1.216`：
  - 模板：`CreateQualityEnhanceTemplate`（`POST /v1/{project_id}/template/qualityenhance`）、`Update`/`Delete` 同路径、`ListQualityEnhanceDefaultTemplate`（`GET .../qualityenhance/default`）
  - 任务：`CreateMediaProcessTask`（`POST /v1/{project_id}/enhancements`，body `{input, output, template_id}`）→ 轮询 `ListMediaProcessTask`（`GET` 同路径）
- **6 个算子**（各带 `execution_order`，**顺序可控，比百度灵活**）：`video_superresolution`（`hw-sr`，**scale 2~8，默认 2**）、`video_denoise`、`video_deblock`、`video_sharp`（amount）、`video_contrast`、`video_saturation`
- **❌ 无插帧**：SDK 全量 255 个文件 grep「插帧」0 命中；且 `Video.frame_rate` 明确「**若高于片源帧率则自动调整为片源帧率**」→ 不能做 24/30→60fps。另有 `VideoProcess.upsample`（0/1，「如支持从 480P 转 720P」）是**普通上采样，非 AI 超分**，勿混淆
- 输入：**MPC 无媒资存储，必须 OBS 桶 + 桶授权，不支持 URL 直传**；不支持跨区域媒资；流控 100 次/分钟/租户
- 华为云 VOD：官方 SDK 检索 enhance / 超分 / 插帧 **0 命中**（但有 `CreateUploadByUrl` 可 URL 拉取）
- AI Gallery：列表/详情页全 JS 渲染、无 JSON API，**具体超分模型未能证实**（且属 ModelArts 自建推理，非现成 API）
- **❌ 单价与计价方式未证实**：定价页 `pricing.html#/mpc` 是 JS SPA（HTML 无价格）；计费说明文档页未定位（`productdesc-mpc/mpc030004.html` 为 404）。**未引用任何二手价格**

> **方法学警告（影响复现）**：`support.huaweicloud.com` 在本环境**被腾讯云 EdgeOne 机器人验证站点级拦截**（任何路径返回 2190 字节 Security Verification 页；UA / 完整浏览器头 / TLS / HTTP1.0 均无效）；`www.huaweicloud.com` 返回 29186 字节混淆 JS 反爬壳。华为官方页面改用 harness 内置 `web_fetch` 取得。Wayback / DDG / allorigins / codetabs / r.jina.ai 等出口在本机均不可用。百度站 curl 正常。

---

## 5. 声网 / 即构 / 网易云信 / 七牛 / 又拍 / UCloud 等

**一句话结论：6 家里只有「七牛云」有真正的「文件级」视频超分 API；「又拍云 / 声网 / UCloud」完全没有；「即构 ZEGO / 网易云信」有「超分」字样但只是 RTC 实时链路对视频流做增强，对成片批处理不可用。**

### 5.1 ✅ 七牛云（唯一有文件级超分 API）

七牛「智能多媒体服务（Dora）」有独立**画质增强**分类：视频超分、倍速视频超分、视频色彩增强（SDR→HDR）、音频降噪、图像超分。

- **视频超分 fop**：`aicvt/format/mp4/vcodec/H.264/srMode/base|faceEnhance/superResolution/2|3`
  - **只支持整数 2x / 3x（无 4x）**；输入 **≤1920×1080**；输出帧率 = 源帧率 [1,60]；**仅华东区域**；主接口**不支持 m3u8 输出**；URL: https://developer.qiniu.com/dora/12508/video%20super%20resolution （最近更新 2024-08-15）
- **倍速超分** `aifast/.../superResolution/2|3/srMode/.../faceFilter/1`（建议 >5 分钟视频；仅华东；输出 mp4/m3u8）https://developer.qiniu.com/dora/12825/aifast （2024-11-01）
- **SDR→HDR**：`avthumb/<format>/hdr/1/maxLuminance/500~1000` —— **必须输出 H.265**，不能与 `avsmart`/`pixFmt` 同用；BT2020/10bit/最高 1000nit https://developer.qiniu.com/dora/12665/VideoColorEnhancement （2024-03-29）
- **音频降噪** `aicvtAudio/format/mp4/adenoise/1`（0.1 元/分钟；开启后音频变单声道 16kHz AAC，**对成片有损**）
- **调用形态（异步）**：`POST /pfop/`（bucket + key + fops + notifyURL）→ `persistentId` → **`GET /status/get/prefop?id=`（**仅能查 10 天内**）** 或 notifyURL 回调；也支持上传时 `persistentOps`。https://developer.qiniu.com/dora/1291/persistent-data-processing-pfop （2025-05-16）
- **计价**（官方定价页 2024-08-28 https://developer.qiniu.com/dora/12730/volumetric-billing）：按**输出文件时长**元/分钟，累计不足 1 分钟不计费；帧率分档「普帧 ≤30fps / 高帧 30<r≤60」
  - **视频超分-普通版 普帧 1080p 及以下 = 0.8 元/分钟**；高帧 1.6；2K 1.6/3.2；4K 3.2/6.4；8K 4.8/9.6
  - **人脸增强版 普帧 1080p 及以下 = 1.6 元/分钟**；高帧 3.2
  - SDR→HDR 1080p 及以下 0.4（普帧）/0.8（高帧）元/分钟；音频降噪 0.1；图像超分 0.04~0.1 元/次
  - **量级参照：同页普通转码 1080p H.264 仅 0.0324 元/分钟 → 超分约等于普通转码的 25 倍**
  - **超分不支持「闲时任务」**（pfop 文档的闲时支持清单只有普通转码/锐智转码 2.0/拼接/分段/截图；定价表超分行闲时列为空）
- **⚠️ 对 480p→1080p 的硬伤**：854×480 的 2x = 1708×960、3x = 2562×1440 → **拿不到精确 1920×1080，需再接一步 `avthumb` 缩放**，而 3x 会跳到 2K 档（1.6/3.2 元/分钟）
- **补帧：七牛没有**（`avthumb` 只有 `/r/` + `/HighFrameRate/` 常规帧率控制，官方未表述为 AI 插帧）
- ❌ 未证实：URL 直传（pfop 只吃 bucket+key，倾向不支持）、aifast 单独单价、实名/白名单前置要求

### 5.2 ⚠️ 只有「实时增强」，不是文件级超分（关键区分）

- **即构 ZEGO**：`video/super-resolution` 明确是**拉流端对视频流画面倍增**（640×360→1280×720）；**同时只能 1 条流**、**原始分辨率不建议 >640×360**、**必须联系 ZEGO 技术支持特殊编包**；客户端 SDK（`initVideoSuperResolution` + `ZegoSuperResolutionState`），**无 HTTP API、无任务 ID / 轮询 / 回调**。另有推流端实时「低照度增强 / 视频降噪 / 色彩增强 / 美颜锐化」。URL: https://doc-zh.zego.im/real-time-video-android-java/video/super-resolution 。站内 sitemap 6413 条 URL 扫描：超分/增强页**全部落在客户端 SDK 产品线**，`cloud-*` 服务端产品线无任何超分页
- **网易云信**：`NERtcEx.getInstance().enableSuperResolution(enableFlag)`，原文「**必须为本端接收到的第一路 360P 的视频流**」「必须为摄像头采集的主流大流」「**不支持小流和屏幕共享辅流**」「**请联系技术支持开通**」，页面更新 2025-06-11。URL: https://doc.yunxin.163.com/nertc/guide/zYzMjc0NTA?platform=android 。对文档站全库检索（逆向其公开 JS bundle 里的搜索接口 `doc-interface.yunxin.163.com/fe/search`，HMAC-SHA256 签名）：「超分/超分辨率」只命中 RTC 的 AI 超分；「锐化」只命中美颜 `kNERtcBeautyFaceSharpen`；「画质增强」只命中暗光增强枚举 `NERtcVideoLowlightEnhanceLevel`；**插帧 / 老片修复 / 视频去噪零命中**

### 5.3 ❌ 完全没有

- **又拍云**：把官方异步音视频处理 `avopts` **全部参数逐条枚举**（`/vb /s /as /r /sp /sm /acodec /vcodec /an /vn /su /ar /ac /sar /dar /pv /level /f` + 切片/水印/剪辑/动图/拼接/加密），**无任何超分/插帧/去噪/锐化/HDR/修复参数**；`nbhd` 是窄带高清省带宽、`/su/` 是倍速播放，**都不是画质增强**；站内搜索「超分」零结果。https://help.upyun.com/knowledge-base/av/
- **声网 Agora**：「媒体服务」全部产品 = 云端录制 / 本地服务端录制 / 旁路推流 / 输入在线媒体流 / 云端转码 / RTMP 网关 / RTC 服务端 SDK / PPT 转码 —— **无媒体处理/画质增强产品**。云端转码官方原文「专为**实时互动产品**中的**直播场景**开发……获取 **RTC 频道**中主播的音视频源流……发布到**声网的 RTC 频道**」= **直播流转码，不是文件处理**。sitemap 8219 条 URL 全产品命名空间枚举后确认无此类产品
- **UCloud**：官方 OpenAPI 索引「**视频服务**」分组**只有 ULive（云直播）和 URTC（实时音视频）**，**没有视频点播/多媒体处理产品**；ULive 全部 38 个 Action 与 URTC 全部 13 个 Action **无任何画质增强 Action**。https://docs.ucloud.cn/api/README.md
- **京东云**（顺手核查）：视频点播只有转码/剪辑/模板管理，超分/插帧/画质增强零命中；`/cn/media-processing/` 产品不存在
- **金山云 / 移动云 / 天翼云 / 联通云**：见 `docs/research/parts/rtc-cdn-optional.md`（另附）

---

## 6. 国内「AI 视频修复 / 超分」垂直厂商

**一句话结论：国内垂直厂商里没有一家「公开文档 + 公开定价 + 自助开通」的视频超分 API；有能力的都是申请制/私有化。唯一公开自助可用的视频超分+插帧 REST API 是美国的 Topaz Labs（无中国大陆节点，数据出境风险）。**

| 厂商 | 对外开放文件级视频超分/插帧 API | 形态 | 公开单价 |
|---|---|---|---|
| **商汤 SenseTime** | **否 / 未证实** | SenseNova=LLM 平台（`api.sensenova.cn` 仅 LLM）；SenseCore 无超分托管 API；SenseME/TetrasMobile 为**端侧 SDK/ISP 芯片** | 未证实（仅"产品咨询/专家服务"） |
| **美图 AI 开放平台** | **是（申请制）** | 产品条目确含**视频超清 / 视频AI超清2.0 / Video Super Resolution / 视频-画质增强 / 视频去噪**；基址 `https://openapi.mtlab.meitu.com/`，实测确认路由 `v1/superResolution`、`v1/videoEnhance`、`v1/videoDenoise` 存在（无授权返回 `GATEWAY_AUTHORIZED_ERROR`）；**异步 + 轮询** | **未公开**（流程：注册→申请接口→价格确认→订单支付） |
| **Topaz Labs**（美国） | **是（唯一公开自助）** | **REST API**，含 **video upscaling + video frame interpolation**（官方 FAQ 原文）；异步四步：`POST https://api.topazlabs.com/video/` → 轮询 | **Developer $50/mo = 500 credits（$0.10/credit）；Scale $240/mo = 3000 credits（$0.08/credit）；Starter $0.12/credit（COMING SOON）**；1 credit = 「单次请求、输出至多 2400 万像素」（Enhance 端点）。**❌ 无中国大陆节点** |
| **万兴科技（天幕）** | **仅图片超分** | 调研范围内**唯一真有开放 API 的垂直厂商**（base `wsai-api.wondershare.cn`，Basic 鉴权 + 异步轮询），但只有图片超分 `/v3/pic/fsr/batch`；**视频超分/插帧/修复 90 个关键词 0 命中** | 未证实 |
| **RunningHub**（境内聚合平台，400+ 模型） | **是（单价未证实）** | 官方 **RH 视频超分** `POST /openapi/v2/rhart-video/video-upscaler`（body `{videoUrl, targetResolution:"1080p"}`，**单次 ≤10 分钟**，官方原文称「帧间一致性、消除画面闪烁与伪影」）；另有 `/video-fps-increaser`（**补帧**）、**Topaz 系列** `/openapi/v2/topazlabs/video-*`（Proteus/Starlight/Astra/Denoise/FrameInterpolation）、**火山画质增强三档** | ❌ **未证实**（价格页异步加载） |
| **牛学长 / 牛小影**（HitPaw 中文站） | 未证实（有入口未公开） | 官方称提供「视频分辨率提升 API」与私有化部署，接口/参数/单价全需商务咨询 | 未证实 |
| **微帧科技 Visionular** | 未证实 | 有公开 REST 文档但**只覆盖转码与直播**；AI 超分/插帧产品「帧彩视界」为商务咨询制 | 未证实 |
| **影谱科技 Moviebook** | 未证实 | 官网域名在本机无法解析，未取得任何一手资料 | 未证实 |
| **相芯 FaceUnity** | 否 | 客户端 SDK 授权 + 数字人云 API；全站零命中 | 未证实 |
| **极睿 / 硅基智能 / 瑞莱智慧 / 深言 / 出门问问 / Filmora·Virbo** | 否 | 均无视频超分/插帧/修复（瑞莱做**检测**，方向相反） | 未证实 |
| **虹软 ArcSoft** | 否 | **端侧 ISP 级嵌入式离线 SDK**；其「AI 开放平台」只开放人脸 | 免费 SDK 为主 |
| **中科视语 VISIQUEST** | 未证实 | 官网域名失效；前端产物零命中 | 未证实 |
| **海康威视** | 否 | AI 开放平台**全量商品 27 项均已枚举，零项超分/增强**；路线为算法训练 + 模型/硬件交付 | 未证实 |
| **大华股份** | 否 | 云平台真开放且公开计价，但计价维度是路数/带宽/流量，唯一视频处理项是「转码」 | 已抓到公开价目表 |

**兜底/自建路线（重要）**：**OpenMMLab MMagic** —— 无官方云 API，但 **Apache-2.0 开源、可商用、可自建**。README 在册的 **Video Super-Resolution** 算法含 **EDVR (CVPR'2018)、BasicVSR (CVPR'2021)、BasicVSR++ (CVPR'2022)、RealBasicVSR (CVPR'2022)**；**Video Interpolation** 含 **TOFlow (IJCV'2019)、CAIN (AAAI'2020)、FLAVR (CVPR'2021)**。
（源：https://raw.githubusercontent.com/open-mmlab/mmagic/main/README.md 、`.../LICENSE`）
→ 商汤系的 EDVR/MMSR 能力正是以**开源**形态存在（商汤与港中文 MMLab 合作），这是「拿不到 API 但完全可控」的兜底方案。

> ⚠️ **许可证修正（重要，供应商常报错）**：**Video2X 实为 AGPL-3.0（不是 GPL-3.0）** —— 以 SaaS 形式对外提供会触发**源码开放义务，不可闭源集成**。可放心自建/闭源集成的：**Real-ESRGAN (BSD-3)、Practical-RIFE (MIT)、Anime4K / waifu2x (MIT)、BasicSR / FILM / SeedVR / MMagic (Apache-2.0)**。
> 建议的自建组合：**MMagic（7 个视频超分 + 3 个插帧算法，TOFlow 含去噪去块）+ Real-ESRGAN + Practical-RIFE** —— 完全规避数据出境，且许可证干净。

> 全量明细（含 14+ 条未证实清单、Topaz 完整四步调用示例、美图 243 条文档菜单）见 `docs/research/parts/vertical.md`。

---

## 7. 汇总对比表

### 7.1 能力矩阵（仅列**已证实**的对外 API）

| 厂商 / 产品 | 超分倍率 | 插帧 | 去噪 | 去块/锐化 | SDR2HDR | 老片修复 | 场景预设 | 调用形态 | 单价（中国内地） | 开通前置 | 大陆节点 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **阿里云 视觉智能 `EnhanceVideoQuality`** | 输出宽高可指定（原始 1/2~4 倍） | ✅ 内置 | ✅ | ✅ | ✅ PQ/HLG | ✅ | ❌ | 异步 + `GetAsyncJobResult` | 480p 输入≤720P：4 元/分（≤30帧）、**8 元/分**（30~60帧） | 开通「视频生产服务」 | ✅ 华东2(上海) |
| 阿里云 视觉智能 `SuperResolveVideo` | 固定 2 倍 | ❌ | ✅ | ✅ | ❌ | ✅ | ❌ | 同上 | ≤720P：0.4 元/分（≤30帧） | 同上 | ✅ |
| 阿里云 视觉智能 `InterpolateVideoFrame` | ❌ | ✅ 1~120fps | — | — | ❌ | — | ❌ | 同上 | ≤720P 输入：**6 元/分**（输出 30~60帧） | 同上 | ✅ |
| **阿里云 IMS 音画增强（官方「AIGC 视频超分」教程）** ⭐ | 预置模板 SR5：**`S00000004-401040`(720P→1080P)**、**`S00000004-401070`(1080P→4K)**；超分默认开、放大 2 倍；另称支持 2x/3x + 自定义输出 [128,4096] | ❌ **无插帧** | ✅ 多帧降噪 | ✅ 去压缩失真 + 色彩与对比度增强 | ✅ `SDR 转 HDR`（需 H.265） | ✅ 老片高清重制 / 低质量片源修复 | ❌（有官方 AIGC/老片**场景叙事**，但非参数化预设枚举） | **`SubmitMediaConvertJob`**（异步返回 JobId）→ `GetMediaConvertJob` / 回调 **`MediaConvertComplete`**；官方建议用回调而非高频轮询 | 标准版 **0.003255 元/帧**（HD≤1080p）≈**4.88 元/分@25fps / 5.86@30fps**；2K 0.007；4K 0.014；专业版 HD 0.05 元/帧 | **须提交工单开通音画增强**；输入输出**必须在 OSS**；RAM 权限 `ice:SubmitMediaConvertJob` | ✅ 华东1/2 |
| 阿里云 MPS 分辨率倍增 | 预置 2 倍（`S00000001-400040` SDToHD / `-400070` 2KTo4K） | ❌ | — | — | HDR 标准版单列 0.00217 元/帧 | — | ❌ | `SubmitJobs` → `QueryJobList`/`ListJob` | 同超分标准版 | 窄带高清 2.0 管道 | ✅ 仅华东1/2 |
| **腾讯云 MPS `ProcessMedia`** | **2 倍**（`SuperResolutionConfig.Size` 仅支持 2） | ✅ `FrameRate`/`FrameRateWithDen`（支持分数） | ✅ `Denoise` weak/strong | ✅ `ArtifactRepair`/`ScratchRepair` | ✅ `Hdr`（HDR10/HLG），SDR2HDR 0.4 元/分 | ✅ `LQ_material` + `AiRestoration` | ✅ **`ai_comic`(AI漫剧) / `short_play`(短剧) / `AIGC` / `LQ_material` / `short_video` / `game` / `HD_movie_series` / `lecture` / `common`** | 异步 + `DescribeTaskDetail`/回调；`Online`/`Offline` | 输出 FHD：超分 0.6/1.2/2.4、插帧 1.35/2.7/5.4、综合增强 1.8/3.6/7.2、大模型增强 2.9/5.8/11.6、大模型修复 5.6/11.2/22.4（元/分，按 ≤30/≤60/≤120 帧）；**另加转码费 H.264 FHD 0.063** | 授权管理（`MPS_QcsRole`）；未见白名单要求 | ✅ |
| 腾讯云 VOD 音画质重生 | 同 MPS 结构 | 同 MPS | 同 MPS | 同 MPS | 同 MPS | 同 MPS | 同 MPS | 异步（`QualityEnhanceComplete` 事件） | 同 MPS 计费页 | 同 MPS | ✅ |
| **火山引擎 VOD 画质增强 / AI MediaKit 画质增强** ⭐**最便宜** | ✅ 片源≤1080p（短边≤1081px）；输出档位到 8k 或 `ResLimit` 短边 [128,4320] | ✅ **`Target.Fps`/`fps` 高于原片自动启用智能插帧** | ✅ 内置 | ✅ 官方"块效应修复"+`enhance_style: hd/natural` | ✅ `SDR2HDR` 1 元/分 | ✅ `old_film` 预设 + 去划痕 | ✅ **`common`/`ugc`/`short_series`/`aigc`/`old_film`** | 异步：`StartExecution`→`GetExecution`（VOD）或 `POST /tools/enhance-video`→`GET /tasks/{id}`（AI MediaKit） | 标准版 **1080P≤30fps 1.5**、**1080P 30–60fps 3**；极速版 0.4/0.8；专业版 15/30；大模型版 5/10（元/分）；资源包 12 个月最低 **4.5 折** | 实名 + 开通 VOD/MediaKit；**无需白名单**；**免费额度不可抵扣增强** | ✅ 中国内地（另有柔佛，仅企业） |
| 火山 VOD 自定义增强 ⚠️旧版 | ✅ `SR` | ✅ `VFI` | ✅ | ✅ | ✅ | — | — | 同上 | SR **8 元/分**、VFI **2.7 元/分**（官方注明新系统**不再支持新建**自定义增强模板） | — | ✅ |
| 火山 **VQScore**（验收） | — | — | — | — | — | — | — | 异步 | **0.1 元/分**（不区分分辨率） | 同 VOD | ✅ |
| **百度智能云 MCP「智感超清」** | ✅ **3–5 倍**（`superResolution` + `superResolutionVersion` 0–4 模型） | ✅ **`frameInterpolate`** | ✅ `aiVideoDenoise`(0–1) | ✅ `aiVideoEnhance`+`enhanceStrength`(0–1) | ✅ `aiSdrToHdr`（需 h265/main10） | ✅ `aiVideoScratchRemove` + 黑白上色 | 预置模板（非自定义场景枚举）：`mcp.video_mp4_720p/1080p_h264_sr`、`_4k_h265_sr_hdr_cz`（超分+fps60+HDR，仅 4k） | 异步：`POST /v3/job/transcoding` → `GET /v3/job/transcoding/{jobId}` | 智能超分 SD **0.5**/HD **0.9**；智能插帧 HD **1.5**；画质增强 HD 0.35；智能HDR HD 0.6；老片修复 HD **6.0**（元/分，按输出分辨率档） | **白名单工单**（userID+pipeline 名）；**仅华北-北京**；**不支持自定义模板**；**输入必须 BOS Key（无 URL 直传）** | ✅ 仅北京 |
| **华为云 MPC 视频增强** | ✅ `video_superresolution`（`hw-sr`，**scale 2~8**，默认 2） | ❌ **无插帧**（帧率高于片源会被自动降回） | ✅ `video_denoise` | ✅ `video_deblock` + `video_sharp` | ✅ `video_contrast`/`video_saturation` | 部分 | ❌（用模板，非场景预设）；6 算子各带 **`execution_order` 顺序可控** | 异步：`CreateMediaProcessTask`（`POST /v1/{project_id}/enhancements`）→ `ListMediaProcessTask` | ❌ **单价未证实**（定价页为 JS SPA，HTML 无价格） | 需 OBS 桶 + 桶授权；**不支持 URL 直传**；流控 100 次/分/租户 | ✅ |
| **七牛云 Dora**（本批唯一有文件级超分） | ✅ `aicvt/.../superResolution/2\|3`，**仅整数 2x/3x**；输入 ≤1920×1080 | ❌ | ✅（音频降噪 0.1 元/分） | ✅ 人脸增强版 `srMode/faceEnhance` | ✅ `avthumb/hdr/1`（**须 H.265**） | 部分 | `srMode/base\|faceEnhance` | `POST /pfop/` → `persistentId` → `GET /status/get/prefop?id=`（**仅查 10 天**）/ 回调 | **超分普通版 1080p 及以下 0.8 元/分**（普帧）/1.6（高帧）；人脸增强版 1.6/3.2 | 需七牛账号+存储空间；**超分不支持闲时任务** | ✅ **仅华东** |
| **BytePlus VOD vCube**（海外，✅ 已证实） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ `classic film restoration` | ✅ `general`/`UGC`/`AIGC`/**`short dramas`**/**`classic film restoration`** | `POST vod.byteplusapi.com?Action=StartExecution&Version=2025-07-01`（AK/SK）→ `GetExecution` | **官方 USD 价表：Standard 1080P≤30fps $0.4132/分**、720P $0.2066、1080P 30–60fps $0.8264、Pro ×10；「低于 720P 按 720P 计价」 | 未证实 | ❌ **仅 Johor，不支持 Singapore** |
| fal.ai `bytedance-upscaler`（转售） | ✅ `target_resolution` 到 8k / `scale_ratio` 1.1–10.0（≤4K） | ✅ `target_fps` 24–120 | ✅ | ✅ | ❌未证实 | ✅ `old_film` | ✅ `general`/`ugc`/**`short_series`**/**`aigc`**/**`old_film`** | fal.ai 队列异步 | 1080p@30fps **$0.0072/s ≈¥3.07/分**；@60fps ≈¥6.13；`pro` ×10 | 未证实 | ❌ 海外 |
| **Topaz Labs**（美国，唯一公开自助的第三方） | ✅ video upscaling | ✅ **video frame interpolation** | ✅ | ✅ | ❌未证实 | ✅ restore | — | REST 异步四步：`POST https://api.topazlabs.com/video/` → 轮询 | Developer **$50/mo = 500 credits（$0.10/credit）**；Scale $240/mo = 3000 credits（$0.08）；1 credit = 单请求、输出至多 2400 万像素 | 自助注册（「No credit card required」） | ❌ **无中国大陆节点** |
| **美图 AI 开放平台** | ✅（申请制，产品条目「视频超清 / 视频AI超清2.0 / Video Super Resolution」） | ❌未证实 | ✅（`v1/videoDenoise` 路由实测存在） | ✅（`v1/videoEnhance`） | ❌未证实 | ❌未证实 | — | 异步 + 轮询（有「异步任务查询/取消」） | ❌ **未公开**（注册→申请接口→价格确认→订单支付） | 申请制；`aigc@meitu.com` | ✅ |
| **百炼 Wan 模型**（已接入） | **无** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | — | — | — | — |

**❌ 明确「没有文件级超分/插帧 API」的厂商**：声网 Agora（媒体服务无画质增强产品；云端转码是 RTC→RTC）、即构 ZEGO + 网易云信（**只有 RTC 实时增强**，分别需「特殊编包」「技术支持开通」，无 HTTP API/任务 ID）、又拍云（`avopts` 参数全量枚举零命中）、UCloud（OpenAPI「视频服务」仅 ULive/URTC）、金山云（KS3 明说不做视频处理；KET 模板无超分；`Kshd`「集智高清」是编码开关、`aiproduction` 只是智能封面、`fr` 上限 30）、移动云、天翼云、京东云、商汤、相芯 FaceUnity、虹软 ArcSoft、海康威视、大华股份。联通云**未证实**（`cloud.wo.cn` 根路径 403 + 子路径全 502）。

**⚠️ 识别「伪超分」的 4 条经验（全行业通用）**：
1. 「**窄带高清 / 集智高清 / 极速高清**」是**编码压缩档位**，不是画质增强（金山云错误码甚至直接写「**禁止分辨率、码率小转大**」）。
2. 「**锐化**」在这些厂商的存储产品里**只存在于图片处理**（如 `image/sharpen,[50,399]`），与视频成片无关。
3. 「**超清 / 高清**」在转码模板里通常只是**分辨率档位名**。
4. **RTC 实时增强 ≠ 文件级超分**（即构、云信、声网、移动云均适用）。

### 7.2 libtv 场景成本沙盘：1 分钟 480p@30fps → 1080p@60fps

> 以下为基于**官方公开单价**的算术推演，非官方报价；实际以合同/控制台账单为准。

| 方案 | 组成 | 估算成本（元/分钟成片） |
|---|---|---|
| **火山引擎（最便宜）** | VOD/AI MediaKit 画质增强**标准版**，`short_series` 或 `aigc` 预设，输出 1080P + fps=60（自动插帧），**一个接口全含超分+插帧+降噪** | **3.0**（≤30fps 时仅 **1.5**）；极速版 0.8；资源包 4.5 折后 ≈ **1.35** |
| **百度智能云 MCP（次便宜）** | 智能超分 HD 0.9 + 智能插帧 HD 1.5 | **2.4** |
| **腾讯云 MPS（推荐主力）** | 超分(输出 FHD, 60 帧) 1.2 + 插帧(FHD, 60 帧) 2.7 + 普通转码 H.264 FHD 0.063 | **≈ 3.96** |
| 腾讯云 MPS（用官方「漫剧场景-大模型增强-1080P」预设 `Definition=327004`） | 大模型视频增强 FHD(≤60 帧) 5.8 + 极速高清转码 | **≈ 6.2**（开箱即用、针对漫剧优化） |
| 腾讯云 MPS（综合增强替代超分+插帧） | 综合增强(FHD,60) 3.6 + 转码 0.063 —— ⚠️ **综合增强不负责提分辨率**，若要 1080p 仍需叠加超分 1.2 | ≥ 4.9 |
| 腾讯云 MPS（大模型修复档，适合老片/低清） | 大模型视频修复(FHD,60) 11.2 + 转码 0.063 | ≈ 11.3 |
| 七牛云 | 超分普通版（普帧 1080p 及以下）0.8 —— ⚠️ **无补帧**，且 480p 2x=1708×960 拿不到精确 1080p；用 3x 跳 2K 档 1.6 | 0.8（普帧）/ 1.6（高帧，但无插帧能力） |
| **阿里云视觉智能（一次调用）** | `EnhanceVideoQuality`：480p 输入(≤720P) + 输出 60 帧 → 8 元/分 | **8.0** |
| **阿里云 IMS 音画增强（官方 AIGC 超分路径）** | 模板 `S00000004-401040`（720P→1080P）：0.003255 元/帧 × 输出帧数。**@25fps ≈4.88**、**@30fps ≈5.86** —— ⚠️ **不含插帧**，若要 60fps 需另调 `InterpolateVideoFrame`，且超分仍按输出总帧数计费（先超分后插帧可省一半） | 4.88~5.86（不含插帧） |
| 阿里云视觉智能（拆两个接口） | `SuperResolveVideo` 0.4（≤30 帧输出）+ `InterpolateVideoFrame` 6（≤720P 输入、60 帧输出） | 6.4 |
| 阿里云 MPS 超分（**注意按帧计费**） | 输出 1080p@30fps：1800 帧 × 0.003255 | ≈ 5.86（**若输出 60fps 则 ≈11.72**） |
| 华为云 MPC | 单价未证实，无法估算 | ❌ |
| BytePlus（海外） | Standard 1080P 30–60fps $0.8264/分 | ≈ ¥5.87 |
| fal.ai（海外转售） | 1080p@60fps：$0.0144/s × 60 | ≈ **6.2**（USD 计价，数据出境） |
| Topaz Labs（海外） | 按 credit 折算，且无大陆节点 | 未证实（量级：$0.08~0.12/credit） |

**结论**：
- **最省钱的合规路径是火山引擎（3 元/分钟，资源包折后 ≈1.35）**，其次是百度（2.4，但工单+仅北京+必须入 BOS）。
- **综合「价格 + 场景贴合度 + 资料完整度 + 合规 + 落地风险」最优是腾讯云 MPS**（≈3.96 元/分钟，且有官方「漫剧场景」预设、媒体质检/无参考评分闭环、页面日期齐全）。
- **阿里云 MPS 的超分按帧计费，在需要补帧到 60fps 时成本会翻倍，不划算**；阿里云更适合走视觉智能的 `EnhanceVideoQuality` 单接口通道（8 元/分钟）。
- **七牛、华为、声网/即构/云信/又拍/UCloud/金山/移动/天翼/京东 均不承担「超分 + 补帧」完整需求**。

---

## 8. 合规与工程注意点

### 8.1 AI 生成内容标识（强制，✅ 已抓原文）

**《人工智能生成合成内容标识办法》**（国信办通字〔2025〕2 号，国家网信办、工信部、公安部、广电总局，2025-03-07 印发）
来源：https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm ✅（页面日期 2025-03-14 17:00，发布日）

关键条款（原文）：
- **第三条**：「人工智能生成合成内容是指利用人工智能技术生成、合成的文本、图片、音频、视频、虚拟场景等信息。标识包括**显式标识**和**隐式标识**。」
- **第四条（四）**：「在**视频起始画面和视频播放周边的适当位置添加显著的提示标识**，可以在视频末尾和中间适当位置添加显著的提示标识」；「服务提供者提供生成合成内容**下载、复制、导出**等功能时，应当确保文件中含有满足要求的显式标识。」
- **第五条**：「应当在生成合成内容的**文件元数据中添加隐式标识**，隐式标识包含**生成合成内容属性信息、服务提供者名称或者编码、内容编号**等制作要素信息。**鼓励…添加数字水印等形式的隐式标识**。」
- **第九条**：用户申请无显式标识的生成合成内容，服务提供者可在用户协议明确标识义务后提供，**并依法留存提供对象信息等相关日志不少于六个月**。
- **第十条**：「任何组织和个人**不得恶意删除、篡改、伪造、隐匿**本办法规定的生成合成内容标识，**不得为他人实施上述恶意行为提供工具或者服务**。」
- **第十四条**：「本办法自 **2025 年 9 月 1 日**起施行。」

**《互联网信息服务深度合成管理规定》**（2023-01-10 施行）
来源：https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm ✅

- **第二十三条（五）**：深度合成技术「包括但不限于：…（五）图像生成、**图像增强、图像修复**等生成或者编辑图像、视频内容中**非生物特征**的技术」
  → **「视频超分 / 去噪 / 老片修复」这一动作本身即被明确纳入「深度合成技术」的定义范围。**
- **第十六条**：「深度合成服务提供者对使用其服务**生成或者编辑**的信息内容，应当采取技术措施**添加不影响用户使用的标识**，并…保存日志信息。」（即隐式标识）
- **第十七条**：提供可能导致公众混淆或误认的深度合成服务（枚举含「人脸生成、人脸替换、人脸操控、姿态操控等…显著改变个人身份特征的编辑服务」及兜底项「其他具有生成或者显著改变信息内容功能的服务」），「应当在生成或者编辑的信息内容的**合理位置、区域进行显著标识**」
- **第十八条**：不得采用技术手段删除、篡改、隐匿上述标识

#### 对本项目（libtv）的工程要求

1. **后处理链路必须「标识透传」**：超分/插帧服务会**重新编码并生成新文件**，极易丢掉原文件的元数据（隐式标识）与起始画面（显式标识）。**必须在上游生成时把 AI 生成标识写入，并在后处理输出上重新写入**（视频起始画面的显式"AI 生成"提示 + 文件元数据中的隐式标识），否则可能构成「隐匿标识」。
   - 已有可用的现成手段：腾讯云 VOD/MPS 有**数字水印模板**（`CreateBlindWatermarkTemplate`，基础版权数字水印 / AB 版权数字水印）与 `CreateWatermarkTemplate`（图片/文字水印，可设「出现时间」做动态水印）→ 可作为显式/隐式标识的落地组件。
   - 阿里云百炼 Wan 模型自带 `watermark` 参数（固定文案「AI 生成」），**但两个模型默认都是 `false`** → 需显式开启或自行叠加。
   - BytePlus VOD 文档站有 `metadata_for_ai_generated_content` 页面（⚠️ 正文未抓取），说明其产品层面也在处理该要求。
2. **不能把「去标识」当作卖点**：任何「去除 AI 水印」的功能都可能触碰第十条。
3. 深度合成服务提供者/技术支持者需按《互联网信息服务算法推荐管理规定》履行**算法备案**（第十九条）；具有舆论属性或社会动员能力的需**安全评估**（第二十条）。
4. 若涉及网络视听节目服务，还需同时符合广电主管部门规定（第二十四条）。

### 8.2 数据出境

**《促进和规范数据跨境流动规定》**（国家网信办令第 16 号，2024-03-22 公布施行）
来源：https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm ✅（页面日期 2024-03-22 20:06）

- **第五条（四）**：关键信息基础设施运营者以外的数据处理者，自当年 1 月 1 日起**累计向境外提供不满 10 万人个人信息**（不含敏感个人信息）的，**免予**申报数据出境安全评估、订立标准合同、认证
- **第八条**：10 万人以上不满 100 万人（不含敏感）或不满 1 万人敏感个人信息的，应当订立**个人信息出境标准合同**或通过**个人信息保护认证**
- **第七条**：向境外提供重要数据、或 100 万人以上个人信息 / 1 万人以上敏感个人信息的，应申报**数据出境安全评估**（有效期 3 年）
- **第三条**：不包含个人信息或重要数据的跨境活动数据，免予上述手续

**对本项目的影响**：
- 如果 libtv 成片**不含人脸等生物识别信息且不涉及个人信息**，走**海外超分服务（如 fal.ai / BytePlus 国际站）**在数据出境层面风险相对可控（第三条），但**判定需谨慎**：短剧/漫剧成片常含真人面孔或可识别个人形象。
- 更稳妥的默认选择：**优先使用中国大陆节点 + 境内云厂商**（腾讯云 MPS 中国大陆、阿里云华东 2 上海）。
- **推荐做法**：`libtv` 把「清晰化」做成**可切换的 provider**，默认境内；海外 provider 仅在合规评估通过后按需开启，并在界面上明示数据处理地域。

### 8.3 存储合规与「S3 预签名 URL 直取直存」（回应关键工程问题）

| 厂商 | 输入是否支持外部 URL 直取 | 输出是否可直存第三方存储 |
|---|---|---|
| **阿里云 视觉智能 videoenhan** | ✅ `VideoURL` 支持公网 http/https URL（**URL 不能含中文字符**）；官方推荐上海地域 OSS | ❌ 输出为**临时 URL，仅 30 分钟有效**，必须自行转存到自己的 OSS/存储 |
| **阿里云 MPS / IMS** | ✅ 需先上传 OSS（分辨率倍增文档明确「将需要处理的视频上传至 OSS」）；MPS 需绑定输入/输出 Bucket | ❌ 输出写回绑定的 OSS Bucket；未见支持写入第三方 S3 的官方说明 |
| **腾讯云 MPS** | ✅ `MediaInputInfo.Type = URL` 支持 URL 源；**另有 `AWS-S3` 源，但官方注明「目前只支持转码任务」** | ❌ `TaskOutputStorage` 示例为 `{Type: COS, CosOutputStorage:{...}}`；**当 `InputInfo.Type` 为 URL 时 `OutputStorage` 必填** → 输出必须落 COS |
| **腾讯云 VOD** | 走 VOD 媒资，需先上传或 URL 拉取 | 落 VOD/COS |
| **BytePlus / fal.ai** | ✅ `video_url` 直接给 URL（fal.ai 支持 data URI / hosted URL / 上传） | ✅ 结果返回一个可下载的 URL（fal.ai 托管） |

**结论（针对 libtv 的天翼云 ZOS，S3 兼容）**：
1. **「直取」可行**：三家的输入侧都支持公网 URL。天翼云 ZOS 的 **S3 预签名 URL** 只要公网可访问，就可作为输入直接传给厂商（阿里云视觉智能的 `VideoURL`、腾讯云 MPS 的 `InputInfo.Type=URL`）。
2. **「直存」不可行**：**没有任何一家支持把处理结果直接写回天翼云 ZOS**。输出必须落到该厂商自己的对象存储（阿里云 OSS / 腾讯云 COS / 火山 TOS），然后由 libtv 主动下载再回传 ZOS。
3. **腾讯云是唯一在文档中提及「AWS-S3 源」的厂商**，但限制为「目前只支持转码任务」，**增强任务是否适用需实测（❌ 未证实）**。
4. **工程建议**：设计成「下载 → 处理 → 下载 → 回传 ZOS」的两段式中转，并注意阿里云视觉智能**输出 URL 仅 30 分钟有效**，必须立刻拉取。

### 8.4 处理耗时（1 分钟 480p 做 3x 超分 + 插帧大约多久）

**官方明确口径很少，如实标注：**

| 来源 | 官方表述 | 可信度 |
|---|---|---|
| **火山引擎 VOD 画质增强** ⭐**唯一给出官方耗时口径的厂商** | **RTF（Real-Time Factor）**：极速版约 **3~4**（不涉及分片）；标准版约 **6~10**（源视频时长 >20 秒）；源视频 ≤20 秒约 **22**；专业版 Medium 约 **25**（输出 ≤1080P）；专业版 Ultimate 约 **60**（输出 ≥4K） | ✅ 官方文档 docs/4/1578688（UpdatedTime 2026-09-01） |
| 阿里云 MPS 分辨率倍增 | 「**分辨率倍增转码速度较慢，建议使用 3 分钟以内的短视频测试**」 | ✅ 官方文档，但**只给定性描述，未给倍速** |
| 阿里云 视觉智能 videoenhan | 三类能力均为「异步能力，需分两步调用」，要求轮询 `GetAsyncJobResult`；**未公布处理时长或 SLA** | ✅ 官方确认异步，❌ 耗时未证实 |
| 腾讯云 MPS | 增强基于转码实现；`TaskType` 提供 **`Offline`（闲时任务，不保证实效性，默认 3 天内处理完）** 与 `Online`（实时任务）；**增强能力本身耗时未公布** | ✅ 官方确认存在闲时档，❌ 耗时未证实 |
| 百度 MCP / 华为 MPC | 均为异步（创建任务 → 轮询 jobId / task），**未公布耗时** | ✅ 异步确认，❌ 耗时未证实 |
| BytePlus / fal.ai | fal.ai 侧为队列异步；`enhancement_tier=pro` 官方注明「**longer processing time**」；**未给出具体秒数** | ✅ pro 更慢，❌ 耗时未证实 |

**⏱️ 按火山官方 RTF 外推（本项目最关心的数字）**：
- **1 分钟 480p 成片 + 3x 超分到 1080p + 插帧到 60fps**：
  - 极速版（RTF 3~4）→ **约 3~4 分钟**
  - 标准版（RTF 6~10）→ **约 6~10 分钟**
  - 专业版 Medium（RTF 25）→ **约 25 分钟**
  - 专业版 Ultimate（RTF 60，仅 ≥4K）→ 约 60 分钟
- 注意：「3x 超分」在火山侧不是参数（火山用 `Target.Res`/`ResLimit` 指定**目标输出分辨率**，480p→1080p 即 2.25 倍），因此上表就是 libtv 的目标形态耗时。
- ⚠️ 以上是**火山一家的官方口径**；腾讯/阿里/百度/华为的同类耗时**均未公布**，不可套用。落地前**必须自测**（见下）。

❌ **结论：「1 分钟 480p 视频做 3x 超分 + 插帧大约多久」——除火山外官方文档查不到可靠数字；火山口径为 RTF 3~4（极速版）/ 6~10（标准版）。**

工程上可执行的做法：
- 必须按**异步任务 + 轮询/回调**设计（所有厂商都是异步），并在 libtv 侧设置**独立的超时预算与重试**（现有 `server/internal/llm/video.go` 已有 `ErrVideoPollTimeout` / `pollBudgetText()` 模式，可复用）。
- **先自测建立基线**：拿 3 条 1 分钟 480p 成片，分别跑「腾讯云 MPS 漫剧预设 327004」「火山 AI MediaKit `scene=short_series`+`resolution=1080p`+`fps=60`」「阿里云 `EnhanceVideoQuality`」，记录端到端耗时（含上传 + 处理 + 下载转存），再决定是否用「闲时任务 / Offline」降本。
- **不要按实时（1x）预估**：即使最快档位也在 3~4 倍时长量级。

---

## 8.5 让现有聚合网关「上架超分模型」的可行性判断

**背景（父任务已实测）**：华数 `token.wasu.cn` 的 `/v1/models` 返回 **74 个模型**、电信 `ai.ctaigw.cn` 返回 **11 个模型**，**均无任何超分/增强/插帧模型**。

**判断：这条路短期内不可作为主方案，但值得并行推动。理由如下。**

1. **能力性质不匹配网关的现有协议形态。**
   两个网关现在承载的是**生成式模型**（Seedance / Wan / 豆包等），形态统一为「提交 prompt + 参考素材 → 异步任务 → 轮询取 URL」。而超分/插帧的输入是**一个已有的成片文件**，输出是**同内容的高分辨率/高帧率版本**——语义上属于「媒体处理」而非「生成」，需要网关新增一类「文件转码/增强」路由与计费维度（按分钟/按帧，而非按 token 或按次）。**这是一次协议扩展，不是加一个 model id 就能完成的事。**
2. **没有现成可「上架」的超分模型可挂。**
   转售的前提是上游有该能力。华数/电信作为聚合方，需要其上游（阿里云百炼、火山方舟等）**已经开出超分 API**。目前查证结果：
   - **阿里云百炼（DashScope）上没有超分/画质增强的多模态视频模型**——已接入的 `wan2.7-videoedit`（视频编辑）与 `wan3.0-video`/`wan3.0-video-prime`（视频生成）**均无超分/增强/插帧能力**（§1.5 逐字核实，关键词命中 0 次）。百炼的视频 API 家族（`wan-api-reference` 下：text-to-video / image-to-video / wan-video-editing / wan-video-to-video / wan-animate / wan-s2v / legacy-video-models / happyhorse-video-edit）**没有「video-enhance」类目**。
   - 阿里云的超分能力在**另外两条产品线**（视觉智能开放平台 videoenhan、IMS/MPS 音画增强），**不在百炼**。
   - 火山引擎的超分能力在 **VOD 画质增强 / AI MediaKit**，也**不在方舟（Ark）大模型平台**。
   → **结论：超分能力在国内主流大模型平台上普遍"缺席"，聚合网关很难通过"转售一个大模型"的方式上架。**
3. **因此现实路径是三条，按推荐度排序**：
   - **(a) 自己直连**（推荐）：libtv 后端直接对接腾讯云 MPS / 火山 AI MediaKit / 阿里云视觉智能，把「清晰化」做成一个独立的 provider（与现有的视频生成 provider 并列）。这是唯一**现在就能落地**的方案。
   - **(b) 请渠道方做「媒体处理 API」转售**（中期）：向华数/电信提出需求——不是「上架一个模型」，而是**在网关侧新增一类「媒体处理/画质增强」能力**，由渠道方去对接上游云厂商的媒体处理产品线。可行，但需商务谈判 + 协议扩展，周期以月计；**当前无法证实任何一家渠道方有此计划**。
   - **(c) 换渠道**：找已经同时提供「生成 + 增强」的中间商（例如 fal.ai 这类聚合平台已同时有 Seedance/Wan 生成模型与 `bytedance-upscaler` 增强模型）。**但 fal.ai 无中国大陆节点，数据出境风险明确**。
4. **给渠道方的具体提问清单（可直接发给华数/电信商务）**：
   - 网关是否支持「输入为一个已有的视频 URL、输出为增强后视频 URL」的非生成式调用？
   - 是否按「输出分钟数 × 分辨率 × 帧率」计费，而不是按 token / 按次？
   - 能否对接腾讯云 MPS 音视频增强、火山 VOD 画质增强、或阿里云视觉智能 videoenhan？
   - 是否具备 AI 生成内容标识（显式 + 隐式元数据）的透传能力？（见 §8.1）

---

## 9. 未证实清单（明确列出查不到 / 需实测的项）

1. ❌ **阿里云视觉智能平台「视频SDR调色」「SDR转HDR」「视频降噪」三个独立 API**：产品页宣传存在，但 `videoenhan`(2020-03-20) 与 `viapi`(2023-01-17) 的官方 OpenAPI 元数据中**无对应操作**。
2. ⚠️ **阿里云 MPS「新版本超分预置模板」的 ID 部分解决**：MPS 侧 `preset-templates` 页只列了「旧版本」的 `S00000001-400040`(MP4-SDToHD) / `S00000001-400070`(MP4-2KTo4K)；**IMS 音画增强侧的 SR5 预置模板 `S00000004-401040` / `S00000004-401070` 已由官方 AIGC 教程页证实**（见 §1.3.2）。但 MPS 侧「新版本」模板 ID 仍未找到。另：IMS 文档同时说「放大倍率 2 倍」与「支持 2 倍和 3 倍超分放大」，**两者关系未证实**，落地前需按官方建议「先用一小段片源试跑」。
3. ❌ **阿里云 IMS 音画增强中「多帧降噪 / 去压缩失真 / 色彩与对比度增强」是否单独收费**：公开计费页只单列了超分 / HDR / 音频增强。
4. ❌ **阿里云视觉智能平台的「企业认证/备案」前置要求**：官方文档只写了「开通视频生产服务」+ AccessKey + RAM 授权，未提企业认证。
5. ❌ **腾讯云 MPS `ProcessMedia` 的文件大小 / 时长上限**：文档正文未给出统一上限。
6. ❌ **腾讯云 `AWS-S3` 输入源是否可用于「增强」任务**：文档只写「目前只支持转码任务」，增强依附转码管线但未明示覆盖。
7. ❌ **腾讯云 `EnhanceMediaQuality`（VOD 音画质重生）的完整入参与计价细则**：接口存在于 VOD API 导航，但未出现在我抓到的 VOD 元数据快照中。
8. ❌ **BytePlus VOD vCube 的官方直客单价表（USD）**：文档正文 JS 渲染，仅抓到导航；`#video-enhancement-pricing` 锚点存在但内容未取到。
9. ❌ ~~火山引擎国内侧是否存在对应能力~~ → **✅ 已证实存在**（VOD 画质增强 / AI MediaKit，见 §3）。但以下仍未证实：
   - **`StartExecution` 的 `Version` 官方自相矛盾**：API 参考 docs/4/1477169 用 `2023-07-01`，任务指南 docs/4/2624029 用 `2025-01-01` → **需双版本可配 + API Explorer 实测**
   - **VOD「自定义画质增强」（超分 8 元/分钟）能否新开**：官方两页矛盾（docs/4/1578688 说"不再支持创建新的自定义增强模板"，docs/4/117971 仍列出该预设）
   - **BytePlus `vod20250701` Go SDK 的 `VideoStrategy` 缺 `EnhanceLevel` 字段**（文档有）→ **直接影响 libtv 的 Go 实现**
   - **AI MediaKit 画质增强的免费额度**：7 篇文档全文未检索到明文
   - 火山官方**预置 TemplateId 未发布**（VOD 侧须控制台自建）；`RepairStrength` 上限未证实；工作流 `Activity.Type` 完整枚举仅见 SDK 注释
   - 火山定价站 `/pricing` 抓不到（SPA，`GetPrice` 匿名返回 `UnauthorizedAccess`）；BytePlus `/en/pricing/vod` 等**实测 404，不可引用**
10. ❌ ~~百度/华为~~ → **✅ 两家均已证实有 API**（见 §4）。但：
   - **华为云 MPC 视频增强的单价与计价方式未证实**（定价页 `pricing.html#/mpc` 是 JS SPA、HTML 无价格；计费说明文档页未定位，`productdesc-mpc/mpc030004.html` 为 404）。**未引用任何二手价格**
   - **百度 MCP 白名单工单的实际审批周期未证实**（工期风险点）
   - 华为 AI Gallery 的**具体超分模型未证实**（全 JS 渲染、无 JSON API；且属 ModelArts 自建推理，非现成 API）
11. ❌ ~~RTC/CDN 类~~ → **✅ 已逐家证实**（见 §5）：**10 家里只有七牛云有文件级超分**，**补帧一家都没有**。仍未证实：七牛的 **URL 直传**（pfop 只吃 bucket+key，倾向不支持）、aifast 单独单价、实名/白名单前置要求；**联通云**（`cloud.wo.cn` 根路径 403 + 子路径全 502，抓不到任何官方文档）。
12. ❌ ~~垂直厂商~~ → **✅ 已逐家证实**（见 §6）：**国内无一家公开自助的视频超分 API**。仍未证实：美图「视频超清」的接口参数与单价（文档正文需登录，未登录访问任一 `/doc/?id=NNN` 均返回相同的 504,882 字节 SPA 壳）、牛学长/HitPaw 的「视频分辨率提升 API」、微帧「帧彩视界」超分端点、影谱（官网域名在本机无法解析）、中科视语（官网域名已失效）、商汤 SenseFoundry「算法商城」是否上架超分算法。
12b. ❌ **各厂商「1 分钟 480p 做 3x 超分 + 插帧」的实际处理耗时**：**除火山外官方均未公布。火山有官方 RTF 口径**（见 §3，极速版 RTF 3~4、标准版 6~10、专业版 25/60）→ **这是目前唯一可用的官方耗时口径**。腾讯/阿里/百度均未公布。
12c. ❌ **阿里云 IMS 转码模板页「短剧 / 教育 / UGC / 电商 / 高清影视 / 通用」六种转码场景是否可作为超分预设**：文档中它们是**转码场景（码率/画质平衡策略）**，不是超分场景预设；阿里云**未发现**类似火山 `short_series` / 腾讯 `ai_comic` 的超分场景预设。
12d. ❌ **「窄带高清」「极速高清」类能力是否含 AI 超分**：已核实为**编码压缩档位，不是超分**（见 §7.1 的「伪超分」4 条经验）。
13. ❌ **各厂商「1 分钟 480p 做 3x 超分 + 插帧」的实际处理耗时**：官方均未公布可靠数字。
14. ❌ **各厂商输出结果是否可直存第三方 S3 兼容存储（天翼云 ZOS）**：未见任何厂商支持，但也未见明确否定的官方表述。
15. ❌ **阿里云 IMS 音画增强是否有「短剧 / 动漫」类超分预设、是否有内置补帧**：**已证实为「无内置补帧」**（音画增强六种类型中无插帧）；**超分预设方面未发现**类似「短剧/动漫」的场景预设，文档中「短剧」仅为转码场景。
16. ❌ **阿里云页面日期**：帮助中心多数页面的「更新时间」由 JS 注入，SSR 输出为空 → 页面日期未知（腾讯云页面日期已逐页标注）。

---

## 10. 来源清单（全部为本次实际抓取的 URL）

### 阿里云
| # | 内容 | URL | 可信度 / 页面日期 |
|---|---|---|---|
| 1 | 视觉智能 · 视频生产产品页（能力清单） | https://vision.aliyun.com/videoenhan | ✅ 官方页 / 日期未知 |
| 2 | videoenhan OpenAPI 元数据（16 个 API 全参数） | https://api.aliyun.com/meta/v1/products/videoenhan/versions/2020-03-20/api-docs.json | ✅ 官方元数据 / version 2020-03-20 |
| 3 | 视频生产计费介绍（全量单价表） | https://help.aliyun.com/document_detail/202487.html | ✅ 官方文档 / 日期未知 |
| 4 | 查询异步任务结果 GetAsyncJobResult | https://help.aliyun.com/document_detail/607824.html | ✅ 官方文档 / 日期未知 |
| 5 | 文件 URL 处理（地域、OSS 要求） | https://help.aliyun.com/document_detail/155645.html | ✅ 官方文档 / 日期未知 |
| 6 | MPS 音视频增强费用（超分按帧定价） | https://help.aliyun.com/zh/mps/product-overview/audio-and-video-enhancement-fees | ✅ 官方定价页 / 日期未知 |
| 7 | MPS 创建分辨率倍增任务（SubmitJobs 用法） | https://help.aliyun.com/zh/mps/create-a-resolution-redoubling-transcoding-job | ✅ 官方文档 / 日期未知 |
| 8 | MPS 预置模板（超分模板 ID） | https://help.aliyun.com/zh/mps/preset-templates | ✅ 官方文档 / 日期未知 |
| 9 | IMS 转码模板（音画增强六种类型，含 2x/3x 超分） | https://help.aliyun.com/zh/ims/user-guide/transcoding-template | ✅ 官方文档 / 日期未知 |
| 10 | ICE OpenAPI 元数据（399 API，TransTemplateType=UHD） | https://api.aliyun.com/meta/v1/products/ICE/versions/2020-11-09/api-docs.json | ✅ 官方元数据 / version 2020-11-09 |
| 11 | ICE API 目录 | https://help.aliyun.com/zh/ims/developer-reference/api-ice-2020-11-09-dir/ | ✅ 更新时间 2026-01-14 13:59:51 |
| 12 | Mts(媒体处理) OpenAPI 元数据（97 API，IProductionJob 枚举） | https://api.aliyun.com/meta/v1/products/Mts/versions/2014-06-18/api-docs.json | ✅ 官方元数据 / version 2014-06-18 |
| 13 | VOD OpenAPI 元数据（188 API，无超分接口） | https://api.aliyun.com/meta/v1/products/vod/versions/2017-03-21/api-docs.json | ✅ 官方元数据 / version 2017-03-21 |
| 14 | 百炼 万相3.0-视频生成 API（wan3.0-video / -prime / resolution） | https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference/ | ✅ 官方文档 / 日期未知 |
| 15 | 百炼 万相2.7-视频编辑 API（wan2.7-videoedit） | https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference/ | ✅ 官方文档 / 日期未知 |
| 16 | 阿里云产品与版本索引 | https://api.aliyun.com/meta/v1/products.json | ✅ 官方元数据 |

### 腾讯云
| # | 内容 | URL | 可信度 / 最近更新时间 |
|---|---|---|---|
| 17 | 发起媒体处理 ProcessMedia | https://cloud.tencent.com/document/api/862/37578 | ✅ 2026-09-11 02:35:04 |
| 18 | MPS API 概览（全部接口名） | https://cloud.tencent.com/document/api/862/37569 | ✅ 2026-09-08 03:20:48 |
| 19 | MPS 数据结构（EnhanceConfig/VideoEnhanceConfig/EnhanceSceneType/SuperResolutionConfig/MediaInputInfo） | https://cloud.tencent.com/document/api/862/37615 | ✅ 2026-09-29 02:38:58 |
| 20 | MPS 按量计费（全量增强单价表） | https://cloud.tencent.com/document/product/862/36180 | ✅ 2026-09-24 11:44:31 |
| 21 | 画质提升场景（能力说明 + 质检闭环） | https://cloud.tencent.com/document/product/862/116764 | ✅ 2025-03-11 16:34:52 |
| 22 | 转码增强模板相关接口 | https://cloud.tencent.com/document/api/862/116017 | ✅ |
| 23 | MPS 产品文档首页 | https://cloud.tencent.com/document/product/862 | ✅ |
| 24 | VOD 数据结构（EnhanceConfig/EnhanceMediaQualityOutputConfig） | https://cloud.tencent.com/document/api/266/31773 | ✅ 2026-09-24 03:24:34 |
| 25 | VOD 媒体处理相关接口（含「音画质重生」） | https://cloud.tencent.com/document/api/266/33425 | ✅ |
| 26 | VOD 音画质重生 | https://cloud.tencent.com/document/api/266/102571 | ✅ 导航确认 |

### 火山引擎 / BytePlus / fal.ai
| # | 内容 | URL | 可信度 / 日期 |
|---|---|---|---|
| 27 | fal.ai 模型页（schema + 定价原文，注明 BytePlus VOD） | https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api | ✅ 官方页 / 模型日期 2025-10-31 |
| 28 | fal.ai 模型页（另一入口） | https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video | ✅ 官方页 |
| 29 | BytePlus VOD 按量计费（导航含 vCube + #video-enhancement-pricing） | https://docs.byteplus.com/en/docs/byteplus-vod/docs-pay-as-you-go-pricing | ⚠️ 仅导航可见 |
| 30 | BytePlus VOD vCube 能力页 | https://docs.byteplus.com/en/docs/byteplus-vod/docs-video-enhancement | ⚠️ 仅导航可见 |
| 31 | **火山文档站公开 JSON API（关键突破）** | `https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<id>&type=doc`（读 `Result.MDContent`）；检索 `.../api/search/openSearchNew?Query=`；列库 `.../api/doc/getDocList?LibraryID=` | ✅ 无需登录 |
| 32 | 火山 VOD 画质增强修复模板（能力+场景预设） | https://www.volcengine.com/docs/4/117971 | ✅ UpdatedTime 2026-09-07 |
| 33 | 火山 VOD 媒体处理计费（全量单价表） | https://www.volcengine.com/docs/4/1941013 | ✅ UpdatedTime 2026-09-15 |
| 34 | 火山画质增强档位/强度/色深/RTF | https://www.volcengine.com/docs/4/1578688 | ✅ UpdatedTime 2026-09-01 |
| 35 | 火山 StartExecution 任务指南（含 AIGC 超分示例） | https://www.volcengine.com/docs/4/2624029 | ✅ UpdatedTime 2026-09-01 |
| 36 | 火山 GetExecution 参考（枚举值） | https://www.volcengine.com/docs/4/1582325 | ✅ UpdatedTime 2026-09-18 |
| 37 | 火山 StartExecution API 参考（`Version` 冲突） | https://www.volcengine.com/docs/4/1477169 | ✅ Updated 2026-08-28 |
| 38 | 火山 VQScore 无参考画质评分 | https://www.volcengine.com/docs/4/337732 | ✅ UpdatedTime 2026-09-15 |
| 39 | 火山 VOD 免费额度（明列不可抵扣画质增强） | https://www.volcengine.com/docs/4/76544 | ✅ UpdatedTime 2026-09-15 |
| 40 | 火山资源包（可抵扣场景式画质增强） | https://www.volcengine.com/docs/4/76544 | ✅ |
| 41 | 火山帧率档位调整公告（2026-07-01 起 3 档） | https://www.volcengine.com/docs/4/2552696 | ✅ UpdatedTime 2026-06-26 |
| 42 | 火山 AI MediaKit 画质增强接口 | https://www.volcengine.com/docs/6448/2279230 | ✅ |
| 43 | 火山 AI MediaKit 视频工具计费 | https://www.volcengine.com/docs/6448/2486473 | ✅ UpdatedTime 2026-09-24 |
| 44 | 火山 AI MediaKit 视频插帧接口 | https://www.volcengine.com/docs/6448/2624391 | ✅ UpdatedTime 2026-08-06 |
| 45 | BytePlus VOD 官方 USD 价表（vCube） | https://www.byteplus.com/docs/byteplus-vod/7848 | ✅ 2026-07-07 |
| 46 | BytePlus VOD 按量计费（导航含 vCube） | https://docs.byteplus.com/en/docs/byteplus-vod/docs-pay-as-you-go-pricing | ⚠️ 仅导航可见 |
| 47 | **腾讯云 音视频增强接入（预设模板 ID 表，含漫剧场景）** | https://cloud.tencent.com/document/product/862/118703 | ✅ 最近更新 2026-09-30 |
| 47b | **腾讯云数据万象 CI 画质增强（第二条产品线）** | https://cloud.tencent.com/document/product/460/58120 | ✅ 最近更新 2026-06-05 |
| 47c | ⭐ **阿里云 用音画增强为 AIGC 生成视频超分增强（官方实践教程）** | https://help.aliyun.com/zh/ims/use-cases/enhance-aigc-generated-videos-with-audio-visual-super-resolution | ✅ 官方文档（主调研员已独立复核） |
| 47d | 阿里云 百炼 VideoRetalk（0.08 元/秒，属口型替换，非超分） | https://help.aliyun.com/zh/model-studio/videoretalk-api | ✅ |
| 47e | RunningHub RH 视频超分 / 补帧 / Topaz 系列（境内聚合，单价未证实） | `https://www.runninghub.cn/openapi/v2/rhart-video/video-upscaler` | ⚠️ 单价未证实 |

### 百度 / 华为 / 七牛 / 垂直厂商
| # | 内容 | URL | 可信度 |
|---|---|---|---|
| 48 | 百度智能云 音视频处理 MCP 文档（智感超清 / superResolution / frameInterpolate） | https://cloud.baidu.com/doc/MCT/ | ✅ 官方文档 |
| 49 | 百度 计费项页（智能超分 0.9 / 插帧 1.5 / 老片修复 6.0 元/分钟） | 百度智能云计费项页 | ✅ 更新时间 2024-11-25 |
| 50 | 华为云 MPC 成长地图 | https://support.huaweicloud.com/mpc/index.html | ✅（经 `web_fetch`；curl 被 EdgeOne 拦截） |
| 51 | 华为云 MPC 视频增强 API（取自官方 SDK `huaweicloudsdkmpc==3.1.216`） | PyPI `huaweicloudsdkmpc` | ✅ 官方 SDK 源码 |
| 52 | 七牛云 视频超分 fop | https://developer.qiniu.com/dora/12508/video%20super%20resolution | ✅ 2024-08-15 |
| 53 | 七牛云 倍速超分 aifast | https://developer.qiniu.com/dora/12825/aifast | ✅ 2024-11-01 |
| 54 | 七牛云 视频色彩增强 SDR→HDR | https://developer.qiniu.com/dora/12665/VideoColorEnhancement | ✅ 2024-03-29 |
| 55 | 七牛云 按量计费（超分 0.8 元/分钟起） | https://developer.qiniu.com/dora/12730/volumetric-billing | ✅ 2024-08-28 |
| 56 | 七牛云 持久化处理 pfop / 状态查询 | https://developer.qiniu.com/dora/1291/persistent-data-processing-pfop | ✅ 2025-05-16 |
| 57 | 又拍云 异步音视频处理 avopts（全参数枚举，零命中） | https://help.upyun.com/knowledge-base/av/ | ✅ |
| 58 | UCloud OpenAPI 索引（视频服务仅 ULive/URTC） | https://docs.ucloud.cn/api/README.md | ✅ |
| 59 | 即构 ZEGO 视频超分（RTC 实时，非文件级） | https://doc-zh.zego.im/real-time-video-android-java/video/super-resolution | ✅ |
| 60 | 网易云信 超分（RTC 实时，需技术支持开通） | https://doc.yunxin.163.com/nertc/guide/zYzMjc0NTA?platform=android | ✅ 2025-06-11 |
| 61 | 美图 AI 开放平台文档（243 条菜单，含「视频超清」） | https://ai.meitu.com/doc | ✅ 菜单 SSR 可见（正文需登录） |
| 62 | 美图 API 网关基址（实测路由探测） | `https://openapi.mtlab.meitu.com/v1/{superResolution,videoEnhance,videoDenoise}` | ✅ 路由存在（无授权 `GATEWAY_AUTHORIZED_ERROR`） |
| 63 | Topaz Labs API 落地页与定价 | https://www.topazlabs.com/api | ✅ |
| 64 | Topaz Labs 开发者文档（视频异步四步） | https://developer.topazlabs.com/getting-started/video-quickstart.md | ✅ GitBook（可加 `.md` 取原文） |
| 65 | 商汤官网产品体系 | https://www.sensetime.com/cn/ | ✅ |
| 66 | MMagic（Apache-2.0 开源，含 VSR/插帧算法，可商用自建兜底） | https://raw.githubusercontent.com/open-mmlab/mmagic/main/README.md | ✅ |
| 67 | ⚠️ 天翼云「超分」唯一命中实为**社区用户投稿**（不可作能力依据） | https://www.ctyun.cn/developer/article/797889601941573 | ❌ 二手（页脚声明"实名用户自发贡献"） |

### 子代理完整报告（同仓库）
- `docs/research/parts/volcengine.md`（969 行 / 136 条来源 URL）
- `docs/research/parts/baidu-huawei.md`（426 行）
- `docs/research/parts/rtc-cdn.md`（611 行 / 75 条来源 URL）+ `rtc-cdn-optional.md`（554 行）
- `docs/research/parts/vertical.md`（382 行）

### 法规
| # | 内容 | URL | 可信度 / 日期 |
|---|---|---|---|
| 32 | 人工智能生成合成内容标识办法 | https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm | ✅ 官方原文 / 2025-03-14 |
| 33 | 互联网信息服务深度合成管理规定 | https://www.cac.gov.cn/2022-12/11/c_1672221949354811.htm | ✅ 官方原文 / 2022-12-11 |
| 34 | 促进和规范数据跨境流动规定 | https://www.cac.gov.cn/2024-03/22/c_1712776611775634.htm | ✅ 官方原文 / 2024-03-22 |
| 35 | 华为云 MPC 成长地图（可抓，供后续核实） | https://support.huaweicloud.com/mpc/index.html | ✅ 官方页 |

---

## 11. 给 libtv 的落地建议（基于以上已证实事实）

### 11.1 主力方案：腾讯云 MPS（推荐）

- 创建 `TranscodeTemplate`，或**直接用官方预置模板 `Definition=327004`（漫剧场景-大模型增强-1080P）**——官方提示「建议优先使用预设模板」；
- 若自行配置：`VideoEnhanceConfig` 配 `SuperResolutionConfig{Switch:ON, Type:lq, Size:2}` + 转码模板 `Width/Height` 定到 1920×1080；补帧用 `FrameRateWithDen`（新，支持分数）把 30→60；
- 注意**互斥约束**：超分 / 降噪**不能**与 `DiffusionEnhance`（大模型增强）、`AiRestoration`（大模型修复）同时开启；`ImageQualityEnhance` / `ArtifactRepair` / 大模型三者**最多选一**；
- 输入用 `MediaInputInfo.Type=URL` 传天翼云 ZOS 预签名 URL，`OutputStorage` 指向 COS；
- 成本基线 ≈ **3.96 元/分钟成片**（超分 1.2 + 插帧 2.7 + 转码 0.063）；用漫剧预设 ≈ 6.2 元/分钟。

### 11.2 降本方案：火山引擎（单价最低）

- **起步用 AI MediaKit**（`POST /api/v1/tools/enhance-video`，Bearer 鉴权、支持 `vod://`/公网 URL、免手工签名，**Go 工程量最小**）：`scene=short_series`（或 `aigc`）+ `resolution=1080p` + `fps=60`（**自动启用智能插帧**）→ **3 元/分钟**；
- 用量上来后切 **VOD 场景式画质增强**（资源包 12 个月最低 **4.5 折** → 等效 ≈1.35 元/分钟）；注意 VOD 的 `StartExecution` **不在官方 Go SDK 内需手工签名**，且 `Version` 官方自相矛盾（`2023-07-01` vs `2025-01-01`）→ **双版本可配 + API Explorer 实测**；
- 前后各跑一次 **VQScore**（0.1 元/分钟）做验收门禁。

### 11.3 需要「3 倍超分」或「单接口快速接入」时：阿里云

- 只需「超分+插帧」且要最少代码：**`EnhanceVideoQuality`**（一个接口全含，8 元/分钟），注意**输出 URL 仅 30 分钟有效**必须立即转存；
- 需要 **2x/3x 精确倍率**：**阿里云 IMS 音画增强**（唯一明确支持 3 倍）→ 需**先提工单开通**；插帧要另用视觉智能 `InterpolateVideoFrame`（跨产品组合；且 MPS 超分**按帧计费**，补帧到 60fps 会让超分费用翻倍）。

### 11.4 不要做的事

- ❌ **不要用 `wan2.7-videoedit` / `wan3.0-video` 做清晰化**：它们是生成/编辑模型，会重绘画面，破坏角色与画风一致性（§1.5）。
- ❌ **不要把「窄带高清/极速高清/集智高清」当超分**（§7.1 伪超分 4 条经验）。
- ❌ **不要指望华数/电信聚合网关短期内提供超分能力**（§8.5），应自建 provider。

### 11.5 工程与合规基线

1. **两段式中转**：下载 → 处理 → 下载 → 回传 ZOS（无厂商支持直存第三方 S3，见 §8.3）；阿里云视觉智能输出 URL **仅 30 分钟有效**，火山 AI MediaKit 默认 **24 小时**。
2. **幂等与去重**：腾讯云用 `SessionId`（三天内相同识别码会报错去重）；火山用 `client_token`；阿里云视觉智能「同一任务未处理完不要重复提交」。
3. **provider 抽象**：把「清晰化」做成独立 provider（与现有视频生成 provider 并列），默认境内节点，海外 provider（BytePlus / fal.ai / Topaz）需单独做数据出境评估。
4. **合规**：处理后输出**必须重新写入 AI 生成显式标识（起始画面）+ 隐式标识（元数据/数字水印）**——腾讯云 `CreateWatermarkTemplate` / `CreateBlindWatermarkTemplate` 可作为落地组件；阿里云百炼 Wan 的 `watermark` 参数**默认 false**，需显式开启或自行叠加（§8.1）。
5. **验收**：优先用腾讯云**媒体质检 + 无参考评分**或火山 **VQScore**（0.1 元/分钟）做处理后画质回归。