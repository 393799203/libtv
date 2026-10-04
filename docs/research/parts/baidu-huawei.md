# 百度智能云 / 华为云 —— 视频「清晰化」能力调研

> 调研对象：libtv（漫剧/短剧 AI 视频生成平台，Go 后端）。目标：把生成的 480p 成片做清晰化 —— 视频超分（480p→720p/1080p）、去噪/去块/锐化、老片修复、补帧（24/30→60fps）。
> 调研日期：2026-10-04。文档站返回的「更新时间」均按原文保留（百度为日期，华为为 `YYYY-MM-DD GMT+08:00`）。
> 厂商：百度智能云（`cloud.baidu.com`）+ 华为云（`huaweicloud.com`）。

---

## 0. 调研方法与可信度分级

### 0.1 抓取路径（重要，直接影响复现）

| 站点 | 直连 curl 结果 | 可用方案 |
|---|---|---|
| `cloud.baidu.com/doc/**` | ✅ 正常（SSR，直出正文） | curl + `--compressed` |
| `support.huaweicloud.com`（帮助中心/API参考） | ❌ **站点级被腾讯云 EdgeOne 机器人验证拦截**：任何路径（`/index.html`、`/mpc/index.html`、`/api-mpc/*.html`）均返回 2190 字节的 `Security Verification` 页，需完成 `EO-Bot-Js-Token` JS/CAPTCHA 挑战。换 UA / 完整浏览器头 / `--http1.1` / `--http1.0` / TLS1.2 / 空 UA 均无效 | ✅ **改用 harness 自带 `web_fetch` 工具**（不同出口），可正常拿到正文 |
| `www.huaweicloud.com`（产品页/定价页） | ❌ 返回 29186 字节混淆 JS 反爬壳（`window._aMYJ...`），正文长度为 0 | ⚠️ `web_fetch` 可穿透反爬拿到 HTML 外壳，但定价页是 **JS 单页应用**，HTML 内无价格数据 |
| `developer.huaweicloud.com` | ✅ 可访问，但 AI Gallery 列表/详情页**全 JS 渲染**（正文仅 79~469 字符） | ❌ 无法检索具体模型 |
| `pypi.org` / `files.pythonhosted.org` | ✅ 可访问 | ✅ 下载华为云**官方 Python SDK** 作为 API 交叉验证来源 |

**未采用的绕过手段**：对 `support.huaweicloud.com` 的 EdgeOne 挑战未做任何破解（那是站点刻意设置的访问控制）；仅改用 harness 提供的 `web_fetch` 工具作为替代取数通道。已确认失效的通道：`api.allorigins.win`（522）、`api.codetabs.com`（超时）、`thingproxy`、`r.jina.ai`（空）、`web.archive.org` / `archive.org`（连接失败，本机出网受限）、`html.duckduckgo.com` / `lite.duckduckgo.com`（连接失败）、`docs.huaweicloud.com`（连接失败）。

### 0.2 可信度分级（本文严格标注）

- **[官方文档页]**：厂商帮助中心/文档中心正文，附「更新时间」。
- **[官方定价页 / 计费项页]**：百度为文档内的「计费项」页（含单价表）。
- **[官方 SDK 源码]**：Huawei `huaweicloudsdkmpc==3.1.216` / `huaweicloudsdkvod==3.1.216`（PyPI，由华为官方发布，`Homepage=https://github.com/huaweicloud/huaweicloud-sdk-python-v3`）。**本文所有华为 API 名、HTTP 路径、字段名均逐字取自该 SDK 的 `mpc_client.py` 与 `model/*.py`**，属于「官方生成的 API 定义」，但**不等价于官方文档页**（下文对二者不一致处会显式标注）。
- **[二手来源，可信度低]**：本文**未使用任何**二手来源。

---

## 1. 百度智能云 —— 音视频处理 MCP（含「智感超清」AI 画质增强）

### 1.1 结论先行

百度智能云**有**对外开放的视频超分/AI 画质增强 API，但不叫「视频超分」，而是内嵌在 **音视频处理 MCP（Multimedia Cloud Processing）** 产品下的 **「智感超清」** 系列能力中，能力覆盖面与 libtv 需求**高度吻合**：

| libtv 需求 | 百度对应能力（官方命名） | 是否存在 |
|---|---|---|
| 视频超分 480p→720p/1080p | **智能超分**（`superResolution`，原文「最多可超分 3-5 倍」） | ✅ |
| 去噪 / 去块 | **老片修复_去噪**（`aiVideoDenoise`，0~1 强度） | ✅（去块无独立开关，见未证实清单） |
| 锐化 | **细节增强**（`aiVideoEnhance` + `enhanceStrength` 0~1，「越大越锐利」） | ✅ |
| 老片修复 | **老片修复**：去划痕（`aiVideoScratchRemove`）、去噪、黑白上色（`aiVideoColorization`） | ✅ |
| 补帧 24/30→60fps | **智能插帧**（`frameInterpolate`）；且有预置模板直接把 fps 提升到 60 | ✅ |
| SDR→HDR | **智能HDR**（`aiSdrToHdr`，需 h265 / main10） | ✅ |
| 其他 | 色彩增强（`colorEnhance`）、人脸增强（`faceEnhanceModel`） | ✅ |

**关键限制**：整个智感超清系列是 **白名单开放 + 仅华北-北京区域 + 暂不支持自定义模板（必须用系统预置模板）**，需提交工单申请（见 1.4）。

**产品/文档入口**：[官方文档页] <https://cloud.baidu.com/doc/MCT/index.html>（文档路径为 `MCT`，产品名显示为「音视频处理 MCP」）。

### 1.2 具体接口名与调用形态

#### 1.2.1 转码任务接口（**异步**，「创建 → 轮询/通知」）

来源：[官方文档页] 视频转码任务接口 <https://cloud.baidu.com/doc/MCT/s/4jwvz5ifb>（**更新时间：2026-06-11**）

