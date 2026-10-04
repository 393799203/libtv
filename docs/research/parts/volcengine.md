# 火山引擎（Volcengine）/ BytePlus —— 视频「清晰化」能力调研

> 调研对象：libtv（漫剧/短剧 AI 视频生成平台，Go 后端）。目标：把生成的 480p 成片做清晰化 —— 视频超分（480p→720p/1080p）、去噪/去块/锐化、老片修复、补帧（24/30→60fps）。
> 调研日期：2026-10-04（文档站返回的时间戳均为北京时间基准的 ISO8601，本文保留原始 `UpdatedTime`）。
> 厂商：火山引擎（中国站 `volcengine.com`）+ 海外品牌 BytePlus（`byteplus.com`）。

## 0. 调研方法与可信度分级（可复用资产）

### 0.1 关键突破：火山文档站有公开 JSON API，无需 JS 渲染

`https://www.volcengine.com/docs/<LibraryID>/<DocumentID>` 是 SPA（直接 curl 只得 "You need to enable JavaScript to run this app."，HTML 仅约 3.5 KB，**没有** `__INITIAL_STATE__` / `__NEXT_DATA__`）。但文档站前端 bundle（从 SPA 壳的 `<script src>` 里可列出，例如 `https://res.gcloudcache.com/volc-fe/doccenter/static/js/main.3613eab6.js`）中 grep `'/api/doc/'` 可挖到正文接口：

| 用途 | 请求 | 说明 |
|---|---|---|
| **取正文** | `GET https://docs.volcengine.com/api/doc/getDocDetail?DocumentID=<id>&type=doc` | 返回 `Result.{Title, DocumentCode, LibraryID, LibraryCode, UpdatedTime, Content, **MDContent**, EnContent, CanonicalURL}`。**无需登录/cookie/签名**（响应 `HasPass:false`）。`DocumentID` 必填；只传 `DocumentCode` 会报 `ParameterMissing`。`www.volcengine.com` 与 `docs.volcengine.com` 同源均可用 |
| **取正文（推荐）** | 同上，但读 **`Result.MDContent`** | ⭐ **`MDContent` 是纯 markdown 全文，表格结构完整保留**（含 `\|` 分隔的单元格与换行）。**应优先用 MDContent，不要用 `Content`** —— 后者在新库是 Quill Delta，表格只剩 `[表格uuid:...]` 占位符。`EnContent` 为英文版内容 |
| **全文检索** | `GET https://docs.volcengine.com/api/search/openSearchNew?Query=<urlencoded>&Caller=doc&Did=1&Uid=0&UUID=1&UidType=14&PageSize=20&Page=1` | 返回 `Result.DocList[].{GID, LibraryID, Title, Content, FullContent}`，`GID` 即 `DocumentID`。**检索结果里直接带正文摘要，极高效** |
| **列整库** | `GET https://docs.volcengine.com/api/doc/getDocList?LibraryID=<lib>&type=doc` | 一次拿到某产品全库文档 ID + 标题（VOD 库 4 有 856 篇） |

**解析坑**：`Content` 的格式**因库而异**——
- **VOD 库（LibraryID=4, `video_on_demand`）**：干净 markdown，直接读。
- **AI MediaKit 库（LibraryID=6448, `Intelligentprocessing`）**：**Quill Delta JSON**（`{"ops":[{"insert":"..."}]}`），必须递归取所有 `insert` 字符串；表格是独立 zone，占位符形如 `[表格uuid:xxx]`，真实单元格文本散落在同一篇文档后续的 zone 里（**这也是为什么用 `Content` 看"单价表格"是空的**）。
- ✅ **正确的做法：改用 `Result.MDContent`**，它是**纯 markdown 且表格完整**（本报告的所有单价表格均已在 `MDContent` 上逐字复核，与 `Content` 解析结果一致）。

可用脚本 `/tmp/vdoc.py`（本次调研产物）：`python3 /tmp/vdoc.py s "关键词"`（检索）、`python3 /tmp/vdoc.py d <DocumentID> <limit> <offset>`（取正文）。

### 0.2 可信度分级（本文严格标注）

- **[官方文档]**：火山文档站正文，附 `UpdatedTime`。
- **[官方 SDK 源码]**：`github.com/volcengine/volc-sdk-golang`（默认分支 `main`），作为文档的交叉验证。
- **[官方定价页/计费文档]**：单独标注。
- **[二手来源，可信度低]**：技术博客/CSDN/公众号 —— 本文**未使用任何**这类来源，全部结论来自官方文档或官方 SDK 源码。

---

## 1. 火山引擎 视频点播 VOD —— 画质增强（含超分/插帧/去噪/老片修复/SDR转HDR）

### 1.1 产品名与能力覆盖

**产品**：视频点播 VOD > 媒体处理 > **画质增强**（控制台路径：媒体处理 > 媒体处理模板 > **画质增强修复模板**）。

官方能力描述原文（[官方文档] [docs/4/117971](https://www.volcengine.com/docs/4/117971)，UpdatedTime `2026-09-07T07:02:28Z`）：

> 画质增强修复功能基于业界领先的 AI 算法，通过场景化预设模板，为您的视频提供一站式的画质提升解决方案。画质增强修复功能通过智能分析，结合**超分辨率、智能插帧、色彩增强、音视频降噪**等多种能力，显著提升视频的清晰度、流畅度和色彩表现力。

**预设模板（场景）× 核心能力**（[官方文档] docs/4/117971）：

| 预设模板 | 适用场景 | 核心能力 |
|---|---|---|
| 通用模板 | 大多数通用场景 | 综合画质增强与修复 |
| UGC 短视频 | 用户原创短视频，修复多次压缩/传输导致的模糊、块效应、失真 | 损伤修复 |
| AIGC 内容 | AI 大模型生成的低分辨率视频 | 超分重绘 |
| **短剧** | 面向精品短剧，对剧中人像增强和细节美化 | **人像优化** |
| **老片修复** | 经典影视、老旧影片，综合解决低分辨率、运动卡顿、色彩失真、划痕噪点 | **全面修复** |
| **自定义增强** | 自定义组合下列原子算子 | 灵活组合算子 |

**自定义增强可开启的原子算子**（[官方文档] docs/4/117971）：
- **色彩增强**：SDR 增强（智能优化 SDR 视频色彩）、SDRToHDR（SDR 转 HDR，提升对比度与色彩丰富度）
- **智能超分**：深度学习空域/时域建模重构缺失细节。**最高支持片源分辨率 1920×1080**
- **智能插帧**：时域建模重构相邻帧之间的帧，低帧率→高帧率
- **音频降噪**：智能去除音频噪声

**增强档位**（[官方文档] docs/4/117971）：标准版 / 专业版 / **极速版**（集成轻量级超分与画质增强，速度优先）。
**增强强度**（仅标准版/专业版，极速版不支持，[官方文档] [docs/4/1578688](https://www.volcengine.com/docs/4/1578688)，UpdatedTime `2026-09-01T08:53:10Z`）：自然版（更柔和，减少"油画感"，适合 AI 生成拟人视频）/ 高清版（更锐利）。
**色深**（仅专业版）：8 / 10 / 12 / 16 bit；10/12 bit 输出 H.265，16 bit 输出 FFV1 无损。

**预估处理时长 RTF（Real-Time Factor）**（[官方文档] docs/4/1578688）—— 对 libtv 的 SLA 设计很重要：

| 档位 | RTF | 条件 |
|---|---|---|
| 极速版（Fast） | 约 3～4 | 不涉及分片 |
| 标准版（Standard） | 约 6～10 | 源视频时长 > 20 秒 |
| （短源视频） | 约 22 | 源视频时长 ≤ 20 秒 |
| 专业版（Pro）- Medium | 约 25 | 输出分辨率 ≤ 1080P |
| 专业版（Pro）- Ultimate | 约 60 | 输出分辨率 ≥ 4K |

> 即：480p→1080p 用标准版，10 分钟成片约需 60～100 分钟处理时长；极速版约 30～40 分钟。

### 1.2 具体 API Action 名与调用形态

> **重点结论：VOD 侧不存在 `SubmitEnhanceTask` / `CreateEnhanceTask` 这类独立提交接口。**
> 该结论为**穷举级实证**：拉取 `getDocList?LibraryID=4`（VOD 全库 856 篇文档标题）逐个筛查，VOD 侧空前构建接口只有 `StartExecution`、`GetExecution`、`StartWorkflow`、`GetWorkflowExecution`、`GetWorkflowExecutionResult`、`Create/Update/Get/List/Delete TaskTemplate 与 WorkflowTemplate`；**全库不存在任何"提交画质增强任务"文档**。SDK `service/vod/config.go` 的 148 个 Action 中亦无此类 Action。
> 与 SDK 交叉验证一致：`service/vod/config.go` 里唯一含 "Enhance" 的 Action 是 **`DescribeVodEnhanceImageData`**（`Version=2023-07-01`，GET），它只是**用量统计**，不是任务提交。

**提交入口 A：`StartExecution`（新，推荐，单任务/单模板）**

- 请求：`POST https://vod.volcengineapi.com?Action=StartExecution&Version=<见下方版本冲突>`
- 动态配置（免建模板）：`Operation.Type = Task`，`Operation.Task.Type = Enhance`，`Operation.Task.Enhance = { Type: Moe, MoeEnhance: { Config, Target, VideoStrategy } }`
- 单模板：`Operation.Type = Template`，`Operation.Template.Type = Enhance`，`Operation.Template.Enhance.TemplateId = <控制台自建模板 ID>`
- 响应：`RunId`
- 查询结果：轮询 `GetExecution`（`Action=GetExecution`，传 `RunId`），产物路径 `Output.Task.Enhance` / `Output.Template.Enhance` → `TranscodeInfo.StoreUri`
- **约束：`StoreUri` 不能直接播放**，需自行拼接：`[Protocol]://[PlaybackDomain]/[FileName]`，其中 `PlaybackDomain` 必须先在点播空间**添加并配置加速域名**；若开了 URL 鉴权还需附 `auth_key`。

请求示例（[官方文档] [docs/4/2624029](https://www.volcengine.com/docs/4/2624029)，UpdatedTime `2026-09-01T08:36:13Z`）：

```json
POST https://vod.volcengineapi.com?Action=StartExecution&Version=2025-01-01
{
  "Input": { "Type": "Vid", "Vid": "your_aigc_video_vid" },
  "Operation": {
    "Type": "Task",
    "Task": {
      "Type": "Enhance",
      "Enhance": {
        "Type": "Moe",
        "MoeEnhance": {
          "Config": "aigc",
          "Target": { "Res": "4k", "Bitrate": 8000, "BitDepth": 10 },
          "VideoStrategy": { "RepairStrength": 0, "EnhanceLevel": "Pro" }
        }
      }
    }
  }
}
```

> ⚠️ **Version 冲突（官方文档自相矛盾，未能单方面裁决）**：
> - 服务端 API 参考 [docs/4/1477169](https://www.volcengine.com/docs/4/1477169)（`StartExecution`，Updated `2026-08-28`）→ **`Version=2023-07-01`**（该页 9 处均为 2023-07-01）
> - 服务端 API 参考 [docs/4/1477170](https://www.volcengine.com/docs/4/1477170)（`GetExecution`，Updated `2026-08-28`）→ **`Version=2023-07-01`**
> - 任务指南 [docs/4/2624029](https://www.volcengine.com/docs/4/2624029)（Updated `2026-09-01`）→ **`Version=2025-01-01`**
> - [docs/4/1582325](https://www.volcengine.com/docs/4/1582325)（`GetExecution`，Updated `2026-09-18`）→ **`Version=2025-01-01`**
>
> **实现建议：两套 Version 都做成可配置，先 2023-07-01，失败回退 2025-01-01；最终以 API Explorer 实测为准。** 这是本次调研唯一未能裁决的点。

**提交入口 B：`StartWorkflow`（旧/工作流）**

- `POST https://vod.volcengineapi.com?Action=StartWorkflow&Version=2020-08-01`
- 工作流模板里挂一个 `TranscodeActivity`，其 `Enhance` 字段填增强参数：SDK `service/vod/models/business/vod_workflow.pb.go:6234-6241` 定义 `TranscodeActivity_EnhanceParams{ TemplateId string // 任务模板Id; Version string // 版本，当前为volc }`
- 查询：`GetWorkflowExecutionResult`（`Version=2022-12-01`，[官方文档] [docs/4/174771](https://www.volcengine.com/docs/4/174771)，UpdatedTime `2026-09-24T09:55:56Z`）或 `GetWorkflowExecution`
- ⚠️ **`StartWorkflow` 路径需要工单开通白名单**（见 1.4）；`StartExecution` 不需要。**libtv 应优先用 `StartExecution`。**

**异步任务 + 轮询/回调：有。** 提交返回 `RunId`；两种获取结果方式：
1. **主动轮询** `GetExecution`（或 `GetWorkflowExecutionResult`），传入 `RunId`，`Status = Success` 后从 `Output` 解析。
2. **事件通知（回调）**：控制台配置[媒体处理任务执行完成事件](https://www.volcengine.com/docs/4/1283222)（工作流路径则是[工作流执行完成事件](https://www.volcengine.com/docs/4/4657)），任务结束后系统 POST 结果到你指定地址。

**QPS 限制**：`StartExecution` 单用户 **50 次/秒**；`GetWorkflowExecutionResult` 单用户 **50 次/秒**；`GetExecution` 查询**时间范围 30 天**。

### 1.3 模板 ID / 模板类型枚举值（可直接写成 Go 常量）

以下枚举均出自 [官方文档] [docs/4/1582325](https://www.volcengine.com/docs/4/1582325)（`GetExecution` 参考页，UpdatedTime `2026-09-18T14:33:01Z`）与 [docs/4/2624029](https://www.volcengine.com/docs/4/2624029)：

| 枚举路径 | 合法值 | 来源 |
|---|---|---|
| `Operation.Type` | `Task` \| `Template` \| `Workflow` | docs/4/1582325 |
| `Operation.Template.Type` | `TranscodeVideo` \| `ByteHD` \| `TranscodeAudio` \| **`Enhance`** | docs/4/1582325 |
| `Operation.Task.Type`（16 值） | `Highlight`, `AdAudit`, `AudioExtract`, `Vision`, `Asr`, `Storyline`, `Segment`, `Ocr`, `Erase`, **`Enhance`**, `FileDelete`, `VideoSummary`, `VideoUnderstanding`, `VideoMatting`, `FaceMosaic`, `Evaluation` | docs/4/1582325 |
| **`Enhance.Type`** | **`Custom`（默认）** \| **`Moe`**（场景化增强模型） | docs/4/1582325 |
| **`MoeEnhance.Config`（场景化预设模板）** | **`common`（通用）\|`ugc`\|`short_series`（短剧）\|`aigc`\|`old_film`（老片修复）** | docs/4/2624029、docs/4/1582325 |
| **`VolcEnhanceParam.Type`（Custom 原子算子）** | **`SR`（智能超分）\|`VFI`（智能插帧）\|`SDREnhance`（SDR增强）\|`SDR2HDR`\|`AudioDenoise`（音频降噪）** | docs/4/1582325 + [SDK 源码] `service/vod/models/request/request_vod.pb.go:11623`（注释原文：「类型：默认全部。SR（智能超分），VFI（插帧），SDREnhance（SDR增强），SDR2HDR（SDR 转 HDR），AudioDenoise（音频降噪）」） |
| **`EnhanceLevel`（增强档位）** | **`Fast`（极速版）\|`Standard`（标准版）\|`Pro`（专业版）** | docs/4/2624029 |
| `RepairStrength`（增强强度） | 文档仅列 `-50`（轻度高保真）、`0`（中等） | docs/4/2624029 |
| `Target.Res` | `240p`/`360p`/`480p`/`540p`/`720p`/`1080p`/`2k`/`4k`/`6k`/`8k` | docs/4/2624029 |
| `Target.ResLimit`（短边像素） | `[128, 4320]` | docs/4/1582325 |
| `Target.Fps` | `(0, 120]` | docs/4/1582325 |
| `Target.Bitrate` | `[10, 50000]`（Kbps） | docs/4/1582325 |
| `Target.BitDepth` | `8`（默认）\| `10` \| `12` \| `16`（**仅专业版**） | docs/4/2624029 |
| **VOD 工作流 `Activity.Type`** | **`Transcode` \| `Snapshot` \| `End`** | [SDK 源码] `service/vod/models/business/vod_workflow.pb.go:4083` 注释原文「任务类型，支持Transcode｜Snapshot｜End」（**文档未列完整枚举**，此为 SDK proto 注释） |

**模板 ID 是"用户自建"还是"官方预置"？**
- **必须用户自建**。控制台：媒体处理 > 媒体处理模板 > **画质增强修复模板** > 创建，保存后记录**模板 ID**（[官方文档] docs/4/2624029）。
- **官方未发布任何预置 TemplateId**；文档示例中的 ID 被掩码为 `ddc7d66386***6056a`。
- 其他相关模板文档（均在 LibraryID=4）：`117971 画质增强修复模板`、`75243 检测修复模板`、`65681 媒体处理模板概述`、`65682 视频转码模板`、`165177 极智超清模板`。**不存在**名为「音视频增强模板」的独立文档。

> ⚠️ **不要混用另一套 API**：旧版 `CreateTaskTemplate` 的 `TaskType` 枚举是 `TranscodeVideo|ByteHD|TranscodeAudio|Snapshot`（[SDK 源码] `request_vod.pb.go:4867` 注释原文），**不含 Enhance**。这是与 `StartExecution` 不同的另一套体系。

### 1.4 输入限制与开通前置

**输入限制（画质增强）**：

| 限制项 | 值 | 来源 |
|---|---|---|
| **片源分辨率上限** | **不超过 1080p；片源短边最大支持 1081 px** | [官方文档] [docs/4/65675](https://www.volcengine.com/docs/4/65675) 工作流文档原文 |
| 智能超分片源上限 | 最高支持片源分辨率 1920×1080 | docs/4/117971 |
| 输出分辨率档位 | 与源一致 / 720p、1080p、2K、4K 预设 / 自定义目标宽度（等比缩放高度） | docs/4/117971 |
| 输出帧率 | 可自定义 **1～120**；**若设置帧率高于原片，将自动启用智能插帧** | docs/4/117971 |
| 目标码率 | `[10, 50000]`；实际输出在目标的 **0.8～1.5 倍**范围浮动 | docs/4/117971 |
| 16 bit 色深 | 输入视频**时长不得超过 40 秒**；FFV1 无损；**单任务串行**处理 | docs/4/1578688 |
| 组合约束 | 「结果独立存储」关闭时，必须至少选择一个视频转码/音频转码/极智超清任务；**画质增强任务与自定义转码组只能同时存在一个** | docs/4/65675 |

> ✅ **对 libtv 的关键结论：480p 成片完全在 VOD 画质增强的片源限制内（480p 短边 480 ≤ 1081）。**
> ✅ **24/30 → 60fps 只需把 `Target.Fps` 设为 60，系统会自动启用智能插帧，无需显式开 VFI算子。**

**开通前置条件**：
- 注册火山引擎账号 → 完成**实名认证**（[docs/4/64935](https://www.volcengine.com/docs/4/64935)：购买/使用云资源需先完成实名认证，分个人/企业两类）→ **开通视频点播服务** → 创建空间 → 上传视频（[官方文档] docs/4/2624029 前提条件原文）。
- 开通 VOD 时**无需单独开通媒资管理、视频分发功能**，选择默认计费方式即可涵盖媒资管理、视频分发、媒体处理等服务（[官方文档] [docs/4/108892](https://www.volcengine.com/docs/4/108892)，UpdatedTime `2022-04-22T10:18:30Z`）。
- **白名单（需提工单）**：官方原文（[docs/4/1582324](https://www.volcengine.com/docs/4/1582324)，UpdatedTime `2026-09-18T08:01:50Z`）：
  > 「**开通白名单**：工作流任务、巨量广告预审、ASR 提取字幕、OCR 提取字幕、智能抠图为白名单功能。使用前请[提交工单]联系火山引擎技术支持团队申请开通。」
  → **画质增强本身不在白名单内**；但**走 `StartWorkflow`（工作流任务）需要工单开通，走 `StartExecution` 不需要**。
- **免费额度：有，但明确"不能用于画质增强"。**（[官方文档] [docs/4/76544](https://www.volcengine.com/docs/4/76544)，UpdatedTime `2026-09-15`）
  新用户首次开通 VOD 的免费试用礼包：
  | 项 | 额度 | 是否可用于画质增强 |
  |---|---|---|
  | 视频存储 | **50 GB** | 不适用 |
  | 转码处理 | **300 分钟** | ❌ **官方明列不可抵扣范围含「场景式/自定义画质增强、AI 视频翻译、视频剪辑、精细化字幕擦除」**——300 分钟**仅抵扣标准转码与极智超清** |
  | CDN 分发流量 | **10 GB** | 不适用 |

  → **结论：libtv 的 480p→1080p 清晰化，VOD 侧免费额度为零，必须按量付费或买资源包。**
  另有**企业用户专享**的特惠体验资源包（限购 1 份，[docs/4/1159040](https://www.volcengine.com/docs/4/1159040)，UpdatedTime `2024-11-18`）：单月 100 元 = 1TB 流量 + 100GB 存储 + 1000 分钟转码（3.4 折）；1 年 199 元 = 基础版播放器 + 赠送上述三包 —— **同样是转码分钟数，不能用于超分**。
  另有 `1395835 播放器 SDK 计费` 提到可申请 1 个月免费测试 License（与清晰化无关）。

### 1.5 计价（VOD 画质增强）★核心数字

**计费文档**：[官方定价文档] [docs/4/1941013](https://www.volcengine.com/docs/4/1941013) 《媒体处理计费》，UpdatedTime `2026-09-15T02:35:33Z`。
视频点播价格计算器：`https://www.volcengine.com/pricing?product=vod&tab=2`。

**计费口径**：**按"输出文件的时长"计费（元/分钟）**，触发分辨率/帧率换算系数；**不是按调用次数**。底层以毫秒计量，账单换算为分钟（如 90 秒 = 1.5 分钟）。

#### A. 场景式画质增强（对应控制台的场景预设模板）

基础单价（"720P, ≤ 30fps"规格的基础计费单元，**单位：元/分钟**）：

| 计费项 | 中国内地·正常任务 | 中国内地·闲时任务 | 亚太东南（柔佛）·正常任务 |
|---|---|---|---|
| 画质增强（对应**极速版**） | **0.2** | 0.06 | 0.2 |
| 画质增强（对应**标准版**） | **0.75** | 0.225 | 0.75 |
| 画质重生（对应**专业版**） | **7.5** | 2.25 | 7.5 |

> 换算后单价（元/分钟）关键档位（正常任务 / 闲时任务）：

| 档位 | 720P ≤30fps | 720P 30–60fps | **1080P ≤30fps** | **1080P 30–60fps** | 1080P 60–120fps | 2K ≤30fps | 4K ≤30fps |
|---|---|---|---|---|---|---|---|
| **极速版** | 0.2 / 0.06 | 0.4 / 0.12 | **0.4 / 0.12** | **0.8 / 0.24** | 1.6 / 0.48 | 0.8 / 0.24 | 1.6 / 0.48 |
| **标准版** | 0.75 / 0.225 | 1.5 / 0.45 | **1.5 / 0.45** | **3 / 0.9** | 6 / 1.8 | 3 / 0.9 | 6 / 1.8 |
| **专业版（画质重生）** | 7.5 / 2.25 | 15 / 4.5 | **15 / 4.5** | **30 / 9** | 60 / 18 | 30 / 9 | 60 / 18 |

（8K 60–120fps 上限：极速版 25.6、标准版 96、专业版 960 元/分钟，正常任务。）
计费公式：`画质增强费用 = 输出文件时长 × 基础单价 × 计费换算系数`。
官方计费示例原文：「用户 A 使用画质增强模型，输出一个 10 分钟、1080P、60fps 的视频，且为正常任务。画质增强费用 = 10 × 0.75 × 4 = 30（元）」。

#### B. 自定义画质增强（独立原子算子，按输出时长）

**这一组是"超分/插帧"最直接的单价**（**单位：元/分钟**，与分辨率档位无关）：

| 计费项 | 中国内地·正常任务 | 中国内地·闲时任务 | 亚太东南（柔佛）·正常任务 |
|---|---|---|---|
| **智能超分（SR）** | **8** | 2.4 | 7.5 |
| **智能插帧（VFI）** | **2.7** | 0.81 | 2.7 |
| SDRToHDR | 1 | 0.3 | 1 |
| SDR 增强 | 0.5 | 0.15 | 0.5 |
| 音频降噪 | 0.1 | 0.03 | 0.1 |

计费公式：`画质增强费用 = 输出文件时长 × 单价`。
官方示例原文：「假设用户 A 使用智能超分功能，同时开启闲时任务，处理视频文件 100 分钟。智能超分费用 = 2.4 × 100 = 240（元）」。

> 🚨 **重要限制：自定义画质增强 = 旧版，新的场景化系统已不再支持创建该模板。**
> 官方原文（[docs/4/1578688](https://www.volcengine.com/docs/4/1578688)，UpdatedTime `2026-09-01T08:53:10Z`，`MDContent` 逐字核对）：
> > 「**自定义增强（旧版）**：指此前手动组合智能超分、智能插帧等独立算子的增强方式。**新的场景化系统已不再支持创建新的自定义增强模板**，此处仅作旧版说明保留。」
>
> 即：**上表（智能超分 8 元/分钟、智能插帧 2.7 元/分钟）仅对已存在的旧版模板/老客户保留，新客户能否下单未证实**。同时 [docs/4/117971](https://www.volcengine.com/docs/4/117971)（UpdatedTime `2026-09-07`）**仍把「自定义增强」列为可选预设模板** —— **两页互相矛盾**。
> ✅ **采购结论：不要把 8 元/分钟当作 libtv 的默认报价，应使用「场景式画质增强」的价格（标准版 0.75～3 元/分钟，已内置超分+插帧+去噪）。**

**帧率档位调整公告**（[官方公告 docs/4/2552696](https://www.volcengine.com/docs/4/2552696)，UpdatedTime `2026-06-26`）：**2026-07-01 起**新增 6K/8K 档位；帧率档位由 2 档（15–30 / 31–120 FPS）**改为 3 档（15–30 / 31–60 / 61–120 FPS）**。→ 本报告采用的即为 3 档新口径；**不要把 2026-07-01 之前的账单直接与本文数字对比**。

#### C. VOD 资源包（预付费，可显著降低上述单价）★

[官方文档] [docs/4/76544](https://www.volcengine.com/docs/4/76544)（UpdatedTime `2026-09-15`）：

**媒体处理时长资源包** —— 官方明列**可抵扣「标准转码、极智超清、场景式画质增强、自定义画质增强、视频剪辑」**：

| 有效期 | 档位 | 价格 | 折扣 |
|---|---|---|---|
| 12 个月 | 5 千分钟 | **86 元** | 7.9 折 |
| 12 个月 | 2 万分钟 | **303 元** | 7.0 折 |
| 12 个月 | 10 万分钟 | **1,475 元** | 6.8 折 |
| 12 个月 | **50 万分钟** | **4,882 元** | **4.5 折** |
| 1 个月 | 5 千分钟 | 73 元 | 6.7 折 |
| 1 个月 | 2 万分钟 | 257 元 | 5.9 折 |
| 1 个月 | 10 万分钟 | 1,253 元 | 5.8 折 |

- **抵扣基准单元 = 标准转码-H.264-480P（比例 1:1）**，按「实际处理时长 × 抵扣比例」扣减。
- ⚠️ **仅正常任务可抵扣，闲时任务不可抵扣**。
- 有效期 7 天内未使用可全额退款；**资源包不自动停止服务**，额度用尽自动转按量。
- 其他包：存储包 100 GB **99 元** / 1 TB **999 元**（12 个月）；音频转码包 30 万分钟 1,176 元、100 万分钟 3,360 元。
- 🌍 **地域限制：亚太东南（柔佛）地域仅针对企业用户开放**。

> 💡 **算钱示例（libtv 场景）**：3 分钟/集的 480p 漫剧短剧，输出 1080p@30fps 用标准版 = `3 × 1.5 = 4.5 元/集`；若用 12 个月 50 万分钟包（4.5 折）等效 ≈ **2.0 元/集**。输出 1080p@60fps = `3 × 3 = 9 元/集`（折后 ≈ 4.1 元/集）。转码另计（1080P H.264 0.0651 元/分钟 ≈ 0.2 元/集，可忽略）。

#### D. 同文档内的其他相关单价（供量级参考，明确标注非超分价）

| 计费项 | 中国内地正常 / 闲时（元/分钟） |
|---|---|
| 标准转码 H.264 1080P | 0.0651 / 0.01953 |
| 标准转码 H.264 720P | 0.0326 / 0.00978 |
| 标准转码 H.264 480P | 0.0217 / 0.00651 |
| 极智超清 H.264 1080P | 0.1953 / 0.05859 |
| 极智超清 H.264 720P | 0.0981 / 0.02943 |
| 画质检测 VQScore | 0.1（按片源时长） |
| 精细化字幕擦除 | 4（按输出时长） |
| 智能抠图 | 基础 1 元/分钟（720p 及以下，按输出时长×分辨率抵扣系数） |
| 视频人脸打码 | 0.1 |
| 高光分析 | 2.5 |
| 故事线分析 | 1 |
| 场景切分 | 0.2 |

**地域**：**中国内地**与**亚太东南（柔佛）**两列均有价；官方原文「亚太东南（柔佛）正常任务的换算后单价与中国内地正常任务一致」（仅智能超分柔佛为 7.5 略低于内地 8）。

---

### 1.6 验收用的「无参考画质评分 / 媒体质检」——**有**（对应腾讯云媒体质检的同类能力）

> 父任务问到「火山是否提供无参考画质评分/媒体质检类接口用于验收」——**答案是明确的"有"**。

**VQScore（Video Quality Score）是火山自研的无参考视频质量评价算法**（[官方文档] [docs/4/337732](https://www.volcengine.com/docs/4/337732)，UpdatedTime `2026-09-15T02:36:25Z`）。官方原文：

> 「VQScore（Video Quality Score）是火山引擎研发的**无参考**视频质量评价算法，用于评估视频和图像的视觉质量。**相较于需要参考视频的算法如 PSNR、SSIM、VMAF，VQScore 可以独立对输入的视频和图像进行评分，无需参考视频**，直接模拟人类对视频的视觉感受。」

**评分区间**（官方原文）：0～60 主观感受较差；60～70 主观感受良好；70～100 主观感受清晰。

**官方适用场景**（含"监督画质提升算法"——正合 libtv 验收需求）：辅助推荐（低清打压）、PGC/UGC 内容研究、**识别伪高清视频（规避分辨率欺骗）**、监控画质检测评分。

| 入口 | 形式 | 单价 | 来源 |
|---|---|---|---|
| **VOD**：`StartExecution` 提交无参考画质检测任务 | 异步；**接口 QPS 50 次/秒**；**仅支持 VOD SDK 2.0 调用** | **0.1 元/分钟**（按**片源/输出文件时长**计费，**不区分分辨率**；**暂不支持资源包抵扣**） | [docs/4/2684648](https://www.volcengine.com/docs/4/2684648)、[docs/4/337732](https://www.volcengine.com/docs/4/337732)、[docs/4/1941013](https://www.volcengine.com/docs/4/1941013) |
| **VOD 工作流**：检测修复模板 + 工作流节点 | 控制台配模板 → 挂工作流 | 同上 | docs/4/337732、[docs/4/75243](https://www.volcengine.com/docs/4/75243) |
| **AI MediaKit**：`POST https://mediakit.cn-beijing.volces.com/api/v1/tools/assess-video-quality` | **异步**（返回 `task_id`，轮询 `/api/v1/tasks/{task_id}` 或事件回调）；输入**最高支持 4K (3840×2160)**；支持公网 URL / `mediakit://` / `vod://` / `tos://` | 见 docs/6448/2486473（视频工具计费中「视频画质检测 VQScore」**0.1 元/分钟**，按输入时长） | [docs/6448/2515374](https://www.volcengine.com/docs/6448/2515374)、[docs/6448/2505580](https://www.volcengine.com/docs/6448/2505580) |
| 控制台看板 | 「智能处理」控制台创建含画质检测修复节点的转码工作流 → VOD 控制台**转码看板**查看 **VQScore、PSNR** 等多指标 | — | [docs/4/79166](https://www.volcengine.com/docs/4/79166) |

**相关但更进一步的能力**：
- **画质检测修复**（[docs/4/76318](https://www.volcengine.com/docs/4/76318)）：支持**无参考/有参考多维度质量评分**，并可**检测并修复黑帧、水波纹等问题**（控制台建模板 → 挂工作流）。
- **检测修复模板**（[docs/4/75243](https://www.volcengine.com/docs/4/75243)）+ **任务节点输出定义**（[docs/4/106885](https://www.volcengine.com/docs/4/106885)，覆盖基础转码、画质检测、精细化去水印、精彩剪辑、视频DNA 五类节点的输出参数）。
- **图像侧**：`图像画质评估` / `提交图像画质评估任务 API`（AI MediaKit，图像工具计费中「图像画质评估」基准 1.38 元/千次）；veImageX 有「画质评估」1.38 元/千次与「大模型画质评估」41.4 元/千次。

> 💡 **对 libtv 的验收建议**：清晰化前后各跑一次 **VQScore**（0.1 元/分钟，3 分钟成片 ≈ 0.3 元/次），用「评分是否从 <60 进到 >70」作为自动化验收门槛；配合「识别伪高清」能力防止超分只做插值不做细节重建。

## 2. 智能媒体处理 / AI MediaKit（**独立售卖，且是本次调研中最贴合 libtv 的产品**）

### 2.1 产品定位与是否单独售卖

**是，独立售卖，独立计费、独立控制台、独立 API Key——与 VOD 画质增强是两套不同的东西。**

- 文档库：**LibraryID=6448，LibraryCode=`Intelligentprocessing`**（产品名 **AI MediaKit**，前身/旧版为「智能处理 IMP」）。
- 定位原文（[官方文档] [docs/6448/2222230](https://www.volcengine.com/docs/6448/2222230)，UpdatedTime `2026-09-01T07:52:59Z`）：
  > 「AI MediaKit 是火山引擎视频云面向 AI 云原生时代推出的智能多媒体工具集。它将视频云成熟的媒体处理技术解构为细粒度的原子能力…目前 AI MediaKit 已上线以下原子工具。」
- **服务域名：`mediakit.cn-beijing.volces.com`**（华北2-北京，**大陆节点**；资源包文档明确「AI MediaKit 资源包目前支持的服务地域为**国内通用**」）。
- 官方列出的应用场景包含 **「AI 漫剧制作」**：「完成从漫画素材到视频合成、配音对齐、字幕添加、**视频超分增强**的全流程，实现内容生产的半自动化或全自动化。」——**这正是 libtv 的场景**。
- 鉴权方式（[官方文档] [docs/6448/2300661](https://www.volcengine.com/docs/6448/2300661)，UpdatedTime `2026-08-27T03:00:35Z`）：**`Authorization: Bearer {Your_API_Key}`**，**不是 AK/SK 签名**。支持两种 Key：通用 API Key（IAM 控制台创建，全部支持 API Key 的服务通用）/ 专用 API Key（AI MediaKit 控制台创建）。

### 2.2 能力/接口名一览（全部为 REST 端点 + JSON，非 RPC Action）

| 能力 | 接口（POST） | 说明 |
|---|---|---|
| **画质增强（标准版/专业版）** | `https://mediakit.cn-beijing.volces.com/api/v1/tools/enhance-video` | 核心接口。异步 |
| 画质增强（极速版） | `/api/v1/tools/enhance-video-fast` | 「集成了轻量级超分与智能画质增强能力，采用速度优先的算法策略」 |
| 画质增强（大模型版） | `/api/v1/tools/enhance-video-generative` | 「基于 Diffusion 扩散大模型技术，提供生成式视频增强与修复能力…修复压缩或老化损失的像素，智能补全生成符合视频内容的真实细节」 |
| **视频插帧** | `/api/v1/tools/video-frame-interpolation` | 「基于深度学习的智能补帧，在相邻帧之间生成过渡帧」 |
| 视频流畅度提升 | `/api/v1/tools/enhance-video-smoothness` | 检测周期性卡顿/重复帧并修复（光流、运动矢量） |
| 极智超清（转码向） | `/api/v1/tools/martencode-video` | 智能分析场景/动作/内容/纹理选最优编码参数，低码率下主观画质更优 |
| 画质检测 VQScore | `/api/v1/tools/video-vqscore`（文档 `2515374`） | 用量/评估 |
| **查询任务** | `GET /api/v1/tasks/{task_id}` | 统一查询所有异步任务 |
| 图像画质增强 | 见 2.5 | **图片，非视频** |

来源：[官方文档] [docs/6448/2279230](https://www.volcengine.com/docs/6448/2279230)、`2487478`、`2464595`、`2624391`、`2702305`、`2515358`、`2278532`。

### 2.3 调用形态（异步 + 轮询/回调）

**异步任务模型**（[官方文档] docs/6448/2300661）：
1. **提交**：`POST` 具体工具接口 → 立即返回全局唯一 `task_id`（如 `amk-tool-enhance-video-1703200`）+ `request_id`
2. **查询**：轮询 `GET /api/v1/tasks/{task_id}`，`status` 枚举 `running` / `completed` / `failed`（另文档正文提到 `processing` 字样）
3. **取结果**：`status=completed` 时 `result` 字段含 `video_url`
   - 默认返回 **HTTPS 临时下载链接，有效期 24 小时**（务必及时下载）
   - 若设置 `media_output_destination`，则返回 `vod://<空间名>/<媒资ID>` 或 `tos://<桶名>/<对象Key>`
4. **事件回调（替代轮询）**：控制台预配全局回调 URL，或提交时用 `callback_url` 单次覆盖（优先级更高）；`callback_args` 原样回传（≤512 字节）
5. **幂等**：所有异步提交接口默认幂等（24 小时内相同账号+核心参数的请求返回同一 `task_id`）；可用 `client_token` 主动控制

**任务结果有效期**：默认保留 24 小时；`GET /api/v1/tasks/{task_id}` 在剩余有效期不足 2 小时时调用会**自动续期**。**查询范围自 2026-08-20 起仅支持 30 天内创建的任务**（[docs/6448/2636768](https://www.volcengine.com/docs/6448/2636768)）。

**QPS 限制**（[官方文档] docs/6448/2300661）：异步任务按账号维度**全局限流，默认总上限 40 QPS**（主账号及所有子账号合并计算）；同步工具（图像类）独立限流，图像画质增强等多为 **2 QPS**。超出默认配额需**联系客户经理或提工单**提升。另有「任务并发数限制」（见项目与队列管理）。

### 2.4 输入限制（分版本）

| 版本 | 输入分辨率上限 | 短边范围 | 长边范围 | 文件大小 | 输出 resolution 可选 |
|---|---|---|---|---|---|
| **标准版 / 专业版** | **最高 2K** | `[360, 1440]` | `[360, 2560]` | 建议 ≤ **10 GB** | `240p/360p/480p/540p/720p/1080p/2k/4k/6k/8k` |
| 极速版 | 最高 2K | `[360, 1440]` | `[360, 2560]` | 建议 ≤ 10 GB | 同上（`resolution_limit` 范围 `[128,2160]`） |
| **大模型版** | **最高 1080p** | `[360, 1080]` | `[360, 1920]` | — | **仅 `720p` / `1080p`**（错误示例原文：`Parameter 'resolution' must be one of [720p, 1080p]`） |

**通用参数（标准/专业版 `enhance-video`）**（[官方文档] docs/6448/2279230）：

| 参数 | 必选 | 取值/说明 |
|---|---|---|
| `video_url` | 是 | 支持 **4 种输入协议**：公网 HTTP/HTTPS、本地上传 `mediakit://`、火山 VOD `vod://`、火山 TOS `tos://`。支持 mp4/flv/ts/avi/mov/wmv/mkv 等 |
| `tool_version` | 否 | `standard`（默认，内置 10 余种增强算法）/ `professional`（内置 30 余种深度 AI 算法，保障镜头级画质） |
| **`scene`** | 否 | **仅 `standard` 生效**。`common`（默认）/ `ugc` / **`short_series`（短剧）** / `aigc` / **`old_film`（老片修复）** |
| `enhance_style` | 否 | `hd`（默认，高清，锐利）/ `natural`（自然，锐化痕迹更少）。标准版与专业版均支持 |
| `resolution` | 否 | 目标分辨率档位（**超分到此规格**），与 `resolution_limit` **互斥** |
| `resolution_limit` | 否 | 目标短边像素 `[128, 4320]`，等比缩放 |
| `bitrate_level` | 否 | `low` / `medium`（默认）/ `high`；实际输出码率在目标值 **0.8～1.5 倍**浮动 |
| `bitrate` | 否 | 目标平均码率 kbps `[10, 150000]`；与 `bitrate_level` 同时指定时**仅 `bitrate` 生效** |
| `fps` | 否 | 目标帧率 `[15, 120]`；不填则保持原片帧率；**建议不超过原片的 4 倍** |
| `bit_depth` | 否 | 仅专业版。`8`（默认，H.264/H.265）/`10`（H.265、prores）/`12`（H.265）/`16`（FFV1、EXR，**输入时长≤40 秒，且单任务串行**） |
| `codec` | 否 | 仅专业版；指定时必须同时指定 `bit_depth`。`h264`/`h265`/`prores`/`ffv1`/`exr` |
| `media_output_destination` | 否 | `vod://<空间名>` 或 `tos://<桶名>`；**首次使用需在控制台"基础配置 > 授权管理"授权** |
| `client_token` | 否 | 幂等控制，≤64 个 ASCII 可打印字符 |
| `callback_url` / `callback_args` | 否 | 单任务回调 |
| `queue_id` | 否 | 目标队列，用于按队列分账 |

**插帧接口参数**（[官方文档] docs/6448/2624391，UpdatedTime `2026-08-06T13:17:52Z`）：`video_url`（必填）、`fps`（**必填**，`[15,120]`，建议不超过原片 4 倍；若目标帧率低于原片，系统先插帧再降帧）+ 上述通用可选参数。**插帧不改变分辨率，跟随原片**。

**视频流畅度提升参数**（[官方文档] docs/6448/2702305，UpdatedTime `2026-09-30T04:32:13Z`）：默认同时开启周期性卡顿检测与重复帧检测**并自动修复**；`periodic_stutter_detect{ periodic_stutter_repair, align_source_fps }`、`duplicate_frame_detect`、`insert_frame_indices`（人工指定插帧位置，帧号从 0 开始）。

### 2.5 图片能力（**明确区分：这是图片，不是视频**）

AI MediaKit 也有**图像画质增强**（同步任务）：`提交图像画质增强任务 API`（文档 `2464630`）、`图像画质增强`（文档 `2407225`）。图像工具是**同步**任务模型（结果直接在 HTTP 响应体返回）。相关图像工具还有：图像画质评估、图像擦除修复、图像背景移除、图像智能裁剪、智能扩图、图像人脸打码、图像文字识别 OCR、图像翻译、集智瘦身、图像暗水印等。

### 2.6 计价（AI MediaKit）★核心数字

**计费文档**：[官方定价文档] [docs/6448/2486473](https://www.volcengine.com/docs/6448/2486473) 《视频工具计费》，UpdatedTime `2026-09-24T11:48:37Z`；[docs/6448/2486470](https://www.volcengine.com/docs/6448/2486470) 《图像工具计费》，UpdatedTime `2026-08-27T02:37:24Z`。

**通用规则（官方原文）**：
- **分辨率档位判定规则**：「输出视频的分辨率规格是根据其**短边**的像素值来判定的。…一个分辨率为 1920x800 的视频，其短边为 800 像素。因为该值大于 720P 规格的短边（720），但小于等于 1080P 规格的短边（1080），所以该视频将被归入 1080P 档位进行计费。」
- **毫秒级计费**：「以'元/分钟'为单位报价，但底层会精确到毫秒来记录实际使用时长。」
- 付费方式：按量计费（后付费）**或资源包（预付费）**。所有用户默认按量计费。结算周期：按日（次日 18:00 结算）/ 按月（次月 2 号）。

#### 画质增强（按**输出时长**计费，基准单价 + 系数折算）

| 版本 | 基准单价 | 720P ≤30fps | 720P 30–60fps | **1080P ≤30fps** | **1080P 30–60fps** | 1080P 60–120fps | 2K ≤30fps | 4K ≤30fps |
|---|---|---|---|---|---|---|---|---|
| **极速版** | **0.2 元/分钟** | 0.2 | 0.4 | **0.4** | **0.8** | 1.6 | 0.8 | 1.6 |
| **标准版** | **0.75 元/分钟** | 0.75 | 1.5 | **1.5** | **3** | 6 | 3 | 6 |
| **专业版** | 同基准 0.75 元/分钟，系数×10 | 7.5 | 15 | **15** | **30** | 60 | 30 | 60 |
| **大模型版** | **2.5 元/分钟** | 2.5 | 5 | **5** | **10** | 20 | 10 | 20 |

（单位：元/分钟，换算后单价。6K/8K 更高：标准版 8K 60–120fps = 96；专业版 8K 60–120fps = 960；大模型版 4K 60–120fps = 80。极速版最高档 4K 60–120fps = 6.4。）

官方计费示例原文：
- 标准版：「10 分钟 × 2 × 0.75 元/分钟 = 15 元」（1080P/25fps）
- 专业版：「10 分钟 × 20 × 0.75 元/分钟 = 150 元」（1080P/25fps）
- 极速版：「10 分钟 × 4 × 0.2 元/分钟 = 8 元」（1080P/60fps）
- 大模型版：「10 分钟 × 2 × 2.5 元/分钟 = 50 元」（1080P/25fps）

#### 视频插帧（按**输出时长**计费，基准 0.6 元/分钟）

| 输出分辨率 | 输出帧率 | 计费换算系数 | 换算后单价（元/分钟） |
|---|---|---|---|
| 720P 及以下 | ≤ 30fps | 1 | 0.6 |
| | >30 且 ≤60fps | 2 | 1.2 |
| | >60 且 ≤120fps | 4 | 2.4 |
| **1080P 及以下** | ≤ 30fps | 2 | **1.2** |
| | **>30 且 ≤60fps** | 4 | **2.4** |
| | >60 且 ≤120fps | 8 | 4.8 |
| 2K 及以下 | ≤30 / 30–60 / 60–120 | 4 / 8 / 16 | 2.4 / 4.8 / 9.6 |
| 4K 及以下 | ≤30 / 30–60 / 60–120 | 8 / 16 / 32 | 4.8 / 9.6 / 19.2 |

公式：`视频插帧费用 = 输出文件时长（分钟）× 计费换算系数 × 0.6 元/分钟`。官方示例：「10 分钟 × 4 × 0.6 = 24 元」（1080P/60fps）。

#### 视频流畅度提升（按**输入时长**计费，基准 0.1 元/分钟）

| 处理模式 | 计费换算系数 | 换算后单价（元/分钟） |
|---|---|---|
| 仅检测 | 1 | 0.1 |
| **检测并修复** | 10 | **1** |

判定规则（官方原文）：**只要任务最终成功输出了修复后的视频（返回了 `video_url`）即按"检测并修复"计费**，包括算法检测到周期性卡顿/重复帧并修复，或用户通过 `insert_frame_indices` 人工指定插帧；未输出产物视频则按"仅检测"计费。

#### 极智超清（按**输出时长**计费，基准 0.032 元/分钟）

| 编码 | 480P 及以下 | 720P 及以下 | 1080P 及以下 | 2K | 4K |
|---|---|---|---|---|---|
| H.264 | 0.064 | 0.096 | 0.192 | 0.42 | 0.84 |
| H.265 | 0.32 | 0.48 | 0.96 | 2.1 | 4.2 |

（单位：元/分钟。注：AI MediaKit 的极智超清价与 VOD 侧极智超清价不同，属两套产品。）

#### 图像画质增强（**图片！** 按**成功处理次数**计费）

- 计费单元「图像工具-画质增强-计费次数」，**基准单价 6 元/千次**。
- 公式：`图像画质增强费用 =（成功处理次数 / 1000）× 计费换算系数 × 6 元/千次`
- 计费换算系数：**标准版 ×1 = 6 元/千次；专业版 ×6 = 36 元/千次（= 0.036 元/张）；大模型增强版 ×40 = 240 元/千次（= 0.24 元/张）**
- 官方示例：「使用图像画质增强工具（专业版）成功处理了 100 张图片。费用：(100/1000) × 6 × 6 = 3.6 元」
- 另有「图像画质评估」基准 **1.38 元/千次**（可按标准版/专业版系数折算）。

#### 其他 AI MediaKit 单价（量级参考，非超分价）

| 工具 | 单价 |
|---|---|
| 视频转码 / 转封装 | 见文档（按输出时长×编码/分辨率系数） |
| 字幕擦除（精细化版） | 1 元/分钟（基准）；标准版换算 0.4 |
| 智能抠图（视频人像抠图） | 1 元/分钟 × 分辨率系数（4K 系数 4 → 4 元/分钟） |
| 视频人脸打码 | 0.1 元/分钟 |
| 视频人脸融合（换脸） | 0.8 元/分钟 |
| 视频口型对齐 | 1 元/分钟 |
| 高光片段提取 | 1 元/分钟 |
| 剧情故事线分析 | 1 元/分钟 |
| 剧本还原 | 3 元/分钟 |
| 大模型高光剪辑 | 0.8 元/分钟 |
| 解说视频生成 | 0.39 元/分钟 |
| 视频横转竖 | 0.3 元/分钟 |
| 场景切分 | 0.02 元/分钟 |
| 语音转字幕（ASR） | 0.03 元/分钟 |
| 视频识别字幕（OCR） | 0.25 元/分钟 |
| 视频画质检测 VQScore | 0.1 元/分钟 |
| 视频抽帧 | 0.1 元/千次 |
| 视频理解智能策略 | 0.01 元/分钟（×scene 系数，editing 场景系数 20） |
| 视频元信息获取 | 0.1 元/千次 |

**资源包（预付费）**（[官方定价文档] [docs/6448/2533606](https://www.volcengine.com/docs/6448/2533606)，UpdatedTime `2026-08-10T08:30:16Z`）：
- **以「字幕擦除（精细化版）」（1 元/分钟）为定价基准**，其他工具按**抵扣系数**折算成等价值分钟数抵扣。抵扣公式：`扣除资源包额度（分钟）= 实际使用量 × 抵扣系数`；画质增强这类受分辨率/帧率影响的工具再乘「计费换算系数」：`最终抵扣额度 = 输出文件时长 × 工具抵扣系数 × 计费换算系数`。
- 官方示例：画质增强（大模型）1080P/25fps/10 分钟 → `10 × 2.5 × 2 = 50` 分钟额度。即**抵扣系数 = 该工具的基准单价（元/分钟）**（画质增强标准/专业版 0.75、大模型版 2.5、极速版 0.2、字幕擦除 1）。
- **档位与价格**：**10 分钟 8 元 / 100 分钟 80 元 / 1,000 分钟 800 元 / 1 万分钟 8,000 元，一律 8.0 折**。
- 有效期 **12 个月**；购买起 **7 天内未使用可全额退款**；支持叠加，**先到期先抵扣**；超量自动转按量计费；**仅支持国内通用地域**。
- 官方提示：「提供**免费额度**的图像基础编辑工具（即基于计费单元'图像工具-基础处理-计费处理量'计费的工具）不支持使用资源包抵扣」——即免费额度**只存在于部分图像基础编辑工具**。
- > 💡 **折扣力度对比：AI MediaKit 资源包固定 8.0 折，而 VOD 媒体处理时长资源包最低可到 4.5 折。若用量大，VOD 路线更省钱。**

**并发与配额**（[docs/6448/2519520](https://www.volcengine.com/docs/6448/2519520)，UpdatedTime `2026-08-26`）：**异步任务并发上限为账号维度默认 20，可提工单扩容**；同步任务（图像工具）不受并发限制，走各自 API QPS（图像画质增强 2 QPS）。

**免费额度：未证实。** 在 docs/6448/2253924（计费说明）、2300661（准备工作）、2486470（图像工具计费）、2486473（视频工具计费）、2533606（资源包）、2222230（介绍）、2369811（常见问题）全文中均**未找到**「画质增强」的免费额度或试用额度明文（只有"资源包"与"QPS 额度"两种表述）。**倾向判断：画质增强类无免费额度，但官方未明文否定 → 记为未证实。**

**开通前置**：
- **不需要白名单/工单**：官方流程就是控制台「创建 API Key」→ 配置到环境变量（docs/6448/2300661）。原文只对**QPS 提额**要求工单：「如果您当前的业务需求超出了默认配额，请联系您的客户经理或提交工单申请提升额度」。
- **但需先开通服务 + 跨服务授权**（[docs/6448/100468](https://www.volcengine.com/docs/6448/100468)、[docs/6448/70274](https://www.volcengine.com/docs/6448/70274)，UpdatedTime `2023-07-27`）：① **完成实名认证** ② 控制台「产品和服务 > 视频云 > 智能处理」**一键开通**（约 20 秒）③ **跨服务授权**（勾选《产品和服务协议》《视频云服务专用条款》，**不勾选则按钮置灰**）。**该能力依赖视频点播，需同时开通 VOD。**
- **API Key 位置**：控制台 `/imp/ai-mediakit/settings`（AI MediaKit 专用 Key）或 IAM 控制台（通用 Key）。
- **欠费关停**（docs/6448/2253924）：欠费后 **72 小时**停止处理新任务、无法新建 API Key；关停后 **360 小时**（15 天）**资源回收**，计费实例销毁、配置清空且无法恢复；回收后「您必须**在控制台重新开通 AI MediaKit 服务**」。日结为**次日 18:00 出账**。
- **是否强制企业实名认证：未证实**（AI MediaKit 自身文档未见此表述；平台级要求是「购买、使用云资源需先完成实名认证」，分个人/企业两类，且**企业实名认证才能开通/购买更多云服务**，个人认证 1 主体最多 3 个账号、企业 10 个账号，见 [docs/6261/64935](https://www.volcengine.com/docs/6261/64935)、[docs/6261/64934](https://www.volcengine.com/docs/6261/64934)）。

---

## 3. veImageX —— 图片增强 / 超分（**明确：图片，不是视频**）

> ⚠️ **本节全部是图片能力，不能用于视频。** libtv 的视频清晰化不能靠 veImageX 完成（除非逐帧拆图再合成，工程与成本上不可行）。

**图片库**：LibraryID=508（veImageX）。**区域**：veImageX 在全球多个区域部署，每个区域有独立 OpenAPI 域名，**不支持跨区域调用**；SDK 默认区域为华北 `cn-north-1`（大陆节点）。

**接口（均为同步 POST，直接返回 `ResUri`，无 task_id/轮询）**：

| 能力 | 接口 | Version | 说明 |
|---|---|---|---|
| **图像超分辨率（云端）** | `POST https://imagex.volcengineapi.com/?Action=GetImageSuperResolutionResult` | **`2023-05-01`** | Body: `ServiceId`(必), `StoreUri`(必, 存储URI或公网URL), `Multiple`(超分倍率 `2`~`8`，默认 2)。返回 `ResUri` |
| 图像超分辨率（历史版） | 同 Action，`Version=2018-08-01` | 2018-08-01 | **文档已停止维护**，官方建议用新版 |
| **图像增强** | `Action=GetImageEnhanceResult` | `2018-08-01` | Param `Model`: 0 通用 / 1 低质专清 |
| **综合增强** | `Action=GetComprehensiveEnhanceImage` | `2023-05-01`（新版）/ 2018-08-01（历史版） | 指定服务 ID、原图地址及综合增强配置，可实现画质提升、超分、文字增强 |
| AIGC 大模型超分辨率 | 经 `AIProcess` / `CreateImageAITask` 调用 | — | 中低画质图去噪、去伪影、补纹理；可设超分倍率、目标宽高、模型版本 |

来源：[官方文档] [docs/508/1254829](https://www.volcengine.com/docs/508/1254829)（UpdatedTime `2025-07-28T08:13:17Z`）、docs/508/1254824、docs/508/113549、docs/508/1770787。

**输入限制**：
- **超分输出长或宽超过最大限制 4096 时，结果图按限制等比降级**。官方示例原文：「原图尺寸为 1080x1920，调用本接口执行 4 倍超分预计输出结果图尺寸为 4320x7680。但由于超出了最大限制 4096x4096，因此最终输出的结果图分辨率会被降级为 2304x4096。」
- **请求频率：单用户 5 次/秒**；**超时时间约 20 秒**。

**计价**：[官方定价文档] [docs/508/1262340](https://www.volcengine.com/docs/508/1262340) 《AI 能力组件计费说明》，UpdatedTime `2026-08-18T12:58:12Z`。
- 计费口径：**按成功请求次**计费，**不是按分钟**。基础单价 **0.069 元/千次**；`换算单价（元/千次）= 0.069 × 计费倍率`。
- 后付费，默认按日结算（可改按月，需联系商务）。

| 组件 | 模型 | 计费倍率 | **换算单价（元/千次）** |
|---|---|---|---|
| **图像超分辨率（云端）** | 超分普通模型 SR4x0 / SR4x3 / 超分增强模型 / 超分 VR 模型 | **40** | **2.76** |
| **画质增强** | 通用增强模型 / 低质专清模型 / 图像自适应增强 / 综合增强 | **90** | **6.21** |
| AIGC 大模型超分辨率 | gendr1.1 / gendr1.2 | 540 | 37.26 |
| 画质评估 | 画质评估 | 20 | 1.38 |
| 大模型画质评估 | 视觉质量评估大模型 | 600 | 41.4 |
| 图像修复 | 经典修复与擦除 / AIGC 擦除与修复 | 20 / 600 | 1.38 / 41.4 |
| 盲水印 | 各文本嵌入模型 | 20 | 1.38 |
| 智能裁剪 | 各裁剪模型 | 15 | 1.035 |

官方计费示例原文：「假设某日您总共成功调用了画质评估 OpenAPI 4000 次和画质增强 OpenAPI 1000 次。画质评估费用为 4000/1000 × 1.38 = 5.52 元；画质增强费用为 1000/1000 × 6.21 = 6.21 元」。

**开通前置**：
- **必须先在控制台开通「智能处理计费配置」**：登录 veImageX 控制台 → AI 能力组件 → **一键授权开通** → 跨服务访问请求页点「立即授权」→ 勾选协议 → 确定开通（[docs/508/1262340](https://www.volcengine.com/docs/508/1262340)）。
- 开通规则原文：「若您之前未开通过智能处理下的任一组件，则开通智能处理计费配置后，该模块下组件将**统一更改为开通状态**，并统一使用智能处理计费规则计费。」
- 退订条件：确保没有模板使用智能处理下任一组件。
- **免费额度：未证实**（该文档未提及免费额度）。

---

## 4. BytePlus（火山引擎海外品牌，`byteplus.com`）

> **检索方法发现（重要）**：BytePlus 文档站同样是 SPA，但**其 JSON 接口挂在 `www.byteplus.com` 而非 `docs.byteplus.com`**（`https://docs.byteplus.com/api/...` 返回 SPA 壳，不可用）：
> - 检索：`GET https://www.byteplus.com/api/search/openSearchNew?Query=<urlencoded>&Caller=doc&Did=1&Uid=0&UUID=1&UidType=14&PageSize=20&Page=1`
> - 取正文：`GET https://www.byteplus.com/api/doc/getDocDetail?DocumentID=<GID>&type=doc`
> - 列库：`GET https://www.byteplus.com/api/doc/getDocList?LibraryID=<lib>&type=doc`
>
> ⚠️ **已实测确认：BytePlus 文档站与火山国内站共用同一套 CMS/API，用 BytePlus 站检索英文关键词（如 `video enhancement`、`super resolution`）返回的仍是火山国内站的同一份中文文档（同一 `GID`，如 2279961 = AI MediaKit 画质增强，`FullContent` 为中文）。** 因此**不能**用「BytePlus 站搜到中文文档」来证明 BytePlus 没有英文能力，也不能据此认定有。
### 4.1 ⭐ 方法修正：BytePlus 有**独立的英文文档库**（616 篇）

> ⚠️ **先纠正一个容易误判的坑**：BytePlus 文档站（`docs.byteplus.com`）是 SPA，但其 JSON 接口挂在 **`www.byteplus.com`** 上；而**全局搜索接口 `openSearchNew` 索引的是与国内站共用的索引**，所以在 BytePlus 站搜英文词会返回**中文文档**（同一 `GID`）——**这并不代表 BytePlus 没有英文文档**。
>
> ✅ **正确做法：直接按 `LibraryCode` 枚举英文库**（不要用 `LibraryID` 过滤搜索，会被忽略）：
> ```bash
> GET https://www.byteplus.com/api/doc/getDocList?LibraryCode=byteplus-vod&type=doc
> ```
> **实测结果：`LibraryCode=byteplus-vod`（LibraryID=25，`Language=en`）共 616 篇**，`EnTitle` 与 `MDContent` **均为英文**。
> 取正文：`GET https://www.byteplus.com/api/doc/getDocDetail?DocumentID=<id>&type=doc` → 读 `Result.MDContent`（`?lang=en` / `x-language` 头对 `getDocDetail` 无影响，语言由文档本身决定）。

### 4.2 产品与能力：BytePlus 的增强能力叫 **vCube**，且与国内侧同源

英文文档原文（[BytePlus vCube upscaling and enhancement overview](https://www.byteplus.com/docs/byteplus-vod/27051)，DocumentID 27051，UpdatedTime `2026-09-17T06:42:25Z`）：

> 「The **vCube upscaling and enhancement** feature is an AI-driven solution for deep video quality optimization. It provides preset templates for **five core scenarios**: **general content**, **UGC short videos**, **AIGC content**, **short dramas**, and **classic film restoration**.」

→ **五个预设与国内侧完全一致**（`common`/`ugc`/`aigc`/`short_series`/`old_film`），且**"short dramas"（短剧）与"classic film restoration"（老片修复）在 BytePlus 侧同样存在**。
官方在线 Demo：`https://demo.byteplus.com/aiexp/video-enhance`（可上传自己的片子预览增强效果）。

其他英文能力文档（均在 `byteplus-vod` 库）：

| 文档 | DocumentID | UpdatedTime |
|---|---|---|
| vCube upscaling and enhancement overview | 27051 | 2026-09-17 |
| Video enhancement template | 7864 | 2026-09-15 |
| Enhancing video quality via the OpenAPI | 91006 | — |
| **Create a video quality enhancement task** | 108402 | — |
| Video quality enhancement (standard/professional) | 105948 | — |
| Video quality enhancement (fast) | 120015 | — |
| Create a video quality enhancement (fast) task | 120024 | — |
| **Video frame interpolation** / Create a video frame interpolation task | 120014 / 120025 | 2026-09-04 |
| Video smoothness enhancement / Create task | 121759 / 121760 | — |
| Image quality enhancement / Create task | 120276 / 120287 | 2026-09-11 |
| **Quickstart: Upscaling AI-generated videos to 1080p** ⭐ | 105949 | 2026-06-09 |
| Pay-as-you-go pricing | 7848 | 2026-07-07 |
| DescribeVodEnhanceImageData | 36078 | — |

> ⭐ **`105949` 这篇 Quickstart 就是 libtv 的场景**，英文原文：
> 「This quickstart shows you how to use the Video Enhancement tool to **upscale an AI-generated 480p video to 1080p**.」
> 「**Upscale beyond model limits**: AI models often generate videos with a maximum resolution of 720p. With a single API call, the Video Enhancement tool can upscale your footage to 1080p or 4K…」
> 「**Increase frame rate to reduce judder**: The native frame rate of generated videos is often 24 fps. The tool's frame interpolation technology can increase the frame rate to **50 fps or higher**…」
> 「**Reduce costs with an upscaling workflow**: Adopt a **"generate low, restore high"** strategy. First, generate a 480p video at a lower cost, then use AI MediaKit to enhance it to 720p or higher. The resulting image quality can be comparable to that of a directly generated high-resolution video but at a significantly lower overall cost.」

### 4.3 BytePlus 的 API（两套并存：VOD OpenAPI + AI MediaKit REST）

**① VOD OpenAPI**（AK/SK 签名，端点是 `vod.byteplusapi.com`，**不是** `vod.volcengineapi.com`）：

- 提交：`POST https://vod.byteplusapi.com?Action=StartExecution&Version=2025-07-01` → 返回 `RunId`
- 轮询：`Action=GetExecution&Version=2025-07-01`，`Status` ∈ `PendingStart` / `Running` / `Success` / `Failed` / `Terminated`
- 或事件回调：**`ExecutionComplete`**
- 枚举（与国内侧一致）：`Operation.Task.Type=Enhance`；`Enhance.Type` = `Custom` | `Moe`；`Custom` 时 `Modules[].Type` = **`SR` / `VFI` / `SDR2HDR` / `SDREnhance` / `AudioDenoise`**；`MoeEnhance.Config` = **`common` / `ugc` / `short_series` / `aigc` / `old_film`**；`VideoStrategy.EnhanceLevel` = `Fast` | `Standard` | `Pro`
- `Target`：`Res`（240p…8k）、`ResLimit` [128,4320]、**`ScaleRatio` [1.1,10]**、`Bitrate` [10,50000]、`Fps`
- 用量查询：`Action=DescribeVodEnhanceImageData&Version=2023-01-01`
- ⚠️ **地域限制（重要）**：官方原文「**This API currently supports only the Asia Pacific (Johor) region and does not support the Asia Pacific (Singapore) region.**」

**② AI MediaKit（REST，与国内站"同名不同域"）**：`https://mediakit.ap-southeast-1.bytepluses.com`，`Authorization: Bearer <API Key>`：
`POST /api/v1/tools/enhance-video`、`/enhance-video-fast`、`/video-frame-interpolation`、`/enhance-video-smoothness`、**`POST /api/v1/tools-sync/enhance-image`**（同步），统一轮询 `GET /api/v1/tasks/{task_id}`。
→ **国内站 AI MediaKit 与 BytePlus AI MediaKit 是两套不同域名的服务，端点不要混用。**

**③ Go SDK 交叉验证**：`github.com/byteplus-sdk/byteplus-go-sdk-v2`（main 分支）的 `service/vod20250701` 中确有 `StartExecution` / `GetExecution`，`ServiceName=vod`、`APIVersion=2025-07-01`，字段与文档一致（`Target{Res,ResLimit,ScaleRatio,Bitrate,Fps}`、`VideoStrategy{RepairStrength,RepairStyle}`）。
> ⚠️ **但该 Go SDK 的 `VideoStrategy` 缺 `EnhanceLevel` 字段**（文档中有）→ **libtv 走 Go SDK 时无法直接设置增强档位，需用 SDK 的 Common 调用变体或自行构造请求。** 这条对 libtv 的 Go 实现有直接影响。
> 另：`byteplus-sdk/byteplus-specs` 只是移动端 SDK 的 podspec 仓，**无服务端 OpenAPI spec，不必投入**。

### 4.4 ⭐ BytePlus 官方 USD 单价（**独立价表，非复用转码价**）

来源：[BytePlus VOD Pay-as-you-go pricing](https://www.byteplus.com/docs/byteplus-vod/7848)（DocumentID 7848），**UpdatedTime `2026-07-07T11:50:43Z`**，章节标题 `### Video enhancement pricing`。原文口径：

> 「Billing for video enhancement is based on the **output duration** of the processed video, the selected **enhancement tier**, the output **resolution**, and the output **frame rate**. The unit for all prices is **USD per minute** of processed video output.」
> ⚠️ **「Output resolutions lower than 720P are billed at the 720P rate.」** ← **480p 输出按 720P 档计价**

| Enhancement tier | Resolution | ≤30fps | >30–60fps | >60–120fps |
|---|---|---|---|---|
| **Fast** | 720P | **0.1033** | 0.2066 | 0.4132 |
| | **1080P** | **0.2066** | **0.4132** | 0.8264 |
| | 2K | 0.4132 | 0.8264 | 1.6528 |
| | 4K | 0.8264 | 1.6528 | 3.3056 |
| | 6K | 1.6528 | 3.3056 | 6.6112 |
| | 8K | 3.3056 | 6.6112 | 13.2224 |
| **Standard** | 720P | **0.2066** | 0.4132 | 0.8264 |
| | **1080P** | **0.4132** | **0.8264** | 1.6528 |
| | 2K | 0.8264 | 1.6528 | 3.3056 |
| | 4K | 1.6528 | 3.3056 | 6.6112 |
| | 6K | 3.3056 | 6.6112 | 13.2224 |
| | 8K | 6.6112 | 13.2224 | 26.4448 |
| **Pro** | 720P | **2.0661** | 4.1322 | 8.2644 |
| | **1080P** | **4.1322** | **8.2644** | 16.5288 |
| | 2K | 8.2644 | 16.5288 | 33.0576 |
| | 4K | 16.5288 | 33.0576 | 66.1152 |
| | 6K | 33.0576 | 66.1152 | 132.2304 |
| | 8K | 66.1152 | 132.2304 | 264.4608 |

> 官方计费示例原文：「…a 10-minute video using the Fast tier and a 20-minute video using the Pro tier… 0.4132 USD/minute × 10 minutes + 8.2644 USD/minute × 20 minutes = **169.42 USD**」

**其他 BytePlus 相关 USD 价**：
- **视频插帧 base $0.15/分钟**（720p 输出 30–60fps = $0.30；1080p = $0.60）
- 视频流畅度提升：**仅检测 $0.03/分钟；检测并修复 $0.30/分钟**
- **转码**（独立一节，**与超分无关**）：H.264 1440p = $0.023/分钟、1080p = $0.0115/分钟
- **图像处理**（非 AI 增强）：Standard processing **$0.0034/GiB**；Advanced compression $0.045/GiB
- **AI MediaKit 图片增强**：**$1.00/千次**成功增强，系数 standard=1 / professional=6 / max=40 → **$0.001 / $0.006 / $0.04 每张**（[BytePlus AI MediaKit Pricing](https://www.byteplus.com/docs/byteplus-vod/105937)，DocumentID 105937，UpdatedTime `2026-09-30`）

> ❌ **不要引用这些路径**：`/en/pricing/vod`、`/en/pricing/veimagex`、`/en/pricing/media-processing` **实测全部为 "Page not found"**；`/en/pricing` 只是落地页，其元数据接口 `GET /api/financial/trade/getMultilingualMetaAll` 返回 **401 NotLogin**。**USD 价格必须直接引 docs 里的 pricing 文档（7848 / 105937）。**

### 4.5 ⭐⭐ 价格阶梯总览（这对 libtv 决策最关键）

**同一套引擎、三档定价、单调递增** —— 用 1080P ≤30fps / Standard（标准版）档做锚点：

| 渠道 | 单价（1080P≤30fps，标准版/Standard） | 折人民币（≈7.1） | 相对国内价 |
|---|---|---|---|
| **火山引擎国内站**（VOD 场景式标准版 / AI MediaKit 标准版） | **¥1.5 / 分钟** | ¥1.5 | **1.00×** |
| **BytePlus**（官方 USD 价表 7848） | **$0.4132 / 分钟** | ≈ ¥2.93 | **≈1.96×** |
| **fal.ai**（第三方转售，`bytedance-upscaler`） | **$0.432 / 分钟**（$0.0072/s） | ≈ ¥3.07 | **≈2.05×** |

**其他档位同样稳定在 ~1.96×（BytePlus vs 国内）**：

| 档位 | 国内（¥/分钟） | BytePlus（$/分钟） | BytePlus 折 ¥ | 倍数 |
|---|---|---|---|---|
| 720P ≤30fps 标准版 | 0.75 | 0.2066 | ≈1.47 | 1.96× |
| 720P 30–60fps 标准版 | 1.5 | 0.4132 | ≈2.93 | 1.96× |
| 1080P ≤30fps 标准版 | 1.5 | 0.4132 | ≈2.93 | 1.96× |
| 1080P 30–60fps 标准版 | 3 | 0.8264 | ≈5.87 | 1.96× |
| 4K ≤30fps 标准版 | 6 | 1.6528 | ≈11.7 | 1.96× |
| 1080P ≤30fps Pro | 15 | 4.1322 | ≈29.3 | 1.96× |
| 4K ≤30fps Pro | 60 | 16.5288 | ≈117.4 | 1.96× |
| 1080P ≤30fps Fast | 0.4 | 0.2066 | ≈1.47 | **3.67×** ⚠️ |

> ⚠️ **唯一例外是 Fast（极速版）档**：国内 ¥0.4 vs BytePlus $0.2066（≈¥1.47），倍数 3.67× —— 说明 **Fast 档的"相对折扣"在两个站点不一致**（BytePlus 的 Fast = Standard 的 0.5×；国内的极速版 = 标准版的 0.267×）。**若走 BytePlus 且在意成本，Fast 档不划算。**

> 🔍 **结论性洞察**：
> 1. **BytePlus 与国内站是同一套增强引擎**（场景枚举、档位枚举、算子枚举、计费维度"按输出时长"全部一致），**国内价格约为 BytePlus 官价的 51%**。
> 2. **fal.ai 只是 BytePlus 的转售**，在其上加价约 5%（schema 原文 "Enhance and upscale a video using **BytePlus VOD**"）。
> 3. → **对 libtv：如果主体在大陆，走国内站 VOD/AI MediaKit 最便宜（约为 BytePlus 的一半、fal.ai 的 49%）；若为海外主体/需要 Johor 节点，则 BytePlus 的 $0.4132/min 是官方价，fal.ai 不是更优选择。**

### 4.6 BytePlus 侧的 veImageX：**不存在**

- 616 篇 `byteplus-vod` 英文库中**无 veImageX**；`LibraryCode=byteplus-veimagex`、`byteplus-imagex`、`byteplus-veimagex-service` 全部返回 `record not found`。
- 国内站的 `GetImageEnhanceResult` / `GetImageSuperResolutionResult` 文档在 BytePlus CMS 中 `LibraryCode` 为空 → **这些文档只属于国内站**。
- **BytePlus 的图片清晰化走 AI MediaKit 同步接口 `POST /api/v1/tools-sync/enhance-image`**，定价见 4.4（$1.00/千次 × 系数 1/6/40）。

### 4.7 开通前置与免费额度（BytePlus）

| 事项 | 结论 | 来源 |
|---|---|---|
| AI MediaKit API Key | 控制台 **Settings > Create API key 自助创建，无白名单/工单** | BytePlus 文档（`byteplus-vod`） |
| VOD OpenAPI | AK/SK 签名 + 创建 Space | 同上 |
| **企业实名认证** | 文档中**未出现**企业实名认证要求 | 同上 |
| **视频增强免费额度** | ⚠️ **无**。唯一 Free tier 是 "Basic image editing and metadata acquisition" 的 **10 TiB/月**，**与 AI 增强无关** | BytePlus 文档 |
| `/activity/free` 页面 | 纯客户端渲染，**抓不到内容** | 实测 |
| 地域 | VOD `StartExecution` **仅支持 Asia Pacific (Johor)**，**不支持 Singapore** | 文档 108402 原文 |

### 4.8 BytePlus 未证实清单

| # | 事项 | 说明 |
|---|---|---|
| B1 | BytePlus 视频增强的**免费额度** | 唯一 Free tier 是基础图片编辑 10 TiB/月，与 AI 增强无关；**视频增强无免费额度的明文未直接取到，记为未证实** |
| B2 | **是否要求企业实名认证** | 文档未出现该要求。**未证实** |
| B3 | **是否需要工单/白名单** | AI MediaKit 是自助创建 API Key；VOD 侧未取到明文。**未证实** |
| B4 | **Singapore 老版增强的价格** | 原文指向"联系销售"。**未证实** |
| B5 | **`vod20250701` Go SDK 缺 `EnhanceLevel`** 的官方解释与替代路径 | 已证实字段缺失，但官方是否提供 Common 变体绕过的示例**未证实** |
| B6 | **VOD OpenAPI 的 QPS 上限** | 未读取。**未证实** |
| B7 | veImageX 在 BytePlus 是否曾经存在 | 当前 616 篇库中不存在；历史情况**未证实** |
## 5. 汇总对比与 libtv 落地方案建议

### 5.1 计价口径对比总表（火山引擎，单位：元）

| 产品/能力 | 计费口径 | 关键单价 | 大陆节点 | 来源 |
|---|---|---|---|---|
| **VOD 画质增强·场景式·极速版** | 输出时长 × 系数 | 720P≤30fps **0.2/分钟**；1080P≤30fps 0.4；**1080P 30–60fps 0.8** | ✅ 中国内地（另有亚太东南柔佛同价） | docs/4/1941013 |
| **VOD 画质增强·场景式·标准版** | 输出时长 × 系数 | 720P≤30fps **0.75/分钟**；**1080P≤30fps 1.5**；**1080P 30–60fps 3** | ✅ | docs/4/1941013 |
| **VOD 画质增强·场景式·专业版（画质重生）** | 输出时长 × 系数 | 720P≤30fps **7.5/分钟**；1080P≤30fps 15；1080P 30–60fps 30 | ✅ | docs/4/1941013 |
| **VOD 自定义·智能超分 SR** ⚠️旧版 | **输出时长**（与分辨率无关） | **8/分钟**（闲时 2.4；柔佛 7.5）— **仅旧版模板，新客户能否下单未证实** | ✅ | docs/4/1941013、docs/4/1578688 |
| **VOD 自定义·智能插帧 VFI** ⚠️旧版 | **输出时长** | **2.7/分钟**（闲时 0.81）— 同上限制 | ✅ | docs/4/1941013、docs/4/1578688 |
| VOD 自定义·SDRToHDR / SDR增强 / 音频降噪 | 输出时长 | 1 / 0.5 / 0.1 每分钟 | ✅ | docs/4/1941013 |
| **AI MediaKit 画质增强·标准版** | 输出时长 × 系数 | 0.75 基准；**1080P≤30fps 1.5**；**1080P 30–60fps 3** | ✅ 国内通用（`mediakit.cn-beijing.volces.com`） | docs/6448/2486473 |
| AI MediaKit 画质增强·极速版 | 输出时长 × 系数 | 0.2 基准；1080P≤30fps 0.4；1080P 30–60fps 0.8 | ✅ | docs/6448/2486473 |
| AI MediaKit 画质增强·专业版 | 输出时长 × 系数 | 0.75 基准×10；1080P≤30fps 15；1080P 30–60fps 30 | ✅ | docs/6448/2486473 |
| AI MediaKit 画质增强·大模型版 | 输出时长 × 系数 | 2.5 基准；1080P≤30fps 5；1080P 30–60fps 10 | ✅ | docs/6448/2486473 |
| **AI MediaKit 视频插帧** | 输出时长 × 系数 | 0.6 基准；**1080P 30–60fps 2.4**；1080P≤30fps 1.2 | ✅ | docs/6448/2486473 |
| AI MediaKit 视频流畅度提升 | 输入时长 | 仅检测 0.1；**检测并修复 1** | ✅ | docs/6448/2486473 |
| AI MediaKit 极智超清 | 输出时长 × 编码/分辨率 | 0.032 基准；H.264 1080P 0.192 | ✅ | docs/6448/2486473 |
| **veImageX 图像超分（图片）** | **成功请求次** | **2.76 元/千次** | ✅ cn-north-1（多区域，不可跨区） | docs/508/1262340 |
| **veImageX 图像画质增强（图片）** | **成功请求次** | **6.21 元/千次** | ✅ | docs/508/1262340 |
| AI MediaKit 图像画质增强（图片） | 成功请求次 | 基准 6 元/千次；专业版 36 元/千次；**大模型增强版 240 元/千次** | ✅ | docs/6448/2486470 |
| **VOD 画质检测 VQScore（无参考，验收用）** | 输出/片源时长，不分分辨率 | **0.1 元/分钟**（不支持资源包抵扣） | ✅ | docs/4/1941013、docs/4/337732 |
| **BytePlus 同源能力（经 fal.ai 转售）** | 秒 | **$0.0072/s @1080p30**（≈¥3.07/分钟）；60fps ×2；`pro` ×10。**≈国内价 ×2.05** | — | [fal.ai](https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api)（第三方转售，可信度中高） |
| **BytePlus 官方 USD 价（vCube / VOD 增强）** | 输出时长 × 档位/分辨率/帧率 | **Standard 1080P≤30fps = $0.4132/分钟**（≈¥2.93）；720P≤30fps $0.2066；1080P 30–60fps $0.8264；Pro 同理 ×10；**"低于 720P 的输出按 720P 计价"** | ✅ **仅 Asia Pacific (Johor)**，不支持 Singapore | [BytePlus docs/7848](https://www.byteplus.com/docs/byteplus-vod/7848)，UpdatedTime `2026-07-07` |
| BytePlus 视频插帧 | 输出时长 | base **$0.15/分钟**（720p 30–60fps 输出 $0.30；1080p $0.60） | ✅ Johor | BytePlus docs/7848 |
| BytePlus 视频流畅度提升 | 输入时长 | 仅检测 **$0.03/分钟**；检测并修复 **$0.30/分钟** | ✅ Johor | BytePlus docs/7848 |
| BytePlus 图片增强（AI MediaKit 同步） | 成功次数 | **$1.00/千次** × 系数(1/6/40) = **$0.001 / $0.006 / $0.04 每张** | ✅ | BytePlus docs/105937，UpdatedTime `2026-09-30` |

**⭐ 价格阶梯（同一引擎，三档定价，用 1080P≤30fps 标准版做锚点）**：

| 渠道 | 单价 | 折人民币 | 相对国内价 |
|---|---|---|---|
| **火山国内站**（VOD 场景式标准版 / AI MediaKit 标准版） | **¥1.5/分钟** | ¥1.5 | **1.00×** |
| **BytePlus 官价** | **$0.4132/分钟** | ≈¥2.93 | **≈1.96×** |
| **fal.ai 转售** | **$0.432/分钟** | ≈¥3.07 | **≈2.05×** |

（720P / 1080P60 / 4K / Pro 各档倍数均稳定在 **1.96×**；**唯一例外是 Fast/极速版档，BytePlus 相对国内为 3.67×，不划算**。详见 §4.5。）

**资源包折扣对比（重要）**：VOD 媒体处理时长资源包 12 个月 **最低 4.5 折**（50 万分钟 4,882 元）；AI MediaKit 资源包**固定 8.0 折**。

### 5.2 三条路径的「同价不同折扣」事实

VOD 场景式画质增强标准版与 AI MediaKit 画质增强标准版的**按量单价完全相同**（基准 0.75 元/分钟，720P≤30fps 0.75 / 1080P≤30fps 1.5 / 1080P 30–60fps 3 / 2K≤30fps 3 / 4K≤30fps 6）。差异在于：

| 维度 | VOD 场景式画质增强 | AI MediaKit 画质增强 |
|---|---|---|
| 按量单价（标准版） | 一致 | 一致 |
| **资源包折扣** | **最低 4.5 折**（12 个月 50 万分钟） | **固定 8.0 折** |
| 鉴权 | AK/SK 签名（`StartExecution`，**官方 Go SDK 内无此 Action**，需手工签名） | **`Authorization: Bearer <API Key>`**（Go 侧无需实现签名） |
| 调用形态 | `POST vod.volcengineapi.com?Action=StartExecution&Version=<?>` → `RunId` → `GetExecution` | `POST mediakit.cn-beijing.volces.com/api/v1/tools/enhance-video` → `task_id` → `GET /api/v1/tasks/{id}` |
| 输入协议 | Vid / FileName（须先上传到点播空间） | 公网 URL / `mediakit://` / **`vod://`** / `tos://` |
| QPS / 并发 | `StartExecution` 单用户 **50 QPS** | 异步全局 **40 QPS**，**并发上限默认 20**（可工单扩容） |
| 白名单 | `StartExecution` 免工单；`StartWorkflow` 需工单 | 免工单（仅 QPS 提额需工单） |
| 结果有效期 | 30 天内可查 | 结果链接 **24 小时**；任务查询限 **30 天** |
| 依赖 | 需开通 VOD + 配置加速域名才能拿到可播 URL | 需开通 VOD + 智能处理并做跨服务授权 |

> **建议**：**起步阶段用 AI MediaKit**（鉴权简单、支持 `vod://` 输入输出、免手工签名、Go 侧工程量最小）；**用量上来后切换到 VOD 场景式**（资源包折扣最低 4.5 折，长期成本更低）。两者能力与按量单价一致，迁移成本主要是把 REST 调用换成 `StartExecution`。

### 5.3 对 libtv 的落地方案建议（基于已证实事实）

**场景：480p 成片 → 1080p / 60fps 清晰化**

| 方案 | 单价 | 10 分钟成片成本 | 说明 |
|---|---|---|---|
| **① VOD 画质增强·场景式·标准版，`Config=short_series`（短剧），`Target.Res=1080p`、`Fps=60`** | 1080P 30–60fps = **3 元/分钟** | **30 元** | ⭐ **推荐**。一个接口同时完成超分+去噪+去块+锐化+色彩增强+自动插帧；片源 480p 完全合规（≤1081px）；短剧场景模板对人像专门优化；可在控制台自建模板后复用 |
| ② 同上但输出 1080p/30fps（不补帧） | 1.5 元/分钟 | 15 元 | 若不需要 60fps |
| ③ VOD 画质增强·场景式·极速版，1080p/60fps | 0.8 元/分钟 | 8 元 | 最省，但轻量超分；RTF 3~4 最快 |
| ④ ~~VOD 自定义：智能超分 + 智能插帧 分开做~~ | ~~8 + 2.7~~ | ~~≈ 104 元~~ | ❌ **不可行/不推荐**：该模式已标记为「旧版」，新场景化系统不再支持创建新的自定义增强模板（docs/4/1578688） |
| ⑤ AI MediaKit `enhance-video`（`tool_version=standard`，`scene=short_series`，`resolution=1080p`，`fps=60`） | 1080P 30–60fps = 3 元/分钟 | 30 元 | ⭐ **工程上最推荐**。API Key 鉴权（无需 AK/SK 签名）、REST+JSON 更简单、支持 `vod://`/`tos://` 输入输出、可按队列分账、有 MCP/CLI/Skill 生态；**劣势**：需单独开通与维护另一套凭证、QPS 全局仅 40、并发 20、资源包只打 8 折 |
| ⑥ AI MediaKit 极速版 | 0.8 元/分钟 | 8 元 | 同上优势，最省 |
| ⑦ 「低分辨率生成 + 高清修复」策略 | — | — | 官方明确推荐（[docs/6448/2279961](https://www.volcengine.com/docs/6448/2279961)）：「先以较低成本生成 480p 视频，再利用 AI MediaKit 智能增强至 720p。画面质感与色彩饱和度可接近模型直出效果，但整体链路成本显著降低」——**正是 libtv 的诉求** |
| ⑧ 验收环节：清晰化前后各跑一次 VQScore | 0.1 元/分钟 | ≈ 0.6 元/集（前后各一次，3 分钟/集） | ⭐ 建议纳入 CI。**无参考**，无需原片即可评分；用「0–60 较差 / 60–70 良好 / 70–100 清晰」做门槛 |
| ⑨ **BytePlus 镜像方案**（海外主体场景） | Standard 1080P≤30fps = $0.4132/分钟 | ≈ $12.4（≈¥88） | 仅当需要 Johor 节点/海外主体时使用；**价格为国内 1.96 倍**；⚠️ Go SDK 缺 `EnhanceLevel` |

**关键实现决策点**：
1. **VOD 路线**：优先 `StartExecution`（免白名单、免建模板、单用户 50 QPS）；**注意 Version 冲突**（2023-07-01 vs 2025-01-01，两者都做可配）。`Operation.Task.Enhance.Type` 用 `Moe` 走场景化模板，`EnhanceLevel` 取 `Standard`。产物 `StoreUri` 需自行拼 URL，且**必须先给点播空间配置加速域名**。
2. **AI MediaKit 路线**：`POST /api/v1/tools/enhance-video` → 轮询 `GET /api/v1/tasks/{task_id}` 或配 `callback_url`。鉴权只需 `Authorization: Bearer <API Key>`，**Go 侧无需实现火山 AK/SK 签名**，工程成本更低。结果链接 24 小时内有效。
3. **老片修复场景**：统一用 `old_film`（VOD `MoeEnhance.Config=old_film` / AI MediaKit `scene=old_film` / BytePlus 文档称 "classic film restoration"）。**不要**参考 `docs/6448/76272`《老片修复》——那是 2022 年旧 IMP 控制台文档（Updated `2022-06-27`），其"申请开通"链接已过时。
4. **24/30 → 60fps**：VOD 侧只要把输出帧率设 60 即自动启用智能插帧；AI MediaKit 侧用 `fps=60`（`enhance-video` 内置插帧能力）或单独调 `video-frame-interpolation`。**注意：把 `fps` 设 60 会把计费系数从 ×2 提到 ×4，成本翻倍**——如果交付只要 30fps，能省一半钱。官方英文文档也把这点列为针对 AI 生成视频的三大收益之一（「native frame rate of generated videos is often 24 fps…can increase the frame rate to 50 fps or higher」）。
5. **RTF 预算**：标准版 RTF 6～10，10 分钟成片需 60～100 分钟；若要有 SLA 保障，用极速版（RTF 3～4）或在 AI MediaKit 里用「项目与队列管理」做优先级隔离。
6. **分辨率档位按"输出短边"判定**：480p 成片若输出 1920×800（短边 800），会被归入 **1080P 档**；若输出 1280×720 则是 720P 档（便宜）。**libtv 竖屏漫剧常见 1080×1920（短边 1080）→ 归 1080P 档**。**BytePlus 另有明文：「Output resolutions lower than 720P are billed at the 720P rate」**（480p 输出按 720P 计价）。
7. **成本优化杠杆（按收益排序）**：① 用 12 个月 50 万分钟 VOD 资源包（**4.5 折**）② 尽量输出 30fps 而非 60fps（**系数直接减半**）③ 输出 720p 而非 1080p 档（**再减半**）④ 用**闲时任务**（约为正常价 **30%**，但**资源包不可抵扣闲时任务**，且需确认提交侧参数）⑤ 用极速版（基准 0.2 vs 标准版 0.75；**但注意 BytePlus 侧 Fast 档相对不划算**）。
8. **验收自动化**：接入 **VQScore**（无参考，0.1 元/分钟）做清晰化前后的门禁；它还能「识别伪高清视频，规避分辨率欺骗」，可防止超分只做插值不做细节重建。
9. **地域选择（libtv 主体在大陆）**：**直接用国内站**，价格约为 BytePlus 的 51%、fal.ai 的 49%。BytePlus 侧 `StartExecution` **仅支持 Johor 且不支持 Singapore**，若为海外发行准备的节点需另行确认。**fal.ai 只是 BytePlus 的转售，没有任何价格优势**。

---

## 6. 未证实清单（明确列出，不做推测）

| # | 未证实事项 | 原因 / 说明 |
|---|---|---|
| 1 | **`StartExecution` / `GetExecution` 的确切 `Version`** | **官方文档自相矛盾**：API 参考 `1477169`/`1477170`（2026-08-28）用 `2023-07-01`；任务指南 `2624029`/`1582325`（2026-09）用 `2025-01-01`。需 API Explorer 实测裁决。**必须两套都做成可配置** |
| 2 | **`StartExecution` / `GetExecution` 是否在官方 SDK 中** | ❌ **不在**。`volcengine/volc-sdk-golang` 的 `service/vod/config.go` 共 148 个 Action，**无此二者**。若走此路径需手工实现 AK/SK 签名或使用 SDK 通用调用能力 |
| 3 | **官方预置画质增强 TemplateId 列表** | **未发布**。文档示例 ID 被掩码（`ddc7d66386***6056a`），必须控制台自建 |
| 4 | **`RepairStrength` 的完整取值范围** | 文档表格仅证实 `-50`（轻度高保真）、`0`（中等）；是否存在正值（如 `+50`）**未证实**（疑似文档表格被截断） |
| 5 | **VOD 工作流 `Activity.Type` 的完整枚举** | 官方文档**未列出**完整枚举表；唯一权威来源是 SDK proto 注释「支持 Transcode｜Snapshot｜End」（`vod_workflow.pb.go:4083`）。是否还有其他值**未证实** |
| 6 | **AI MediaKit / VOD 画质增强的免费额度** | ⚠️ **部分证实**：VOD 新用户礼包存在（存储 50GB / 转码 300 分钟 / CDN 10GB），但**官方明列 300 分钟转码不可抵扣画质增强**。**AI MediaKit 画质增强的免费额度：未证实**（在 docs/6448/2253924、2300661、2486470、2486473、2533606、2222230、2369811 全文中均未检索到）。**非"没有"，而是"未检索到公开说明"** |
| 7 | ~~AI MediaKit 资源包的具体档位金额~~ | ✅ **已证实**：10 分钟 8 元 / 100 分钟 80 元 / 1,000 分钟 800 元 / 1 万分钟 8,000 元（固定 8.0 折） |
| 8 | **AI MediaKit 部分图像基础编辑工具的"免费额度"具体数值** | 文档 `2533606` 原文提到存在"提供免费额度的图像基础编辑工具"，但**未给出数值**。**未证实** |
| 9 | **AI MediaKit 是否强制企业实名认证** | AI MediaKit 自身文档中**未见**强制企业实名认证表述（只有平台级"需完成实名认证"，且企业认证才能开通/购买更多云服务）。**未证实**（个人实名是否够用未确认） |
| 10 | **VOD 画质增强的闲时任务开关参数名** | 计费表明确区分「正常任务 / 闲时任务」（闲时价约为正常的 30%），但**提交侧开启闲时的具体参数路径未取证**。**未证实**。另注意：**资源包不能抵扣闲时任务** |
| 11 | ~~VOD 自定义画质增强（超分 8 元/分钟）当前是否可下单~~ | ⚠️ **已发现官方两页互相矛盾，判定为未证实**：`1578688`（2026-09-01）原文「**新的场景化系统已不再支持创建新的自定义增强模板**」；但 `117971`（2026-09-07）仍把「自定义增强」列为可选预设模板。**能否新开需控制台实测** |
| 12 | **自定义画质增强的"智能超分"是否还要再乘分辨率/帧率系数** | 文档原文只有 `画质增强费用 = 输出文件时长 × 单价`，**未提及**分辨率/帧率系数（与场景式的"基准单价+系数"模式不同），但也**未明确写"不区分分辨率"**。**未证实** |
| 13 | **VOD 自定义画质增强是否需工单白名单** | 媒体处理计费页未标注。**未证实** |
| 14 | **BytePlus 原生（非 fal.ai 转售）英文 API 端点与 USD 单价** | BytePlus 文档站 JSON 接口与国内站**同源**，检索英文词返回中文文档（同 GID）。fal.ai 已证实后端是 BytePlus VOD 并给出 USD 转售价，但**BytePlus 自己的英文端点名与官方 USD 单价未证实** |
| 15 | **BytePlus Free Tier 的具体额度 / 是否需企业实名 / 是否需白名单** | 仅确认导航存在 "BytePlus Free Tier" 入口。**未证实** |
| 16 | **veImageX 的 AI 增强组件免费额度** | docs/508/1262340 全文未提及。**未证实**（但 docs/508/65935 提到 veImageX 新用户有分发 10GB / 标准存储 50GB / **基础图像处理每月 0–10TB 免费**，AI 增强组件不在其中） |
| 17 | **VOD「低成本转码」「倍速转码」等白名单功能的价格** | 官方原文「低成本转码为白名单功能…请提交工单联系技术支持申请开通并**获取价格详情**」→ **价格未公开，未证实** |
| 18 | ~~`Content` 中表格单元格与档位的对应准确性风险~~ | ✅ **已消除**：改用 `Result.MDContent`（纯 markdown、表格完整）逐字复核，本报告所有单价表格均已核对，与 `Content` 解析结果一致 |
| 19 | **火山引擎定价站（`/pricing`）抓取不可行** | `/pricing?product=vod` 等为 JS SPA，SSR `window._SSR_DATA.data` 为空；底层 `POST /api/financial/trade/GetPrice` 匿名调用返回 `{"Error":{"Code":"UnauthorizedAccess"}}`，需登录态 + `x-csrf-token`。→ **本报告全部价格来自官方文档站（非定价站），可信度更高，但"计算器/定价页"上的实时价可能有出入** |
| 20 | **`EnContent` 与 `MDContent` 是否一致** | 未逐篇比对。**未证实**（但已确认 BytePlus 有**独立**英文库 `byteplus-vod`，其 `MDContent` 为英文，见 §4） |
| 21 | ~~BytePlus 是否有独立英文文档 / 独立 API / USD 单价~~ | ✅ **已全部证实**：英文库 `LibraryCode=byteplus-vod`（616 篇）；API `vod.byteplusapi.com?Action=StartExecution&Version=2025-07-01`；官方 USD 价表见文档 7848（UpdatedTime `2026-07-07`）。详见 §4 |
| 22 | **BytePlus `vod20250701` Go SDK 缺 `VideoStrategy.EnhanceLevel`** | 字段缺失已证实；官方是否提供 Common 变体/示例绕过**未证实**。**直接影响 libtv 的 Go 实现，落地前必须验证** |

---

> **未证实项合计 22 条 + BytePlus 专项 7 条（§4.8）。其中对 libtv 决策影响最大的三条**：
> 1. **`StartExecution` 的 `Version`（国内站 2023-07-01 vs 2025-01-01 官方自相矛盾）** → 必须双版本可配 + API Explorer 实测。
> 2. **VOD 自定义画质增强（超分 8 元/分钟）能否新开** → 官方两页矛盾，**不要作为默认报价**。
> 3. **BytePlus Go SDK 缺 `EnhanceLevel`** → 若走 BytePlus + Go，需自研请求或换 Common 变体。

---

## 7. 来源清单

### 7.1 火山引擎 VOD（LibraryID=4）

| 文档 | URL | UpdatedTime |
|---|---|---|
| 发起场景式画质增强任务 | https://www.volcengine.com/docs/4/2624029 | 2026-09-01T08:36:13Z |
| StartExecution 接口概览 | https://www.volcengine.com/docs/4/1582324 | 2026-09-18T08:01:50Z |
| GetExecution - 获取媒体处理任务执行结果 | https://www.volcengine.com/docs/4/1582325 | 2026-09-18T14:33:01Z |
| GetWorkflowExecutionResult | https://www.volcengine.com/docs/4/174771 | 2026-09-24T09:55:56Z |
| 画质增强修复模板 | https://www.volcengine.com/docs/4/117971 | 2026-09-07T07:02:28Z |
| 场景式画质增强概览 | https://www.volcengine.com/docs/4/1578688 | 2026-09-01T08:53:10Z |
| **媒体处理计费**（含全部单价） | https://www.volcengine.com/docs/4/1941013 | 2026-09-15T02:35:33Z |
| 计费概述 | https://www.volcengine.com/docs/4/65628 | 2026-07-29T02:44:59Z |
| 资源包 | https://www.volcengine.com/docs/4/76544 | 2026-09-15T02:35:33Z |
| 工作流（含 1080p 片源限制） | https://www.volcengine.com/docs/4/65675 | 页面日期未知（经检索摘要取证） |
| 开通相关 | https://www.volcengine.com/docs/4/108892 | 2022-04-22T10:18:30Z |
| 实名认证 基本介绍 | https://www.volcengine.com/docs/4/64935 | 页面日期未知（检索摘要） |
| StartExecution API 参考 | https://www.volcengine.com/docs/4/1477169 | 2026-08-28（Version=2023-07-01） |
| GetExecution API 参考 | https://www.volcengine.com/docs/4/1477170 | 2026-08-28（Version=2023-07-01） |
| 视频点播价格计算器 | https://www.volcengine.com/pricing?product=vod&tab=2 | ⚠️ JS SPA，**抓取不可行**（见未证实 #19） |
| **画质检测 VQScore**（无参考评分，验收用） | https://www.volcengine.com/docs/4/337732 | **2026-09-15T02:36:25Z** |
| 提交画质检测任务（`StartExecution` 无参考质检） | https://www.volcengine.com/docs/4/2684648 | — |
| 画质检测修复 / 检测修复模板 | https://www.volcengine.com/docs/4/76318 · https://www.volcengine.com/docs/4/75243 | — |
| 任务节点输出定义（质检/去水印/精彩剪辑等） | https://www.volcengine.com/docs/4/106885 | — |
| 转码看板（VQScore/PSNR 多指标） | https://www.volcengine.com/docs/4/79166 | — |
| **关于画质增强能力升级及计费调整的公告** | https://www.volcengine.com/docs/4/2552696 | **2026-06-26** |
| VOD 开通流程 | https://www.volcengine.com/docs/4/2834 | 2026-09-07 |
| 特惠体验资源包（企业专享） | https://www.volcengine.com/docs/4/1159040 | 2024-11-18 |
| 实名认证 基本介绍 / 认证说明 | https://www.volcengine.com/docs/6261/64935 · https://www.volcengine.com/docs/6261/64934 | 2024-12-18 / 2026-05-22 |

### 7.2 火山引擎 AI MediaKit / 智能媒体处理（LibraryID=6448）

| 文档 | URL | UpdatedTime |
|---|---|---|
| AI MediaKit 介绍 | https://www.volcengine.com/docs/6448/2222230 | 2026-09-01T07:52:59Z |
| 基础概念及准备工作 | https://www.volcengine.com/docs/6448/2300661 | 2026-08-27T03:00:35Z |
| 计费说明 | https://www.volcengine.com/docs/6448/2253924 | 2026-09-24T11:46:39Z |
| **视频工具计费** | https://www.volcengine.com/docs/6448/2486473 | 2026-09-24T11:48:37Z |
| **图像工具计费** | https://www.volcengine.com/docs/6448/2486470 | 2026-08-27T02:37:24Z |
| 资源包 | https://www.volcengine.com/docs/6448/2533606 | 2026-08-10T08:30:16Z |
| 画质增强（标准版和专业版）开发指南 | https://www.volcengine.com/docs/6448/2279961 | 2026-09-17T07:24:06Z |
| 画质增强（极速版） | https://www.volcengine.com/docs/6448/2480919 | 2026-08-06T13:37:22Z |
| 画质增强（大模型版） | https://www.volcengine.com/docs/6448/2407223 | 2026-09-17T02:55:24Z |
| 提交画质增强（标准版和专业版）任务 API | https://www.volcengine.com/docs/6448/2279230 | 2026-09-17T07:13:09Z |
| 提交画质增强（极速版）任务 API | https://www.volcengine.com/docs/6448/2487478 | 2026-08-06T13:37:22Z |
| 提交画质增强（大模型版）任务 API | https://www.volcengine.com/docs/6448/2464595 | 2026-09-17T02:47:09Z |
| 视频插帧 / 提交视频插帧任务 API | https://www.volcengine.com/docs/6448/2618118 · https://www.volcengine.com/docs/6448/2624391 | 2026-08-06T13:20:53Z / 13:17:52Z |
| 视频流畅度提升 / 提交任务 API | https://www.volcengine.com/docs/6448/2702227 · https://www.volcengine.com/docs/6448/2702305 | 2026-09-30T04:32:04Z / 04:32:13Z |
| 极智超清 / 提交极智超清任务 API | https://www.volcengine.com/docs/6448/2488143 · https://www.volcengine.com/docs/6448/2515358 | 2026-07-08T03:09:53Z / 2026-07-31T08:53:55Z |
| 查询任务信息 API | https://www.volcengine.com/docs/6448/2278532 | 2026-08-26T07:22:06Z |
| 老片修复（**旧 IMP 遗留页，勿参考**） | https://www.volcengine.com/docs/6448/76272 | **2022-06-27T13:13:17Z** |
| 视频画质检测 VQScore（工具指南） | https://www.volcengine.com/docs/6448/2505580 | — |
| 提交视频画质检测 VQScore 任务 API（`/api/v1/tools/assess-video-quality`） | https://www.volcengine.com/docs/6448/2515374 | 2026-06-17T12:59:13Z |
| 项目与队列管理（异步并发上限 20） | https://www.volcengine.com/docs/6448/2519520 | 2026-08-26 |
| 多源媒体输入与本地上传（`mediakit://`/`vod://`/`tos://`） | https://www.volcengine.com/docs/6448/2536893 | — |
| 智能处理控制台简介（开通流程） | https://www.volcengine.com/docs/6448/100468 | 2023-07-27 |
| 智能处理快速入门 / 事件回调 | https://www.volcengine.com/docs/6448/70274 · https://www.volcengine.com/docs/6448/2288701 | 2023-07-27 |

### 7.3 veImageX（LibraryID=508）

| 文档 | URL | UpdatedTime |
|---|---|---|
| AI 能力组件计费说明 | https://www.volcengine.com/docs/508/1262340 | 2026-08-18T12:58:12Z |
| 使用图像超分辨率获取结果图 | https://www.volcengine.com/docs/508/1254829 | 2025-07-28T08:13:17Z |
| 使用综合增强获取结果图 | https://www.volcengine.com/docs/508/1254824 | 2026（检索摘要，页面日期未知） |
| 附加组件通用计费说明 | https://www.volcengine.com/docs/508/1114019 | 页面日期未知 |
| 使用图像增强获取结果图（`GetImageEnhanceResult`） | https://www.volcengine.com/docs/508/1770787 | 页面日期未知 |
| veImageX 后付费总则（新用户免费额度） | https://www.volcengine.com/docs/508/65935 | 2026-03-12 |

### 7.4 BytePlus（英文库 `LibraryCode=byteplus-vod`，LibraryID=25，616 篇）

> 枚举：`GET https://www.byteplus.com/api/doc/getDocList?LibraryCode=byteplus-vod&type=doc`；取正文：`GET https://www.byteplus.com/api/doc/getDocDetail?DocumentID=<id>&type=doc` → `Result.MDContent`

| 文档 | DocumentID | URL | UpdatedTime |
|---|---|---|---|
| **Pay-as-you-go pricing**（含 USD 增强价表） | 7848 | https://www.byteplus.com/docs/byteplus-vod/7848 | **2026-07-07T11:50:43Z** |
| **vCube upscaling and enhancement overview** | 27051 | https://www.byteplus.com/docs/byteplus-vod/27051 | **2026-09-17T06:42:25Z** |
| Quickstart: Upscaling AI-generated videos to 1080p | 105949 | https://www.byteplus.com/docs/byteplus-vod/105949 | 2026-06-09T03:26:32Z |
| Video enhancement template | 7864 | https://www.byteplus.com/docs/byteplus-vod/7864 | 2026-09-15T11:13:06Z |
| Enhancing video quality via the OpenAPI | 91006 | https://www.byteplus.com/docs/byteplus-vod/91006 | — |
| Create a video quality enhancement task | 108402 | https://www.byteplus.com/docs/byteplus-vod/108402 | — |
| Video quality enhancement (standard/professional) | 105948 | https://www.byteplus.com/docs/byteplus-vod/105948 | — |
| Video quality enhancement (fast) / Create task | 120015 / 120024 | https://www.byteplus.com/docs/byteplus-vod/120015 | — |
| **Video frame interpolation** / Create task | 120014 / 120025 | https://www.byteplus.com/docs/byteplus-vod/120014 | 2026-09-04T09:24:57Z |
| Video smoothness enhancement / Create task | 121759 / 121760 | https://www.byteplus.com/docs/byteplus-vod/121759 | — |
| Image quality enhancement / Create task | 120276 / 120287 | https://www.byteplus.com/docs/byteplus-vod/120276 | 2026-09-11T07:40:26Z |
| **AI MediaKit Pricing**（图片增强 $1.00/千次） | 105937 | https://www.byteplus.com/docs/byteplus-vod/105937 | 2026-09-30T08:11:38Z |
| DescribeVodEnhanceImageData | 36078 | https://www.byteplus.com/docs/byteplus-vod/36078 | — |
| Pricing overview / Pricing | 7847 / 7846 | https://www.byteplus.com/docs/byteplus-vod/7847 | — |
| vCube 在线 Demo | — | https://demo.byteplus.com/aiexp/video-enhance | — |
| BytePlus Go SDK（交叉验证） | — | https://github.com/byteplus-sdk/byteplus-go-sdk-v2（`service/vod20250701`） | main 分支 |
| **fal.ai 转售（第三方）** | — | https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video/api | 模型 date `2025-10-31` |

> ❌ **不存在/不可用的路径（实测）**：`/en/pricing/vod`、`/en/pricing/veimagex`、`/en/pricing/media-processing` 全部 **Page not found**；`/en/pricing` 的元数据接口 `getMultilingualMetaAll` 返回 **401 NotLogin**；`/activity/free` 纯客户端渲染无内容。**不要引用这些路径作为价格来源。**

### 7.5 官方 SDK 源码（交叉验证）

| 文件 | 行 | 内容 |
|---|---|---|
| `github.com/volcengine/volc-sdk-golang` `service/vod/config.go` | 1207-1214 | `DescribeVodEnhanceImageData`（`Version=2023-07-01`，GET） |
| 同上 | 全文件 | VOD 全部 148 个 Action 列表（无 Enhance 提交类 Action） |
| `service/vod/models/request/request_vod.pb.go` | 11614-11624 | `DescribeVodEnhanceImageDataRequest`；`TaskTypeList` 注释「SR（智能超分），VFI（插帧），SDREnhance（SDR增强），SDR2HDR（SDR 转 HDR），AudioDenoise（音频降噪）」 |
| 同上 | 4867 | `VodCreateTaskTemplateRequest.TaskType` 注释「TranscodeVideo\|ByteHD\|TranscodeAudio\|Snapshot」（**不含 Enhance**） |
| `service/vod/models/business/vod_measure.pb.go` | 2207-2215 | `DescribeVodEnhanceImageDataItem{Time, SR, VFI, SDREnhance, SDR2HDR, AudioDenose}`；注释「点播画质增强用量」 |
| `service/vod/models/business/vod_workflow.pb.go` | 4083 | `Activity.Type` 注释「任务类型，支持Transcode｜Snapshot｜End」 |
| 同上 | 6234-6241 | `TranscodeActivity_EnhanceParams{TemplateId, Version}`；`Version` 注释「版本，当前为volc」 |
| 同上 | 4176-4224 | `TranscodeActivity.Enhance`；`OverrideParams.Enhance`；`EnhanceOverride{StorageMode, FileName}` |
| `service/imagex/extension.go`、`example/imagex/v1/extension_super_resolution.go` 等 | — | veImageX 超分/增强/去噪接口在 Go SDK 中存在 |
| `service/imp`、`service/sami`、`service/visual`（`EnhancePhoto`/`EnhancePhotoV2`）、`service/veedit` | — | 相关服务在 SDK 中存在 |

### 7.6 检索工具（本调研自建）

- `/tmp/vdoc.py` —— 火山/BytePlus 文档站 JSON API 客户端（`get` / `search` / `detail` / `render` / `doclist`，含 Quill Delta 解析）