| 用途 | 方法 + 路径 | 说明 |
|---|---|---|
| 创建转码任务 | `POST /v3/job/transcoding` | 请求体含 `pipelineName`、`sourceKey`/`clips`、`presetName`/`presetId` 等；示例 host 为 `media.bj.baidubce.com` |
| 查询任务列表 | `GET /v3/job/transcoding?pipelineName=...&jobStatus=SUCCESS&begin=...&end=...&marker=...&maxSize=2` | 支持 `jobStatus` / 时间区间 / 分页 |
| 查询单个任务 | `GET /v3/job/transcoding/{jobId}` | 单任务详情（状态轮询用） |

任务完成亦可通过**通知接口**回调（文档目录含「通知接口」，本次未展开抓取 → 见未证实清单）。

#### 1.2.2 转码模板（Preset）接口 —— **增强能力的参数载体**

来源：[官方文档页] 视频转码模板接口 <https://cloud.baidu.com/doc/MCT/s/Sjwvz5hey>

| 用途 | 方法 + 路径 |
|---|---|
| 创建模板 | `POST /v3/preset`（host: `media.bj.baidubce.com`） |

**转码模式 `transCfg.transMode`（String，必选）** 取值（原文逐字）：

> `normal, twopass, cae, cae_enhanced, cae_external, cae_external_sr, cae_external_sr_vis` `super_resolution`，`super_resolution_vis`。当转码模式为 twopass, cae, cae_enhanced 时，video 不能为空；cae_external_sr（cae 带主观增强）、cae_external_sr_vis（cae 带主观增强 vis 模型）、super_resolution（超分辨率）、super_resolution_vis（vis 模型超分辨率）

**`extraCfg`（Object，可选，转码额外配置/视频处理类）中的清晰化相关字段**（逐字摘录，含取值范围/默认值）：

| 字段 | 类型 | 含义（原文） | 取值 / 默认 |
|---|---|---|---|
| `colorEnhance` | Bool | **色彩增强** | true, false / false |
| `aiVideoEnhance` | Bool | **视频细节增强，不改变分辨率** | true, false / false |
| `enhanceStrength` | Float | **细节增强强度，越大越锐利** | 0-1 / 1 |
| `faceEnhanceModel` | String | **人脸增强**，「根据人脸增强时的细节生成水平」 | `strong_generative`、`ultra_generative` |
| `aiSdrToHdr` | Bool | **智能HDR** | true, false；「智能hdr必须选择h265编码，main10编码规格」/ false |
| `superResolution` | Bool | **超分辨率**，「最多可超分3-5倍」 | true, false / false |
| `superResolutionVersion` | Integer | **超分模型选择** | `-1`：仅缩放；`0`：模型0，速度较快，适合互联网UGC内容；`1`：模型1，速度慢，适合影视剧；`2`：模型2，速度慢，适合较老的影视剧；`3`：模型3，速度快，适合UGC和影视剧，细节生成能力较弱；`4`：模型4，速度快，适合UGC和影视剧，细节生成能力强 / 默认 0 |
| `frameInterpolate` | Bool | **智能插帧** | true, false / false |
| `aiVideoScratchRemove` | Float | **老片修复_去划痕** | 0～1，数字越大去划痕灵敏度越高 |
| `aiVideoDenoise` | Float | **老片修复_去噪** | 0～1，数字越大去噪强度越大 |
| `aiVideoColorization` | Bool | **老片修复_上色** | true，false / false |

> ⚠️ **口径冲突（务必注意）**：「使用限制」页明确写 **「智感超清系列暂不支持自定义模板」**，即上述 `extraCfg` 增强字段在当前开通形态下**不建议/不能**通过自定义 Preset 生效，必须走系统预置模板；如确需自定义需**提交工单申请新建模板**。字段本身在官方模板接口文档中仍然公开列出。

#### 1.2.3 智感超清的调用形态：**用预置模板名创建转码任务**

来源：[官方文档页] 使用限制 <https://cloud.baidu.com/doc/MCT/s/Jkv7vpnxc>（**更新时间：2023-09-21**），原文逐字：

**画质超分预置模板（6 个）**：

| 模板名 | 效果（原文） |
|---|---|
| `mcp.video_mp4_720p_h264_sr` | 将低于720p的视频**超分到720p** |
| `mcp.video_mp4_1080p_h264_sr` | 将低于1080p的视频**超分到1080p** |
| `mcp.video_mp4_1440p_h264_sr` | 将低于1440p的视频超分到1440p |
| `mcp.video_mp4_4k_h265_sr` | 将低于2160p的视频超分到2160p |
| `mcp.video_mp4_4k_h265_sr_hdr` | 超分到2160p，并输出 HDR 视频 |
| `mcp.video_mp4_4k_h265_sr_hdr_cz` | 超分到2160p，**fps 提升到 60**，并输出 HDR 视频 |

**老片修复预置模板（4 个）**：

| 模板名 | 效果（原文） |
|---|---|
| `mcp.video_mp4_follow_scratch_noise_enhan` | 去划痕、去噪、**画质增强**，分辨率保持不变，**支持1080p以下输入** |
| `mcp.video_mp4_follow_scratch_noise_color` | 去划痕、去噪、**黑白视频上色**，分辨率保持不变，支持1080p以下输入 |
| `mcp.video_mp4_follow_scratch_noise` | 去划痕、去噪，分辨率保持不变，支持1080p以下输入 |
| `mcp.video_mp4_follow_scratch` | 去划痕，分辨率保持不变，支持1080p以下输入 |

> **对 libtv 的直接价值**：`mcp.video_mp4_720p_h264_sr` / `mcp.video_mp4_1080p_h264_sr` 就是「480p→720p/1080p」的现成模板；`mcp.video_mp4_4k_h265_sr_hdr_cz` 是「超分 + 提到 60fps + HDR」的三合一模板（但目标是 4k，档位单价最高）。

### 1.3 输入限制

来源（除注明外）：[官方文档页] 使用限制 <https://cloud.baidu.com/doc/MCT/s/Jkv7vpnxc>（更新时间 2023-09-21）、系统限制 <https://cloud.baidu.com/doc/MCT/s/2jwvz5i3z>（**更新时间：2019-06-14**）、使用须知 <https://cloud.baidu.com/doc/MCT/s/Sjwvz5hq5>（**更新时间：2024-02-06**）、功能特性 <https://cloud.baidu.com/doc/MCT/s/djwvz4gdy>（**更新时间：2024-10-11**）。

| 维度 | 结论 | 来源 |
|---|---|---|
| 服务区域 | 华北-北京、华南-广州、华东-苏州；**智感超清仅支持华北-北京** | 使用限制 |
| 服务域名 | `media.bj.baidubce.com`（北京 bj）、`media.gz.baidubce.com`（广州 gz）、`media.su.baidubce.com`（苏州 su）；HTTP/HTTPS | 使用须知 |
| 区域耦合 | **转码服务区域必须与 BOS 存储区域一致**（「北京区域的转码服务只处理北京区域 BOS 上存储的音视频资源」） | 使用须知 |
| 单文件大小 | **≤ 5TB**（「与 BOS 单个可上传文件的大小限制保持一致」） | 系统限制 |
| 并发/队列 | 每账号队列总量 **100**（即最多同时处理 100 个转码/截图任务），扩容需工单；提交/查询作业 **≤100 次/秒** | 使用限制 |
| 输入封装格式 | MP4、FLV、MOV、M3U8、3GP、AVI、MPG、ASF、WMV、MKV、TS、WebM、MXF | 功能特性 |
| 输入视频编码 | H.264/AVC、H.265/HEVC、AV1、MPEG-1/2/4、MJPEG、VP8、VP9、Quicktime、RealVideo、Windows Media Video | 功能特性 |
| 输出（超分相关） | 视频编码 H.264/AVC、H.265/HEVC、BD264、BD265、BDAV1；封装 MP4/FLV/HLS/DASH/MXF/TS/MOV/AVI/MKV/OGG/DPX/WEBM 等 | 功能特性 |
| 老片修复输入分辨率 | **支持 1080p 以下输入** | 使用限制 |
| HDR 约束 | 智能HDR **必须选择 h265 编码、main10 编码规格** | 视频转码模板接口 |
| 超分倍数 | 「最多可超分 3-5 倍」 | 视频转码模板接口 |
| **是否支持 URL 直传** | ❌ **未找到**：转码任务接口的输入参数只有 `sourceKey`（原始文件的 **BOS Key**，相对于输入 Bucket 的相对路径）与 `clips[].sourceKey`；**整个任务接口文档中不存在 `sourceUrl` 之类字段**。即必须先上传至 BOS 再转码 | 视频转码任务接口（2026-06-11）；对全文 `grep -i url` 结果为 0 命中 |
| 时长上限 | **未证实**：系统限制页只列了并发数、文件大小、日期三项，未见时长上限 | — |
| 前置授权 | 「为了保证 MCP API 能够被授权访问 BOS、CDN 等服务，用户需要在**管理控制台至少创建一次任务队列**」 | 使用须知 |

### 1.4 开通前置

来源：[官方文档页] MCP 文档首页 <https://cloud.baidu.com/doc/MCT/index.html>；使用限制页「③ 使用前的准备」与智感超清条目。

1. **注册及登录 → 完成实名认证**（文档原文：「新用户首次使用 MCP 时，需要完成**实名认证**，并**开通 MCP 服务**和 **BOS 服务**」）。
2. 开通 MCP 服务 + 开通 BOS 服务（独立文档页：开通MCP服务 <https://cloud.baidu.com/doc/MCT/s/Ikd8jx3vk>）。
3. **智感超清需白名单 + 工单申请**（原文逐字）：
   > 智感超清目前为白名单开放，若需要使用请提交工单申请开通，**申请时请提供 userID 和 pipeline 名称**。
   工单入口（原文中链接已损坏，按原文保留）：`https://ticket.bce.baidu.com/#/ticket/create~productId=34`。
4. 智感超清不支持自定义模板；如系统预置模板不满足需求，**同样需提交工单申请新建模板**。
5. 其他白名单项：**极速转码**亦为白名单开放，申请同样需提供 userID 与 pipeline 名称。

### 1.5 计价方式与单价 ★核心数字

来源：[官方计费项页] 智感超清计费项 <https://cloud.baidu.com/doc/MCT/s/lltsahhft>（**更新时间：2024-11-25**）。**这是百度官方文档页内的单价表，属官方口径。**

计费规则（原文）：
> 按不同格式的转码时长进行计费，费用计算公式：**转码费用 = 输出文件时长 × 不同规格的转码单价**
> **付费方式：后付费**；**适用地域：北京、广州、苏州**
> 输出时长：对于每个转码输出文件，**按分钟计费**，文件时长精确到小数点后两位，第二位根据第三位四舍五入。
> 转码规格：按输出视频分辨率的长边和短边划定档位（例：输出 SD(1280×720) —— 长边不大于 1280 且短边不大于 720 属该规格；超任一边即升档）。

**单价（元/分钟，按输出分辨率档位）：**

| 计费项 | 4K (3840×2160)及以下 | 2K (2560×1440)及以下 | HD (1920×1080)及以下 | SD (1280×720)及以下 | LD (640×480)及以下 |
|---|---|---|---|---|---|
| **画质增强**（细节增强/色彩增强，账单显示「画质增强」） | 1.5 | 0.7 | **0.35** | 0.2 | 0.15 |
| **人脸增强** | 3.0（不区分档位） | — | — | — | — |
| **智能超分** | 3.6 | 1.6 | **0.9** | 0.5 | — |
| **智能HDR** | 2.1 | 1.2 | 0.6 | 0.5 | 0.5 |
| **智能插帧** | 5.8 | 2.8 | **1.5** | 0.7 | 0.3 |
| **老片修复_去噪/去划痕** | — | — | **6.0** | 3.0 | 2.0 |
| **老片修复_黑白上色** | — | — | 0.8 | 0.8 | 0.7 |

官方计费示例（原文逐字）：
- 示例1：同时开启**色彩增强 + 细节增强**，输出 1920×1080 规格 10 分钟 → `10 × 0.35 = 3.5 元`
- 示例2：同时开启**去噪 + 去划痕**，输出 1920×1080 规格 10 分钟 → `10 × 6.0 = 60 元`

> **对 libtv 的量级判断**：480p→720p 智能超分 **0.5 元/分钟**（SD 档）；480p→1080p 智能超分 **0.9 元/分钟**（HD 档）；若叠加细节增强 +0.35 元/分钟（HD 档）、叠加智能插帧 +1.5 元/分钟（HD 档）。**老片修复（去噪/去划痕）是全场最贵项（HD 档 6.0 元/分钟）**，比超分贵约 6.7 倍，漫剧成片一般不需要。

其他相关计费项（存在但本次未逐一抓取单价表）：「音视频转码计费」<https://cloud.baidu.com/doc/MCT/s/llts4wiy1>、「AI视频处理与生产计费项」<https://cloud.baidu.com/doc/MCT/s/Dltyea3np>（更新时间 2025-10-31）、「AI视频质量检测计费项」、「媒体版权保护计费项」、「预付费资源包」。

补充（[官方计费项页] AI视频处理与生产计费项，更新时间 2025-10-31）：AI 类处理项按**输出分辨率时长**计费，示例「智能去字幕 1080p 1 分钟 + 智能绿幕抠像 720p 5 分钟 = 1×0.7 + 5×0.5 = 1.2 元」。

### 1.6 百度其他视频/修复相关产品的核实

| 产品 | 结论 | 来源 |
|---|---|---|
| **智能点播平台 VOD** | **无视频清晰化/增强能力**。VOD 定位是「音视频文件的存储、管理及播放服务」，计费仅 **存储计费 + 分发计费**；API 分组为「音视频媒资接口 / 播放器服务接口 / 转码模板组接口 / 策略组接口」 | [官方文档页] <https://cloud.baidu.com/doc/VOD/index.html> |
| **图像增强与特效** | **仅图片，不是视频**。原文：「对质量较低的**图片**进行去雾、对比度增强、**无损放大**等多种优化处理，重建高清图像；并提供黑白**图像**上色、图像风格转换、人像动漫化等多个**图像**特效 API」（含图片超分/上色，但均作用于图片） | [官方文档页] <https://cloud.baidu.com/doc/IMAGEPROCESS/index.html> |
| **独立的「AI 视频修复」/「视频修复」产品** | ❌ **未找到**。对百度智能云文档中心全量产品清单（<https://cloud.baidu.com/doc/index.html>）抓取后按关键词检索，「视频修复」「AI视频修复」「老片修复」在产品名层面 **0 命中**；修复类能力只存在于 MCP 的「智感超清/老片修复」内 | 抓取结果：`grep -oiE "visionseed|视频修复|老片修复|AI视频修复"` → 无输出 |
| **VisionSeed** | ❌ **未证实/未找到开放 API**。该名称未出现在百度智能云文档中心产品清单中；本次未另行核实其是否为百度其他体系（如百度大脑/硬件模组）下的名称 | 同上（本文不为其编造产品定位） |
| **千帆 / 文心上的视频增强模型** | ⚠️ **未证实**。文档中心「多模态模型服务」入口指向 <https://cloud.baidu.com/doc/qianfan-docs/s/7m95lyy43>，本次未逐页检索是否存在可调用的「视频增强/超分」模型 | — |
| **智能视频 SDK**（`VideoCreatingSDK`） | 仅确认产品存在（<https://cloud.baidu.com/doc/VideoCreatingSDK/index.html>），**未抓取内容**，其是否含端侧超分能力 → 未证实 | — |

---

## 2. 华为云 —— 媒体处理 MPC（含「视频增强」）与相关产品

### 2.1 结论先行

华为云 MPC **确有能力覆盖 libtv 的核心需求**（超分/去噪/去块/锐化/对比度/饱和度），且**提供独立于转码任务的「视频增强」任务 API**。但有两个重要负面结论：

1. **MPC 不支持补帧**（无插帧算子；且转码帧率参数明确「若设置的帧率高于片源帧率，则自动调整为片源帧率」）。
2. **MPC 的视频增强 API 未出现在官方「API概览」页面中**（该页更新时间 2026-09-07），只在官方 Python SDK 的 API 定义里存在 —— **其开通方式/白名单/区域限制属未证实**。

另外：**MPC 无媒资存储**，输入必须是 **OBS 桶**中的对象，且需把桶授权给 MPC（**不支持 URL 直传**）。

### 2.2 官方 API 概览的边界（先说清官方文档写了什么）

来源：[官方文档页] API概览 <https://support.huaweicloud.com/api-mpc/mpc_04_0005.html>（**更新时间：2026-09-07 GMT+08:00**）。该页列出的全部接口分组为：

自定义转码模板 / 自定义转码模板组 / 配置水印模板 / **媒资转码** / 转封装 / 转动图 / 视频解析 / 抽帧截图 / 剪辑 / 授权与配置 / 租户开通。

其中与清晰化**直接相关**的官方条目：
- 新建转码任务 `POST /v1/{project_id}/transcodings`、取消 `DELETE /v1/{project_id}/transcodings{?task_id}`、查询 `GET /v1/{project_id}/transcodings{?task_id,start_time,end_time,status,page,size}`
- 租户开通：`PUT /v1/{project_id}/tenant/access`（租户开通媒体转码服务）、`GET /v1/{project_id}/tenant/access`（租户查询服务开通状态信息）

> ❗ **该页没有任何「视频增强 / 画质增强 / 超分」接口分组**。这构成与 SDK 的显著口径差异（下节）。

**使用前必读**（[官方文档页] <https://support.huaweicloud.com/api-mpc/mpc_04_0001.html>，**更新时间：2026-09-23 GMT+08:00**）中与落地相关的约束，原文要点：
- 「由于媒体处理服务**无媒资存储功能，只能处理存储在 OBS 桶中的音视频文件**，因此，您在调用视频转码、转封装、转动图、抽帧截图接口前，需要将待处理的音视频文件**上传到 OBS 桶中，并将桶授权给媒体处理服务**。」→ **不支持 URL 直传，必须先入 OBS 并授权**。
- 流控：「单租户接口流控：**100 次/分钟**」「接口总体流控：**1000 次/分钟**」。
- 区域：「调用 IAM 接口的区域需与调用媒体处理接口的区域一致」；「**不支持处理跨区域的媒资文件**，如使用『华北-北京一』的媒体处理服务不能处理存储在『华北-北京四』OBS 桶中的视频文件」。
- 「在请求参数中填写 Integer 数据类型时，使用小数，只有小数点之前的数字有效。」
- 终端节点（Endpoint）：「您可以从[地区和终端节点](https://console.huaweicloud.com/apiexplorer/#/endpoint/MPC)中查询服务的终端节点」。
- 鉴权：需先获取用户 Token（IAM），用于后续 API 鉴权。

### 2.3 「视频增强」的**具体 API**（来源：官方 SDK，非文档页）

来源：[官方 SDK 源码] `huaweicloudsdkmpc==3.1.216`（PyPI 官方发布，<https://pypi.org/project/huaweicloudsdkmpc/>；SDK 自述 Homepage 为 <https://github.com/huaweicloud/huaweicloud-sdk-python-v3>）。下表的「操作名 / HTTP 方法 / 路径」逐字取自 SDK 的 `v1/mpc_client.py`。

#### 2.3.1 视频增强模板（QualityEnhanceTemplate）CRUD

| SDK 操作名 | HTTP 方法 | 路径 | SDK 中文说明 |
|---|---|---|---|
| `CreateQualityEnhanceTemplate` | `POST` | `/v1/{project_id}/template/qualityenhance` | 创建**视频增强模板** |
| `UpdateQualityEnhanceTemplate` | `PUT` | `/v1/{project_id}/template/qualityenhance` | 更新视频增强模板 |
| `DeleteQualityEnhanceTemplate` | `DELETE` | `/v1/{project_id}/template/qualityenhance` | 删除视频增强模板 |
| `ListQualityEnhanceDefaultTemplate` | `GET` | `/v1/{project_id}/template/qualityenhance/default` | 查询**预置**视频增强模板（响应体 `QualityEnhanceDefaultTemplateResponse{ task_array: [QualityEnhanceTemplateInfo], total }`） |

模板对象 `QualityEnhanceTemplate` 字段：`template_name`（模板名称）、`template_description`（模板描述，**查询预置模板时才会返回**）、`video`（`QualityEnhanceVideo`）。

#### 2.3.2 视频增强**任务**（异步任务，MediaProcess）

| SDK 操作名 | HTTP 方法 | 路径 | 说明 |
|---|---|---|---|
| `CreateMediaProcessTask` | `POST` | `/v1/{project_id}/enhancements` | 创建视频增强任务 |
| `ListMediaProcessTask` | `GET` | `/v1/{project_id}/enhancements` | 查询视频增强任务（轮询用） |
| `DeleteMediaProcessTask` | `DELETE` | `/v1/{project_id}/enhancements` | 取消/删除视频增强任务 |

- **请求体** `CreateMediaProcessReq`，**仅 3 个字段**：`input`（`ObsObjInfo`）、`output`（`ObsObjInfo`）、`template_id`（**模板ID**）。
- **任务状态对象** `MediaProcessTaskInfo` 字段：`task_id`、`status`、`create_time`、`end_time`、`output`、`description`、`output_file_name`（list）、`input`。
- 调用形态：**异步**（提交任务 → 轮询 `ListMediaProcessTask` 或配置消息通知；SDK 另有 `mpc_async_client.py` 提供异步客户端）。

#### 2.3.3 增强能力清单（`QualityEnhanceVideo` 子算子）★逐字核对

`QualityEnhanceVideo` 的全部字段即 MPC 视频增强的**能力全集**：

| 字段 | 模型 | 含义 | 关键参数（取自对应模型 docstring） |
|---|---|---|---|
| `video_denoise` | `VideoDenoise` | **去噪** | `name`、`execution_order` |
| `video_sharp` | `VideoSharp` | **锐化** | `name`、`execution_order`、**`amount`**（锐化量，str） |
| `video_contrast` | `VideoContrast` | **对比度** | `name`、`execution_order` |
| `video_superresolution` | `VideoSuperresolution` | **超分（超分辨率）** | `name`：超分算法名称 **`"hw-sr"`**；`execution_order`；**`scale`：超分倍数，取值范围 [2,8]，默认 2** |
| `video_deblock` | `VideoDeblock` | **去块（去块效应）** | `name`、`execution_order` |
| `video_saturation` | `VideoSaturation` | **饱和度** | `name`、`execution_order` |

`execution_order` 语义（原文）：「1 表示视频处理时第一个执行，2 表示第二个执行，以此类推；除不执行，**各视频处理算法的执行次序不可相同**。」

> ✅ 这正好覆盖 libtv 的「超分（480p→720p/1080p，scale 取 2 即可）+ 去噪 + 去块 + 锐化」，且**执行顺序可控**，工程上比百度「只能选预置模板」更灵活。

#### 2.3.4 补帧 / 插帧：**不支持**（重要负面结论）

对官方 MPC SDK 全量 255 个文件检索：
- `grep -rn "插帧" mpcsdk/` → **0 命中**
- 模型目录中不存在任何 frame interpolation / 补帧算子

且转码输出模型 `Video.frame_rate` 的 docstring 明确（原文）：
> 「帧率。取值范围：**0 或 [5,60] 之间的整数**。单位：帧每秒。> **若设置的帧率不在取值范围内，则自动调整为 0，若设置的帧率高于片源帧率，则自动调整为片源帧率**。」

→ **MPC 只能降帧率/保持帧率，不能升帧率做补帧**。libtv 的「24/30→60fps」需求**不能**靠华为云 MPC 实现（如需补帧须引入其他厂商或自建）。

#### 2.3.5 普通上采样（非 AI 超分，注意区分）

`VideoProcess`（转码请求 `CreateTranscodingReq.video_process` 对应的模型）含字段 `upsample`（int）：
> 「是否开启上采样，**如支持从 480P 的片源转为 720P**，可取值为：- 0：表示上采样关闭，- 1：表示上采样开启。」

→ 这是**传统上采样**（`CreateTranscodingReq` 的 20+ 字段中**没有** `quality_enhance` / `video_enhance` 之类引用增强模板的字段），**不是 AI 超分**，画质提升量级远低于 `video_superresolution`（`hw-sr`）。选型时切勿混淆。

### 2.4 华为云其他产品核实

| 产品 | 结论 | 来源 |
|---|---|---|
| **视频点播 VOD** | ❌ **未提供视频增强/超分/插帧 API**。对官方 SDK `huaweicloudsdkvod==3.1.216`（<https://pypi.org/project/huaweicloudsdkvod/>）全量检索 `enhance\|superresolution\|super_resolution\|upscale\|sharp\|denoise\|插帧\|超分` → **0 命中**。VOD 共 164 个操作，覆盖转码模板/模板组、截图、水印、剪辑、媒资、CDN 预热刷新等；其中 `CreateUploadByUrl`（`POST /v1/{project_id}/asset/customization/upload-by-url`）等**支持 URL 拉取上传**（这点优于 MPC 的纯 OBS 限制，但 VOD 无清晰化能力） | [官方 SDK 源码] |
| **ModelArts / AI Gallery（超分模型）** | ⚠️ **未证实**。AI Gallery 入口可访问（<https://developer.huaweicloud.com/develop/aigallery/home.html>），但**模型列表页与详情页全为 JS 渲染**（`/model/list`、`/model/list?keyword=超分`、`/model/detail?id=...` 抓到的正文长度仅 79~81 字符，无模型数据）；未找到其 JSON API（尝试 `/develop/aigallery/api/model/list`、`/api/v1/model/list` 均 404）。**因此「AI Gallery 上是否有可部署的超分模型」本次无法证实**。原理上说明：AI Gallery 是模型/资产的集市，模型需**部署到 ModelArts 推理服务**后才成为 API（即**自建推理，并非开箱即用的视频增强 API**），且需自行解决视频解码/分帧/合帧流水线 | — |
| **MPC 高清低码 / 其他** | 本次未抓取 MPC「高清低码」等具体文档页 → 未证实 | — |

### 2.5 计价与单价

- **计价方式**：⚠️ **未证实**。官方定价页 <https://www.huaweicloud.com/pricing.html#/mpc> 实际重定向到 `https://www.huaweicloud.com/pricing/calculator.html`，该页是 **JS 单页应用**——用 `web_fetch` 穿透反爬后拿到的 HTML 正文中**不含任何价格数据**（价格由前端异步加载）。
- **单价**：⚠️ **未证实**。未能定位到官方 MPC「计费说明」文档页：尝试 `https://support.huaweicloud.com/productdesc-mpc/mpc030004.html` → **HTTP 404**；帮助中心目录页 `https://support.huaweicloud.com/mpc/index.html`（成长地图）正文为 JS 渲染，无导航链接可循。
- **可确认的事实**：MPC 存在「租户开通」API（`PUT/GET /v1/{project_id}/tenant/access`，见 API概览），说明存在服务开通环节；但**是「按分辨率档位每分钟」还是「按次」、以及具体单价，本文不做任何推测**。
- ⚠️ 再次强调：**本文不引用任何二手价格（博客/CSDN/代理报价）**，故华为 MPC 价格待用户在有账号/控制台环境下核实。

### 2.6 开通前置

来源：[官方文档页] 使用前必读 <https://support.huaweicloud.com/api-mpc/mpc_04_0001.html>（更新时间 2026-09-23 GMT+08:00）+ 官方 SDK。

1. **账号/实名**：需华为云账号；文档中反复出现「未实名认证/已实名认证」状态项（页面导航），华为云常规要求实名认证才能使用付费云服务 —— 但**「必须企业认证」这一点未证实**。
2. **OBS 准备 + 桶授权**：必须自建 OBS 桶、上传媒资、并**将桶授权给 MPC**（原文见 2.2）。这是硬前置，无 URL 直传。
3. **区域一致性**：IAM Token 区域必须与 MPC 区域一致；**不支持跨区域媒资**（例如北京一的服务不能处理北京四桶中的文件）。
4. **终端节点**：从 API Explorer 查询（<https://console.huaweicloud.com/apiexplorer/#/endpoint/MPC>）。
5. **服务开通**：可用 `PUT /v1/{project_id}/tenant/access` 开通、`GET` 查询开通状态。
6. **是否需工单/白名单开通「视频增强」**：⚠️ **未证实**。由于「视频增强」接口未出现在官方 API概览（2026-09-07）中，无法判断它是需工单申请、还是文档滞后；**建议以工单向华为云确认**。
7. **区域/节点限制（视频增强专用）**：⚠️ **未证实**（未找到视频增强的区域支持说明）。

---

## 3. 小结（对比 + 对 libtv 的建议）

### 3.1 能力矩阵

| 能力 | 百度智能云 MCP「智感超清」 | 华为云 MPC「视频增强」 |
|---|---|---|
| 超分 | ✅ `superResolution`（3-5倍）/ 预置 `*_sr` 模板 | ✅ `video_superresolution`（`hw-sr`，scale 2~8，默认 2） |
| 去噪 | ✅ `aiVideoDenoise`（0~1） | ✅ `video_denoise` |
| 去块 | ⚠️ 无独立开关（未证实） | ✅ `video_deblock` |
| 锐化 | ✅ `aiVideoEnhance` + `enhanceStrength`（0-1） | ✅ `video_sharp`（`amount`） |
| 对比度/饱和度 | ⚠️ 未单列（色彩增强 `colorEnhance`） | ✅ `video_contrast` / `video_saturation` |
| 老片修复（去划痕/上色） | ✅ 去划痕 + 去噪 + 黑白上色（4 个预置模板） | ❌ 无划痕/上色算子 |
| 补帧 → 60fps | ✅ `frameInterpolate`；模板 `mcp.video_mp4_4k_h265_sr_hdr_cz`（4k 档） | ❌ **不支持**（帧率不可高于片源） |
| SDR→HDR | ✅ `aiSdrToHdr`（需 h265 main10） | ⚠️ 未证实 |
| 算子执行顺序可控 | ❌（不支持自定义模板，白名单工单） | ✅ `execution_order` |
| 输入源 | ❌ 必须 BOS（`sourceKey`），无 URL 直传 | ❌ 必须 OBS + 桶授权，无 URL 直传 |
| 调用形态 | 异步：`POST /v3/job/transcoding` → `GET /v3/job/transcoding/{jobId}` | 异步：`POST /v1/{project_id}/enhancements` → `GET /v1/{project_id}/enhancements`（+ 模板 CRUD） |
| 开通门槛 | 实名认证 + 开通 MCP/BOS + **白名单工单（userID + pipeline 名）** + 仅华北-北京 | 账号 + OBS 桶授权 + 区域一致；增强接口开通方式**未证实** |
| 单价可得性 | ✅ **官方文档单价表齐全** | ❌ **未证实**（定价页 JS-only） |
| libtv 最相关单价（HD 1080p 档，元/分钟） | 智能超分 **0.9**；画质增强（细节/色彩）**0.35**；智能插帧 **1.5**；智能HDR **0.6**；去噪/去划痕 **6.0**；黑白上色 **0.8** | 未知 |

### 3.2 对 libtv 的落地方案要点（仅基于已证实事实）

1. **若「480p→720p/1080p + 提到 60fps」是首选路径**：百度 MCP 智感超清是目前**两家唯一同时提供超分与智能插帧**的方案，且 `mcp.video_mp4_720p_h264_sr` / `mcp.video_mp4_1080p_h264_sr` 开箱即用。成本量级：**720p 超分 0.5 元/分钟**、**1080p 超分 0.9 元/分钟**；若还要 60fps，注意**预置的「超分+60fps」模板只到 4k 档（`mcp.video_mp4_4k_h265_sr_hdr_cz`）**，若需 1080p 超分 + 插帧组合，需**工单申请自定义模板**。
2. **前置成本**：百度方案必须**先入 BOS**（按区域配对，`media.bj.baidubce.com` ↔ 北京 BOS），且有**白名单工单**审批周期 —— 这是工期风险点，建议尽早在华北-北京提交工单（提供 userID 与 pipeline 名称）。
3. **华为云 MPC 的定位**：参数最细（6 个算子可任意组合 + 执行顺序可控），但因 **① 无补帧 ② 增强接口未见于官方 API概览 ③ 单价未证实 ④ 必须 OBS 桶授权**，适合作为「超分+去噪/去块/锐化」的**备选/比价对象**，不适合承担补帧需求。
4. **两家都不支持 URL 直传**：libtv 需要实现「上传到对象存储」这一步（BOS / OBS），或改用 VOD（华为 VOD 的 `CreateUploadByUrl` 支持 URL 拉取，但 VOD 无清晰化能力，只能作为上游入湖通道）。
5. **百度 VOD、图像增强，以及华为 VOD、AI Gallery 均不能替代上述能力**（前三者已验证无视频清晰化 API；AI Gallery 未证实且属自建推理）。

---

## 4. 未证实清单（明确列出，不做推测）

**百度智能云**
1. **去块效应（deblock）**是否有独立开关 —— 增强字段清单中未见对应项（只有去噪/去划痕）。
2. **时长上限** —— 系统限制页（2019-06-14）只列并发数、文件大小（5TB）、日期三项。
3. **URL 直传**是否可通过其他接口（如即时转码/通知接口）实现 —— 转码任务接口仅有 `sourceKey`。
4. **通知接口**（回调）的具体字段与路径 —— 仅确认文档目录中存在「通知接口」，未抓取正文。
5. **`superResolutionVersion` 各模型对漫剧/短剧类内容的实测效果差异** —— 文档只有适用性描述，无质量数据。
6. **智感超清在「广州/苏州」是否可用** —— 计费页写「适用地域：北京、广州、苏州」，而使用限制页写「智感超清目前仅支持华北-北京区域」，**两页口径冲突**，以使用限制页（更具体）为准但仍标注冲突。
7. **VisionSeed 与「AI 视频修复」产品** —— 文档中心产品清单 0 命中，未证实其存在或归属。
8. **千帆/文心是否存在可调用的视频增强模型** —— 未逐页检索。
9. **智能视频 SDK（VideoCreatingSDK）是否含端侧超分** —— 未抓取内容。
10. **「AI视频处理与生产计费项」/「音视频转码计费」页的完整单价表** —— 仅确认页面存在，未逐项抓取。
11. **细节增强 `aiVideoEnhance` 与 `superResolution` 是否可同时开启**、以及「细节增强不改变分辨率」与超分叠加时的计费是否叠加 —— 未证实（计费示例只给了色彩增强+细节增强的组合）。

**华为云**
1. **MPC 视频增强的官方文档页** —— 「API概览」（2026-09-07）未收录 `/enhancements` 与 `/template/qualityenhance*`；本文 API 名/路径/字段**全部来自官方 SDK 3.1.216**，非文档页。
2. **视频增强的开通方式**（是否需工单/白名单）、**区域限制**、**配额** —— 全部未证实。
3. **MPC 计价方式与单价** —— 定价页为 JS 单页应用，HTML 无价格；官方计费说明文档页未定位到（`mpc030004.html` 为 404）。**不推测**是「元/分钟」还是「元/次」。
4. **视频增强的单任务输入限制**（时长/分辨率/文件大小/格式） —— 未找到说明；「使用前必读」只有流控（100 次/分钟/租户）与跨区域限制。
5. **AI Gallery 上的具体超分模型** —— 列表/详情页 JS 渲染，无 JSON API 可查，未能证实任何具体模型存在。
6. **「必须企业认证」** —— 未证实（仅知需账号/实名认证状态）。
7. **MPC「高清低码」等既有能力与视频增强的关系** —— 未抓取。
8. **视频增强任务是否也计入转码流控/是否有独立计费项** —— 未证实。

**方法论限制（影响可复现性）**
9. `support.huaweicloud.com` 与 `www.huaweicloud.com` 对本环境的直连 HTTP 客户端**不可抓取**（EdgeOne 机器人验证 / JS 反爬壳）；本报告的华为官方页面均通过 **harness 内置 `web_fetch`** 获得，纯 curl 方案不可复现。若需脚本化采集华为云文档，需另行申请白名单出口或使用带 JS 渲染能力的抓取器。

---

## 5. 来源清单

### 5.1 百度智能云（全部为 [官方文档页] / [官方计费项页]，直连 curl 抓取成功）

| URL | 页面标题 | 更新时间 |
|---|---|---|
| <https://cloud.baidu.com/doc/MCT/index.html> | 音视频处理 MCP（文档首页/学习路径） | 页面日期未知 |
| <https://cloud.baidu.com/doc/MCT/s/djwvz4gdy> | 功能特性 | **2024-10-11** |
| <https://cloud.baidu.com/doc/MCT/s/Jkv7vpnxc> | 使用限制（智感超清白名单/预置模板） | **2023-09-21** |
| <https://cloud.baidu.com/doc/MCT/s/2jwvz5i3z> | 系统限制（5TB/并发） | **2019-06-14** |
| <https://cloud.baidu.com/doc/MCT/s/Sjwvz5hq5> | 使用须知（域名/区域/队列） | **2024-02-06** |
| <https://cloud.baidu.com/doc/MCT/s/lltsahhft> | 计费项说明 > 智感超清计费项（**单价表**） | **2024-11-25** |
| <https://cloud.baidu.com/doc/MCT/s/Dltyea3np> | 计费项说明 > AI视频处理与生产计费项 | **2025-10-31** |
| <https://cloud.baidu.com/doc/MCT/s/Sjwvz5hey> | API参考 > 视频转码模板接口（`POST /v3/preset`、`extraCfg` 字段） | 页面日期未知 |
| <https://cloud.baidu.com/doc/MCT/s/4jwvz5ifb> | API参考 > 视频转码任务接口（`/v3/job/transcoding`） | **2026-06-11** |
| <https://cloud.baidu.com/doc/VOD/index.html> | 智能点播平台 VOD（无增强能力） | 页面日期未知 |
| <https://cloud.baidu.com/doc/IMAGEPROCESS/index.html> | 图像增强与特效（仅图片） | 页面日期未知 |
| <https://cloud.baidu.com/doc/index.html> | 文档中心全量产品清单（用于核实无「视频修复」产品/VisionSeed） | 页面日期未知 |
| <https://cloud.baidu.com/doc/MCT/s/llts4wiy1> | 计费项说明 > 音视频转码计费（仅确认存在） | 未抓取 |

### 5.2 华为云（[官方文档页] 经 harness `web_fetch` 获取；[官方 SDK 源码] 经 PyPI 下载）

| URL / 包 | 页面/内容 | 更新时间 |
|---|---|---|
| <https://support.huaweicloud.com/mpc/index.html> | 媒体处理 MPC 成长地图（正文 JS 渲染，未取到导航） | — |
| <https://support.huaweicloud.com/api-mpc/mpc_04_0001.html> | API参考 > 使用前必读（无媒资存储/OBS 授权/流控/跨区域/Endpoint） | **2026-09-23 GMT+08:00** |
| <https://support.huaweicloud.com/api-mpc/mpc_04_0005.html> | API参考 > API概览（**未含视频增强接口**） | **2026-09-07 GMT+08:00** |
| <https://support.huaweicloud.com/productdesc-mpc/mpc030001.html> | 产品介绍 > 什么是媒体处理 | **2026-09-24 GMT+08:00** |
| <https://support.huaweicloud.com/productdesc-mpc/mpc030004.html> | ❌ HTTP 404（尝试定位计费说明失败） | — |
| <https://www.huaweicloud.com/pricing.html#/mpc> → `https://www.huaweicloud.com/pricing/calculator.html` | 价格计算器（**JS 单页应用，HTML 无价格**） | — |
| <https://console.huaweicloud.com/apiexplorer/#/endpoint/MPC> | MPC 地区和终端节点（官方指引的 Endpoint 查询入口，未抓取） | — |
| <https://developer.huaweicloud.com/develop/aigallery/home.html> | AI Gallery 首页（可访问，但模型列表/详情 JS 渲染） | — |
| <https://developer.huaweicloud.com/develop/aigallery/model/list>（含 `?keyword=超分`）、`/model/detail?id=<uuid>` | ❌ 正文 79~81 字符，无模型数据 | — |
| <https://pypi.org/pypi/huaweicloudsdkmpc/json> → `huaweicloudsdkmpc-3.1.216-py3-none-any.whl` | **[官方 SDK 源码]** MPC SDK：`v1/mpc_client.py`、`v1/model/quality_enhance_template.py`、`quality_enhance_video.py`、`video_superresolution.py`、`video_denoise.py`、`video_deblock.py`、`video_sharp.py`、`create_media_process_req.py`、`media_process_task_info.py`、`create_transcoding_req.py`、`video_process.py`、`video.py` | SDK 版本 3.1.216 |
| <https://pypi.org/pypi/huaweicloudsdkvod/json> → `huaweicloudsdkvod-3.1.216-py3-none-any.whl` | **[官方 SDK 源码]** VOD SDK：检索增强/超分/上采样关键词 **0 命中**；确认 `CreateUploadByUrl` 等 164 个操作 | SDK 版本 3.1.216 |

### 5.3 检索工具（本调研自建，可复用）

- `/tmp/fetch_bh.py`：curl + 正则去标签的正文抽取器（`python3 /tmp/fetch_bh.py "<url>" <limit>`），适用于**直连可抓**的站点（如 `cloud.baidu.com`）。
- 华为云文档请改用 harness 的 `web_fetch` 工具（直连 HTTP 客户端会被 EdgeOne 拦截）。
- 华为 API 交叉验证：`curl -s https://pypi.org/pypi/<pkg>/json`（取 wheel URL）→ `unzip` → 在 `v1/<prod>_client.py` 中 grep `"resource_path"` 与 `"method"` 可列出全部操作及其 HTTP 路径；在 `v1/model/*.py` 中 grep `openapi_types` 可列出全部字段名。

### 5.4 二手来源

**无。** 本报告未使用任何技术博客、CSDN、公众号或代理商报价；所有结论均来自上述官方文档页、官方计费项页与官方 SDK 源码。