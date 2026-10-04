# 中国云厂商「文件级视频超分 / 插帧 / 画质增强 / 老片修复」API 调研（可选补充清单）

**调研对象**：金山云（KS3 + 视频云）、移动云（中国移动）、天翼云（中国电信）、联通云（中国联通）

**调研问题**：这 4 家是否提供**对已成片 MP4 文件**做超分辨率、补帧、去噪/去块、锐化、SDR→HDR、老片修复的**文件级 API**（区别于 RTC/直播实时增强）。

**抓取日期**：2026-10-04（服务器返回日期显示为 2026-10-04；各页面「最近更新时间」逐条标注）

**方法论与证据等级**：
- 证据分三级：**官方文档页**（产品文档 / API 参考 / 规格限制）、**官方定价页**（官网价格页或官方价格计算器正文）、**二手来源**（开发者社区文章、搜索引擎结果、非官方博客）。
- 只记录**实际抓到的原文**。凡未抓到、或只有营销措辞而无对应 API 字段/接口/计费项的，一律标注「**未证实**」，不推测接口名、参数名与价格。
- 强制区分两个概念：
  - **RTC / 直播实时增强**：在推流、通话或转码流水线上对**实时流**做暗光增强、美颜、降噪、实时超分等。
  - **文件级成片增强**：对一个**已经存在的 MP4 对象**发起一个异步任务，产出新的增强后文件。
  - 本次调研的结论是：**4 家中没有任何一家提供第 2 类（文件级超分/插帧/画质增强）的公开可调用 API**。

---

## 0. 结论速览

| 厂商 | 是否有文件级超分/插帧/画质增强 API | 文件级转码 API | 只有实时增强？ | 高度相关的官方宣称 | 关键缺口 |
|---|---|---|---|---|---|
| **金山云** | **未证实**（有官方营销宣称，无可调用字段/接口） | ✅ KET 点播转码（Action=CreateTask，源文件须在 KS3） | 否（KET 是文件级转码；KLS 直播转码是实时） | KET 产品优势页写明「AI 去噪增强…由**超分辨率、去噪、去模糊、锐化、对比度增强**等多个算法模块组成」；该页 2021-06-23 | 模板/任务 API 全量字段中**没有任何**超分/插帧/去噪/锐化/HDR 参数；价格表也无对应计费项 → 未开放为 API |
| **移动云** | **完全没有**（全站 157 个产品目录树 + 全站搜索均无命中） | ✅ 视频点播 `/vod2/t1/trans/create` | **也没有**：音视频通信（RTC）只有「码率和帧率的智能调节」，无美颜/暗光/超分 | 无（连营销宣称都没有） | — |
| **天翼云** | **完全没有**（官方文档检索无命中） | ✅ 云点播 `POST /template/transcode/create` + 提交转码任务 | **也没有**：视频直播明确「暂不支持窄带高清转码」 | 唯一命中是一篇**开发者社区用户投稿**（非官方产品文档），文中不点名任何天翼云接口 | 唯一「增强」类能力是**图片锐化**（XStor/ZOS `image/sharpen`）与**视频截帧** |
| **联通云** | **未证实**（站点完全不可达） | 未证实 | 未证实 | 未证实 | `cloud.wo.cn` 根路径 403、子路径 502、`web_fetch` 亦 403 |

**一句话**：若目标是「老片修复 / 超分 / 插帧」，**这 4 家都无法通过公开 API 满足**；金山云是唯一有官方能力宣称的一家，但宣称与可调用 API 之间存在明确落差。

---

## 1. 金山云（KS3 对象存储 + 云转码 KET / 云直播 KLS）

### 1.1 文档可达性（先说明怎么拿到的）

`docs.ksyun.com` 首页是 Vue SPA（jQuery + `home.js` 渲染，直接 curl 拿不到正文），`/sitemap.xml` 实际返回的也是首页 HTML。可用的两条通路：

1. **文档详情页可直抓**：`https://docs.ksyun.com/documents/<id>` 是 SSR，正文在 `<div class="ks-docs-editor__content">` 内，并带「最近更新时间」。
2. **官方文档检索 API（本次调研主力手段）**：
   `GET https://docs.ksyun.com/i/console/docs/new/search/docAndProduct?page=1&pageSize=20&q=<关键词>`
   返回 JSON，含 `products` 与 `items`（每条 `name` / `plain_content` / `url` / `from` 面包屑）。
   该接口来自首页内联 JS：`url:"/i/console/docs/new/search/docAndProduct"`。
   用它可以做**全站关键词穷举**——这是本次判定「金山云是否真有超分 API」的关键证据。
3. 产品目录页 `https://docs.ksyun.com/products/<productId>`（云转码 KET = **34**，对象存储 KS3 = **25**）。

### 1.2 KS3 对象存储本身：**不做视频处理**

- KS3 官方 FAQ 明确回答「**KS3 有视频转码服务吗？请咨询视频云及相关产品，参见金山云转码服务文档**」
  来源：https://docs.ksyun.com/documents/42274（《多媒体处理问题》，**页面日期未知**——该页未显示更新时间）
- KS3 左导航中的「数据处理」能力全集为：**新版图片处理**（缩放 / 格式转换 / 忽略错误 / 图片信息 / 平均色值 / 质量变换 / 图片瘦身 / 渐进显示 / 去除元信息 / 旋转 / 自适应方向 / 镜像翻转 / 自定义裁剪 / 内切圆 / 索引剪切 / 圆角矩形 / 模糊 / 灰度 / 亮度 / 对比度 / **锐化** / 水印 / 持久化）、**旧版图片处理**、**文档处理**（文档快照 / 格式转换 / 持久化）、**数据智能**、**批量处理**。
  → 「**锐化**」在此属于**图片处理参数**，不是视频锐化。来源同上 URL。
- KS3 唯一的「AI 视觉」能力是**数据智能理解**：操作名 `llm/completions`，通过 `?x-kss-process=llm/completions` 调用，输入 `ks3://<bucket>/<object>` 的图片或视频，输出**文字理解结果**（含 `fps`「视频截帧频率，取值范围 (0.2, 10)，默认 1.0」），是**多模态内容理解**，**不是画质增强**。仅支持北京/上海，需开通数据处理并**通过商务经理或提交工单申请试用**（单账号 100 万 token 试用额度）。
  来源：https://docs.ksyun.com/documents/45302（《基于对象存储的视觉识别与理解》，**最近更新 2026-06-29 16:30:18**）

**KS3 结论**：KS3 没有文件级超分/插帧/画质增强，连音视频转码都没有。KS3 侧只有**图片处理**（含锐化）与**内容理解**。

### 1.3 云转码 KET：有文件级转码 API，但**没有**超分/插帧/去噪字段

产品入口：https://docs.ksyun.com/products/34

**（a）营销宣称 —— 唯一的「超分辨率」字样来源**

> 《产品优势》原文：「**AI去噪增强** 提供AI深度学习视频处理工具包，该工具包由**超分辨率、去噪、去模糊、锐化、对比度增强**等多个算法模块组成。」
> 同页另有：「视频内容分割 通过ROI区域检测，可将视频内容画质增强处理的更加精细化」「噪声修复 深度学习生成式对抗网络模型并引入注意力机制」

来源：https://docs.ksyun.com/documents/1196（《产品优势》，**最近更新 2021-06-23 17:54:05**）

**（b）产品功能清单里没有这些能力**

《产品功能》列出的点播转码能力为：文件格式及编码格式转换、音视频信息提取、预设/自定义转码模板、截图与采样截图、水印、音视频切片、Dash 多档码率/分辨率/帧率、视频剪辑、音视频拼接、视频画面旋转、外挂字幕、视频转 GIF、音视频抽取。**列表中没有超分、插帧、画质增强、去噪、锐化、HDR。**
来源：https://docs.ksyun.com/documents/1195（**最近更新 2024-08-15 11:33:58**）

**（c）API 全量字段 —— 决定性证据：无增强参数**

《模板说明》给出**全部 6 类模板**及其 Param 明细（**最近更新 2024-08-15 10:42:07**，来源 https://docs.ksyun.com/documents/2387）：

- 模板类型：`avtrans`（转码/拼接/格式转换/水印/切片）、`avsnapshot`（单张截图）、`avinfo`（音视频信息获取）、`avsample`（采样截图）、`audiowave`（音频波形）、`aiproduction`（智能媒体生产）
- 公有参数：`Preset`、`Description`、`PresetType`、`Param`、`Kshd`（集智高清开关，0 关 1 开）
- `avtrans` Param：`f`（容器格式：mp4/flv/hls/mpegts/mp3/adts/dash/gif）、`AUDIO`、`VIDEO`、`LOGOS`、`mulrate`、`CLIP`、`zdParams`
- **`VIDEO` 全部字段**：`vr`(帧率 1–120)、`vb`(码率)、`vcodec`(h264/h265)、`width`、`height`、`mulVb`、`mulRes`、`mulVr`、`shortSide`、`as`、`vn`、`intervalframes`（转 gif 抽帧间隔）、`loop`、`finaldelay`
- `zdParams` 全部字段：`video_tpye`（0 通用 / 1 秀场 / 2 游戏 / 3 动画）——集智高清的内容类型档位
- `aiproduction` 的 `function_name` **仅支持 `smart_cover`（智能封面）**

→ **没有任何超分倍率、插帧、去噪、去块、锐化、SDR→HDR、修复参数。**
`Kshd` + `zdParams` 是**编码质量优化/压缩档位**（对应「集智高清」「KSC265」），不是超分辨率。

**（d）任务接口与调用形态**

《创建任务接口(CreateTask)》（**最近更新 2024-04-12 17:29:01**，来源 https://docs.ksyun.com/documents/2397）：

- 请求：`POST /?Action=CreateTask&Version=2017-01-01` + AWS4-HMAC-SHA256 签名（`X-Amz-Algorithm` / `X-Amz-Date` / `X-Amz-Credential` / `X-Amz-SignedHeaders` / `X-Amz-Signature`）
- 示例 Host：`kvs.cn-beijing-6.api.ksyun.com`
- 参数：`Preset`、`Pipeline`、`SrcInfo[]{path,type,index}`、`DstBucket`、`DstObjectKey`、`DstDir`、`DstAcl`、`IsTop`、`CbMethod`、`CbUrl`、`ExtParam`
- 返回：`TaskID` / `ErrNum` / `ErrMsg`
- `ExtParam`（avtrans）可传：`Callback{progress_cburl, progress_cbmethod, progress_interval}`、`ss`、`duration`、`segment_filename`、`vol_percent`、`vol_dB`、`mulHlsRate`、`masterSrcIndex`、`passParams{max_muxing_queue_size}`、`hlsKey`、`subtitle`
- **形态**：**文件级 + 异步**。源文件用 **KS3 相对路径**引用（`path: "/mysrcbucket/myobject/mykey.mp4"`），输出到指定 Bucket；**不支持任意 URL 直传源文件**。
- **轮询**：`GetTaskList` / `GetTaskByTaskID`（https://docs.ksyun.com/documents/2402）/ `GetTaskMetaInfo`（https://docs.ksyun.com/documents/2403）；也可用进度回调 `progress_cburl`。

**（e）输入限制与规格限制**

- 《点播转码规格限制》（**最近更新 2024-08-15 10:42:07**，来源 https://docs.ksyun.com/documents/6138）：服务开通后默认支持并发 **10 个**点播转码任务，**并发最多不超过 50**（需**工单申请**）；单用户提交作业 ≤100 次/秒；单用户查询作业 ≤100 次/秒；连接/读超时 10s；每分钟接口请求 ≤500 次（可工单）；错误日志保留 30 天；**「点播处理…不保证时效性」**。
- 《排障常见问题》（**最近更新 2020-11-09 15:10:47**，来源 https://docs.ksyun.com/documents/6144）：错误码 2062「客户视频源**时长超过 50 小时**，无法转码」；3101「目前**仅支持源文件位于 ks3 上**」；2049「设置了禁止分辨率、码率小转大，导致小转大任务失败」（即默认**禁止小分辨率转大**——这与「超分」在语义上是对立的）。
- 《产品功能》给出的输入容器格式：3GP、AVI、ASF、FLV、GIF、MOV/QuickTime/MP4、MTS/M2TS、M3U8、MPG、MKV、RM/RMVB、MPEG-TS、WMV、WebM 等；输出容器：FLV、MP4、MPEG-TS、M3U8、GIF、Webp、MP3、ADTS、FLAC、DASH 等。来源 https://docs.ksyun.com/documents/1195。

**（f）服务地域（中国大陆）**

《服务地域》（**最近更新 2021-03-23 15:46:42**，来源 https://docs.ksyun.com/documents/5856）：
- 华北1（北京）`ket.cn-beijing-6.api.ksyun.com`
- 华东1（上海）`ket.cn-shanghai-2.api.ksyun.com`
→ **仅中国大陆**。

**（g）开通前置**

《快速入门 - 点播转码》（**最近更新 2024-08-15 10:47:58**，来源 https://docs.ksyun.com/documents/5855）原文：「注意：以上 Step1（开通 KS3 服务）、Step3（**开通点播转码服务**）需要**联系商务开通**，其他步骤如有问题请联系技术支持。」
→ **需商务/工单开通，非自助**。（未抓到「必须企业实名」的明文条款 → 该点**未证实**。）

**（h）计价方式与具体单价（官方定价页）**

- 《价格总览》（**最近更新 2020-10-27 20:11:24**，来源 https://docs.ksyun.com/documents/1200）正文仅一句「价格总览详见 [转码产品价格]」，链接指向 **`https://sw.ksyun.com/pro/calc/#/com/37445/doc`**（SPA 价格计算器）。
- 该 SPA 的文档正文由 API 提供，已抓到：**`https://www.ksyun.com/i/www/developer/article/getArtInfo/37445`**（标题「金山云-文档中心-云转码 KET」，**页面日期未知**，该接口无发布日期字段）。
- **点播转码 · 普通转码（元/分钟）**：

| 编码 | 分辨率 | 单价（元/分钟） |
|---|---|---|
| h.264 | 4K(3840×2160)及以下 | 0.278 |
| h.264 | 2K(2560×1440)及以下 | 0.136 |
| h.264 | 1080P(1920×1080)及以下 | 0.063 |
| h.264 | 720P(1280×720)及以下 | 0.0325 |
| h.264 | 480P(640×480)及以下 | 0.016 |
| h.265 | 4K 及以下 | 1.3406 |
| h.265 | 2K 及以下 | 0.6703 |
| h.265 | 1080P 及以下 | 0.3112 |
| h.265 | 720P 及以下 | 0.156 |
| h.265 | 480P 及以下 | 0.08 |
| 纯音频 | — | 0.0056 |
| 转封装 | — | 0.01 |

- **点播转码 · 集智高清（元/分钟）**：h.264 4K 0.84 / 2K 0.42 / 1080P 0.195 / 720P及以下 0.0977 / 480P及以下 0.0651；h.265 4K 4.2 / 2K 2.1 / 1080P 0.9765 / 720P及以下 0.4883 / 480P及以下 0.3255。
- **截图**：0.1 元/千张。
- 计费规则：按转码**输出文件时长 × 编码方式与分辨率单价**，以自然日为计费周期；后付费，自然月结算。
- **价格表中不存在「AI 增强 / 超分 / 修复」计费项** —— 这是「该能力未作为可售 API 开放」的第二个独立佐证。
- 参考：云直播 KLS 直播转码价格（**最近更新 2025-03-10 16:18:36**，来源 https://docs.ksyun.com/documents/38721）：h.264 480P及以下 0.016 / 480P-720P 0.0325 / 720P-1080P 0.063 / 1080P-2K 0.136 / 2K-4K 0.272；集智高清 h.264 2K-4K 1.0044，h.265 2K-4K 2.16（元/分钟）。

**（i）关键词穷举结果（官方检索 API）**

对 `超分辨率 / 老片修复 / 去噪 / HDR / 音视频处理 / 媒体处理 / 云点播 / 视频增强 / 插帧` 等词逐条检索 `docAndProduct`：
- `插帧` → `total=0`
- `HDR` → `total=0`
- `视频增强` → `total=0`
- `音视频处理` → `total=0`
- `老片修复` → `total=0`
- `超分辨率` / `去噪` → 各 `total=1`，**均为同一页**：https://docs.ksyun.com/documents/1196（上述 KET 产品优势营销页）
- `画质增强` → 命中的也主要是 1196 与云转码/直播转码相关页面的营销措辞

**金山云结论**：KET 提供**真正的文件级异步转码 API**（源文件须在 KS3），但**没有任何可调用的超分/插帧/去噪/锐化/HDR 参数、接口或计费项**；「AI 去噪增强工具包（含超分辨率）」只在 2021 年的产品优势页以营销措辞出现，**未证实**为已开放的 API 能力。KS3 自身不做视频处理。

---

## 2. 移动云（中国移动，ecloud.10086.cn）

### 2.1 文档可达性（怎么拿到的）

`https://ecloud.10086.cn/op-help-center/` 是 Vue SPA（Vue CLI 构建，`cloud-cms-service-web/12.8.1`）。首页 HTML 中可读出 API base 与路由常量：
- baseURL 常量：`eo.baseUrl + "/request-api"`（`eo.baseUrl = "/op-help-center"`）
- 路由常量：`/show/:id`、`/doc/article/:articleId`、`/api/article/:articleId`

**实际可用的接口**（全部实测 200 + JSON）：
| 用途 | 接口 |
|---|---|
| 栏目树（157 个产品，含 `outlineId`） | `GET /op-help-center/request-api/service-api/category/tree` |
| 产品目录树（含 `articleId`） | `GET /op-help-center/request-api/service-api/outline/tree?outlineId=<id>` |
| 全量 API 文档树（5827 条） | `GET /op-help-center/request-api/service-api/outline/api/tree` |
| 文章元信息（含正文 hash） | `GET /op-help-center/request-api/service-api/article/info/<articleId>` |
| 文章正文（**接收的是 info 里的 `content` hash，不是 articleId**） | `GET /op-help-center/request-api/service-api/article/content/<contentHash>` → 返回原始 HTML |
| 全站搜索（服务端渲染结果页） | `GET /op-help-center/search-engine/search/?q=<关键词>` |

踩过的坑：`service-api/article/content/59137` 直接传 articleId 会返回 `400 获取文件错误：【content-dir/article/59137】The specified key does not exist`；必须用 `info.content` 字段的 hash。

### 2.2 媒体相关产品线

栏目树中的视频服务分类：**视频点播（outlineId=378）**、**视频直播（379）**、**音视频通信（704）**；存储分类：**对象存储 EOS（358）**。

### 2.3 视频点播（VOD）：**完全没有超分/插帧/画质增强**

- 《API概览》（**最后修改 2023-07-10**，来源 https://ecloud.10086.cn/op-help-center/doc/article/40483）给出完整接口清单，按类：
  - 上传管理：`/vodupload/create_task`、`/vodupload/file_content`、`/vodupload/update_status`；`/vodUploadMulti/*`；`/vod2/t0/combineByVids`
  - 转码管理：`/vod2/t1/trans/create`、`/vod2/t1/trans/cancel`、`/vod2/t1/query/queryTransStatus`、`/vod2/t1/query/queryTransPercent`、`/vod2/t1/query/transTime`、`/vod2/t1/query/transSumTime`、`/vod2/t1/trans/createTransSliceTasks`、`/vod2/t1/trans/createHlsTask`、`/vod2/t1/query/queryTransHlsUrl`
  - 转码模板：`/vod2/t2/template/trans/updateTransTemplate`、`listTransTemplate`、`listCustomTemplate`、`queryAdvCustomTemplate`、`updateCustomTemplate`、`deleteCustomTemplate`、`saveAudioTemplate`
  - **窄带高清模板**：`/vod2/t2/addRapidHDTemplate`、`/vod2/t2/updateRapidHDTemplate`、`/vod2/t2/queryRapidHDTemplate`、`/vod2/t2/queryRapidHDTemplateInfo`
  - Logo(水印)模板：`/vod2/t2/template/logo/custom/addCustomLogo`、`delete`、`updateLogo`、`queryLogos`
  - 穿衣戴帽模板：`/vod2/t2/template/fashion/add|delete|edit|query`
  - 视频管理：`/vod2/v0/getVideoList`、`getVideoListForAdv`、`updateVideo`、`deleteVideo`、`publishVideo`、`updateVideoForCatalog`
  - 分类管理：`/vod2/v2/createCatalog|moveCatalog|updateCatalog|deleteCatalog|listCatalog`
  - 内容分发：`/vod2/v1/getUrl`、`getUrlVerify`、`batchGetPlayUrl`、`getDownloadUrl`、`getDownloadUrlForVids`
  - 回调：`/trans/finish_callback`；统计：`/stats/biz/*`；视频成片/源片查询：`/vod2/v1/getVideoAllUrl`
  → **没有任何超分 / 插帧 / 画质增强 / 去噪 / HDR 接口。**
- 《转码管理》（**最后修改 2023-11-03**，来源 https://ecloud.10086.cn/op-help-center/doc/article/40485）：`POST /vod2/t1/trans/create`，参数 `tasks[]{vid, screenShotId, priority(0普通/1热点/2绿色通道，暂未启用), needCombine, needTransMp4, audioGain(ebur128), imageDuration, subtitle{top, fontSize, fontColor, fontType, subtitleContent[]}}`
  → **无增强参数**。**异步**：可用回调 `cbFinishUrl`，或轮询 `queryTransStatus` / `queryTransPercent`。
- 《转码模板管理》（**最后修改 2023-11-03**，来源 https://ecloud.10086.cn/op-help-center/doc/article/40489）：
  - 默认模板更新字段：`transUpdate[]{vtype(0~4,default-5,dt-6..dt-11), outFormat(0:3gp,1:mp4,2:flv,3:hls,4:ts,5:mp3), flag}`
  - **窄带高清模板新增**字段（`/vod2/t2/addRapidHDTemplate`）：`templateId, uid, summary, transType(0-视频模板), transTemplateId, transTemplateName, enable, videoModel{gopsize(0-60000), gopsizeMin, refs(参考帧), bframes(B帧), scanType(progressive/mbaff), rateControl(VBR/CBR/CRF), frameRate(1~60), crf(0~51，默认23), enable, copy(视频透传), codecName(h264/h265), preset…}`
  → **纯编码器参数**，`窄带高清` = 编码压缩档位，**不是超分**；全文含 `HDR` 4 次、`窄带` 25 次、`高清` 28 次，但 `超分/插帧/增强/修复/去噪/锐化` 均为 0 次。
- 《产品功能》（**最后修改 2023-08-17**，来源 https://ecloud.10086.cn/op-help-center/doc/article/25339）：媒资管理、全局设置（转码设置 / 水印模板 / 截图模板 / 额度预警）、域名管理、**云剪辑（仅支持上海节点）**、视频审核（暂时下线）、视频拨测、数据统计、资源管理、API 功能 → 未列任何画质增强。
- 《使用限制》（**最后修改 2024-08-20**，来源 https://ecloud.10086.cn/op-help-center/doc/article/25349）：
  - 使用前提：**已注册移动云账号，且完成实名制**
  - 上传格式：仅支持 `*.mkv;*.flv;*.3gp;*.mp4;*.f4v;*.rmvb;*.avi;*.ts;*.wmv`
  - 单文件大小 **5GB**；批量最多 **300 个**文件、最多 **200GB** 同时上传
  - 页面上传视频码率需 **>200Kbps**
- 《上传管理》（**最后修改 2024-02-22**，来源 https://ecloud.10086.cn/op-help-center/doc/article/40484）：`GET /vodupload/create_task`，必填 `user_id, filename, title, file_size, md5, public_flag(41上线/42不上线), trans_flag(0转码/1不转码), trans_version(0流畅/1标清/2高清/3超清/4原画质), catalog_id`；**为客户端分片顺序上传 + 断点续传 + 秒传，未见 URL 直传源文件**。（`trans_version` 里的「超清」是分辨率档位名，不是超分。）
- 《价格总览》（**最后修改 2022-11-11**，来源 https://ecloud.10086.cn/op-help-center/doc/article/25346）：

| 计费项 | 规格 | 费用 |
|---|---|---|
| 分发流量 | 0–10TB / 10–50TB / 50–100TB / 100TB–1PB / >1PB | 0.235 / 0.225 / 0.206 / 0.2 / 0.198 元/GB |
| 峰值带宽 | 0–500Mbps / 500M–5Gbps / 5–20Gbps / >20Gbps | 0.57 / 0.551 / 0.532 / 0.513 元/Mbps/日 |
| 存储空间 | 每月前 50GB 免费；>50GB | 0.00559 元/GB/天 |
| 视频转码 H.264 | 流畅240p / 标清480p / 高清720p / 超清>720p | 0.018 / 0.021 / 0.053 / 0.092 元/分钟 |
| 视频转码 H.265 | 流畅240p / 标清480p / 高清720p / 超清>720p | 0.065 / 0.08 / 0.211 / 0.361 元/分钟 |
| 拨测次数 | — | 0.125 元/次 |

  计费项为：分发流量、带宽峰值、存储空间、视频转码时长、拨测次数。**无增强/超分计费项**（页面注：「后期计划增加2k、4k计费，具体上线时间以官网通知为准」）。

### 2.4 音视频通信（RTC）：**连实时增强也没有**

《产品功能》（**最后修改 2024-04-19**，来源 https://ecloud.10086.cn/op-help-center/doc/article/38119）全文 5 条：1）音视频通话；2）内容共享；3）通话质量监控；4）**智能调节 —— 提供码率和帧率的智能调节，保障了画质和流畅性的平衡效果**；5）快速邀请入会。
→ **无美颜、无暗光增强、无实时超分**。这是本次调研第 2 个「RTC 侧也没有增强」的明确证据。

### 2.5 对象存储 EOS：只有**图片**锐化

- 《锐化》（**最后修改 2025-09-24**，来源 https://ecloud.10086.cn/op-help-center/doc/article/95208）：`?x-eos-process=image/sharpen,<value>`，`value ∈ [50,399]`，**明确是「提高存储在 EOS 内原图的清晰度」——仅图片**。
- 《数据处理相关》（**最后修改 2026-08-10**，来源 https://ecloud.10086.cn/op-help-center/doc/article/63452）：只列「文档处理」（PDF 预览支持，**「对象存储当前不支持文档格式转换功能」**）。
- EOS 目录树关键词命中仅两条：`数据处理相关`、`锐化` —— **无任何视频处理条目**。

### 2.6 关键词穷举（三重交叉验证）

1. **全站搜索**：`/search-engine/search/?q=` 分别检索 `超分`(1103 条) / `插帧`(86 条) / `画质增强`(326 条) / `老片修复`(503 条)，**结果全部为无关命中**：`超分` → 专属宿主机「修改专属宿主机集群**超分比**」；`画质增强` → 「**增强**漏洞扫描」；`老片修复` → 云主机「LVM 灾难**修复**」等。平台搜索为模糊匹配，无一条指向视频增强。
2. **目录树关键词扫描**：遍历栏目树中全部 **157 个产品**的 `outline/tree`（共数千篇文章标题），关键词 `超分/超分辨率/插帧/补帧/画质增强/老片/修复/去噪/降噪/去块/锐化/HDR/4K/8K` 命中项中，**唯一与媒体处理相关的只有 EOS 的「锐化」（图片）**；`视频点播` 命中项仅 `转码管理 / 转码模板管理 / 文件转码时长 / 边上传边转码 / 转码与分发扩容`；`视频直播` 命中项仅 `在线转码模板` CRUD；`音视频通信` **零命中**。
3. **API 文档树扫描**：`/service-api/outline/api/tree` 共 **5827 条** API 条目，`超分/插帧/补帧/画质/增强/老片/修复/去噪/降噪/锐化/HDR` 中，与媒体相关的仅 `锐化`（EOS 图片）与 `视频截帧`（EOS）。

**移动云结论**：**完全没有**文件级超分/插帧/画质增强/老片修复 API。文件级能力只有**转码/剪辑/截图/水印/拼接**；RTC 侧也**只有码率与帧率自适应**，没有实时画质增强；对象存储只有**图片锐化**。

---

## 3. 天翼云（中国电信，www.ctyun.cn）

### 3.1 文档可达性（怎么拿到的）

`www.ctyun.cn/document` 及其子路径 `/document/<产品id>/<文档id>` 均为 **SSR，可直接 curl 抓正文**，页面带「最近更新时间」。搜索页 `/search?keyword=` 是 SPA（Nuxt 构建），但**检索接口可直接 POST**（从 `/search/_nuxt/pages/index.2fa5b28.js` 中读出）：

```
POST https://www.ctyun.cn/v2/search/api/doc/search
Content-Type: application/x-www-form-urlencoded
keyword=<词>&pageNo=1&pageSize=10[&objectType=help|book|developArticle|...]
```

返回 `data.global.list[]`，每条含 `objectType`（`help` / `book` / `developArticle` / `notice` / `solution`）、`objectName`、`objectUrl`。**这套接口是判定「天翼云是否有超分 API」的关键证据。**

（旁证：`GET https://www.ctyun.cn/api/search?keyword=超分` 返回 `{"returnCode":302,"message":"invalid accessKey"}`，不是可用接口。）

### 3.2 相关产品线

`https://www.ctyun.cn/document` 目录中与媒体相关：**云点播 CT-XVOD**（`/document/10464427`）、**视频直播 CT-LVDN**（`/document/10000093`）、**媒体存储 CT-XStor**（`/document/10306929`，原对象存储融合版）、**对象存储 ZOS**（`/document/10026735`）、智能视图服务（`/document/10011391`）、云电竞（`/document/10104015`）。

### 3.3 云点播 CT-XVOD：**没有超分/插帧/画质增强**

- 《功能介绍》（**最近更新时间 2026-03-19 15:01:49**，来源 https://www.ctyun.cn/document/10464427/10464455）原文「**媒体处理**」一节仅包含：
  - 音视频转码，覆盖主流常用格式，支持多分辨率、多码率，灵活可配置转码模板，支持自定义水印
  - 支持 H.264/H.265（HEVC）等常见编码类型的相互转码
  - 视频封面截图；支持自动截取视频首帧作为封面图
  → **无超分、无插帧、无画质增强、无去噪、无 HDR、无修复。**
- 《新增转码模板》（**最近更新时间 2026-04-09 17:50:57**，来源 https://www.ctyun.cn/document/10464427/10031389）：
  - `POST /template/transcode/create`，单用户 QPS 限制 20 次/秒
  - 字段：`name`、`transcodeTemplate{favorite, format(MP4/FLV/HLS), encrytion, video, audio, remark}`
  - `video{codec(H264/H265), bitRate, frameRate(默认24), height, width, autoRotate}`
  - `audio{codec(AAC/MP3), bitRate, sampleRate(44100/48000)}`
  → **无任何增强参数**。
- 云点播 API 目录（产品页左导航 `/document/10464427/` 提取到的 docId→标题映射）包含：创建视频V2（11093391，**最近更新时间 2026-04-10 10:43:27**，为**分片预签名 URL PUT 上传**，非 URL 直传）、完成上传视频、删除视频、提交转码任务（10031382）、搜索转码任务（10031373）、取得任务状态（10031372）、新增/搜索/取得/删除转码模板（10031389-10031394）、创建水印模板、发起截图任务（10187223）、新增拼接模板、回调（音视频转码完成-点播模式 10168513/11006425）→ **没有任何增强/超分接口**。
- 《计费项目》（**最近更新时间 2026-03-19 15:01:49**，来源 https://www.ctyun.cn/document/10464427/10464461）：

| 计费项 | 价格 |
|---|---|
| 下行流量（国内） | 0.5 元/GB |
| 存储空间（国内） | 0.12 元/GB/月 |
| 离线转码 H.264 | 4K 0.26 / 2K 0.13 / HD(1920×1080) 0.0627 / SD(1280×720) 0.0327 / LD(640×480) 0.0184 元/分钟 |
| 离线转码 H.265 | 4K 1.4 / 2K 0.7 / HD 0.3255 / SD 0.1628 / LD 0.1085 元/分钟 |
| API 请求次数（国内） | 0.1 元/千次 |

  服务开通前需确保天翼云账户预存 **>100 元**余额。**计费项中没有「增强/超分」条目。**

### 3.4 媒体存储 CT-XStor：只有**图片锐化**与**视频截帧**

- 《数据处理指南》左导航中「数据处理」下仅两类：**图片处理**（概述/图片样式/使用URL处理/缩放/格式转换/旋转/EXIF信息/质量变换/亮度/渐进显示/模糊/自定义裁剪/图片水印/自适应方向/获取平均色调/**锐化**(10103870)/对比度/内切圆/圆角矩形/索引切割）+ **视频截帧**（10027526）。**没有视频转码、没有超分、没有增强。**
- 《视频截帧》（**最近更新时间 2024-03-29 17:54:30**，来源 https://www.ctyun.cn/document/10306929/10027526）：
  - 参数：操作分类 `video`、操作名称 `snapshot`；`t`(截图时间 ms)、`w`、`h`、`m`(默认精确截图 / `fast` 取最近关键帧)、`f`(jpg/png)
  - URL 示例：`<原视频URL>?x-amz-process=video/snapshot,t_7000,f_jpg,w_800,h_600,m_fast`
  - 限制：**仅支持 H.264/H.265 视频文件截帧**；**仅部分资源池支持**，「如需使用，可联系客户经理或**提交工单申请**」
  → **只有取帧，没有增强。**
- 《产品优势》（**最近更新时间 2024-03-13 10:49:28**，来源 https://www.ctyun.cn/document/10306929/10103297）：全部讲存储扩容/成本/加速/可靠性，**无任何画质处理能力描述**。

### 3.5 对象存储 ZOS：锐化仍是**图片**参数

《锐化》（**最近更新时间 2025-04-14 10:26:58**，来源 https://www.ctyun.cn/document/10026735/10977370）：操作符 `sharpen`，取值 `[50,399]`，示例请求参数 `image/sharpen,100`（URL 前缀在图片处理概述中定义为 `?x-amz-process=image/…`）；页面标题为「对象存储 ZOS-数据处理指南-**图片处理**-图片处理参数」。
→ **仅图片**。ZOS 数据处理指南左导航只有图片处理，**无视频处理**。

### 3.6 视频直播 CT-LVDN：RTC/直播侧**也没有**窄带高清

《是否支持窄带高清转码》（**最近更新时间 2024-10-25 14:21:14**，来源 https://www.ctyun.cn/document/10000093/10216498）原文：

> 「**视频直播暂不支持窄带高清转码。** 视频直播支持标准转码，例如编码方式、码率、分辨率、帧率、水印以及纯音频输出等」

→ 直播侧连窄带高清都没有，**更没有超分/实时画质增强**。（其余直播侧能力见 `/document/10000093/` 目录：直播转码 / 录制 / 截图 / 审核 / 媒体处理模板 CRUD。）

### 3.7 关键词穷举 —— 唯一「超分」命中是一篇**社区用户投稿**

对检索接口按类型过滤穷举（`objectType=help` / `book` = 官方文档）：

| 关键词（objectType=help） | 官方文档命中 |
|---|---|
| `视频增强` | 全部无关（增强高速网络、网络增强型、视频拼接、AI加速型…） |
| `图像增强` | 全部无关（**锐化**（ZOS 图片）、图片色彩、增强高速网络…） |
| `超分` | 全部无关（超**卖**调度、数据切**分**策略、**分**片数目、云主机超**分**比…） |
| `插帧` | 全部无关（视频截帧、巨型帧、帧率…） |
| `超分辨率` / `画质增强` / `老片修复` | 同样无任何官方文档命中 |

**唯一强相关内容**（`objectType=developArticle`，即**开发者社区文章**）：

- 标题：《画质提升技术：深度解读天翼云所使用的智能超分、HDR、画质修复等AI增强处理能力》
- URL：https://www.ctyun.cn/developer/article/797889601941573
- 页面显示时间：**2026-05-07 14:23:53**，作者「思念如故」
- **页脚原文声明**：「**版权声明：本文内容系天翼云实名用户自发贡献，版权归原作者所有，天翼云开发者社区不拥有其著作权，亦不承担相应法律责任**」
- 正文通篇为泛论：「某图像超分辨率技术采用自研深度学习框架，支持 4K/8K 超高清输出…」「某流媒体平台通过超分技术…」「某修复版电影通过智能插帧技术将帧率从 24fps 提升至 60fps…」，**未点名任何天翼云产品或接口，未出现任何 API 路径/参数/计费项**。

→ 判定为**二手来源（社区投稿，可信度低）**，**不构成天翼云具备该产品能力的证据**。注意：该文标题会被搜索引擎与站内检索当成「天翼云有超分」的证据，属于典型误导，建议在结论中显式标注。

**天翼云结论**：**完全没有**文件级超分/插帧/画质增强/老片修复 API。官方文档中「增强」类能力只有**图片锐化**（XStor / ZOS）与**视频截帧**（XStor，需工单）；云点播与视频直播只有标准转码，直播侧明确「暂不支持窄带高清转码」。

---

## 4. 联通云（cloud.wo.cn）—— **未证实**

站点**完全不可达**，因此**任何能力判断都无法做出**。

实测结果（**抓取日期 2026-10-04**）：

| URL | 结果 |
|---|---|
| `https://cloud.wo.cn/` | **403 Forbidden**（`Server: uni-ahwh-mce-01-003`，`Powered by uengine/1.0.1-50.release.el7` / tengine；响应体提示「请报告此消息并附上以下信息」，属 WAF 拦截） |
| `http://cloud.wo.cn/` | 403 |
| `https://cloud.wo.cn/op-help-center/` | 502 Bad Gateway (nginx) |
| `https://cloud.wo.cn/op-help-center` | 502 |
| `https://cloud.wo.cn/document` | 502 |
| `https://cloud.wo.cn/docs` | 502 |
| `https://cloud.wo.cn/product` | 502 |
| `https://cloud.wo.cn/product/vod` | 502 |
| `https://cloud.wo.cn/product/media` | 502 |
| `https://cloud.wo.cn/index.html` | 502 |
| `https://cloud.wo.cn/official/` | 502 |
| `https://cloud.wo.cn/sitemap.xml` | 502 |
| `https://cloud.wo.cn/robots.txt` | 502 |
| `web_fetch https://cloud.wo.cn/`（另一条网络通路） | 403（同样信息） |
| `https://www.wocloud.com.cn/` | 连接失败（curl exit 6，无法解析/连接） |
| `https://yun.wo.cn/` | 连接失败 |
| DNS `docs.cloud.wo.cn` / `yun.wo.cn` / `docs.wo.cn` / `api.cloud.wo.cn` | **不存在（DNS 解析失败）** |
| DNS `cloud.wo.cn` | 112.123.39.19；`www.cloud.wo.cn` 112.123.39.21（域名存在，但 HTTP 被拦/后端 502） |

补充检索尝试：`cn.bing.com` 检索「联通云 媒体处理 视频点播 文档」仅返回中国联通官网/网上营业厅等运营商页面，**无任何有效产品文档结果**；本次会话的 `web_search` 工具因上游返回 `HTTP 402 Insufficient Balance` 而**不可用**（属工具可用性限制，非站点问题）。

**联通云结论**：**未证实**。既无法确认其是否有文件级超分/插帧/画质增强 API，也无法确认其是否提供媒体处理/视频点播产品。建议后续以商务渠道或工单方式向联通云索取产品文档，或在可访问网络环境下重试。

---

## 5. 汇总对比表

### 5.1 能力覆盖（文件级成片处理）

| 能力 | 金山云 KET | 移动云 VOD | 天翼云 云点播 | 联通云 |
|---|---|---|---|---|
| 文件级转码 API（输入 MP4 对象） | ✅ `CreateTask`（源须在 KS3） | ✅ `/vod2/t1/trans/create` | ✅ 提交转码任务 | 未证实 |
| 异步 + 轮询 | ✅ `GetTaskList` / `GetTaskByTaskID` / `GetTaskMetaInfo` + 进度回调 | ✅ 回调 `cbFinishUrl` / `queryTransStatus` / `queryTransPercent` | ✅ 取得任务状态 / 转码完成回调 | 未证实 |
| 超分倍率 | ❌ 无参数（仅 2021 年营销宣称） | ❌ 无 | ❌ 无 | 未证实 |
| 插帧 / 补帧 | ❌（检索 `插帧` total=0） | ❌ 无 | ❌ 无 | 未证实 |
| 去噪 / 去块 | ❌ 无参数（仅营销宣称） | ❌ 无 | ❌ 无 | 未证实 |
| 锐化 | ❌ 视频无（KS3 有**图片**锐化） | ❌ 视频无（EOS 有**图片**锐化 `image/sharpen`） | ❌ 视频无（XStor/ZOS 有**图片**锐化 `image/sharpen`） | 未证实 |
| SDR→HDR | ❌（检索 `HDR` total=0） | ❌ 无 | ❌ 无 | 未证实 |
| 老片修复 | ❌（检索 `老片修复` total=0） | ❌ 无 | ❌ 官方文档无（仅社区投稿提及） | 未证实 |
| 内容类型相关的编码优化 | ✅ `Kshd` 集智高清开关 + `zdParams.video_tpye`(0通用/1秀场/2游戏/3动画) | ✅ 窄带高清模板（GOP/refs/bframes/CRF 等编码器参数） | ❌ | 未证实 |
| 其他文件级媒体能力 | 截图/采样截图/水印/剪辑/拼接/旋转/字幕/转 GIF/音视频抽取/Dash 多码率 | 转码/剪辑(仅上海节点)/截图/水印/拼接/图片转视频/字幕/音频增益 | 转码/截图/水印/拼接/裁剪任务/HLS 预览/加密 | 未证实 |

### 5.2 实时（RTC/直播）增强

| 项 | 金山云 | 移动云 | 天翼云 | 联通云 |
|---|---|---|---|---|
| RTC/直播实时画质增强（暗光/美颜/实时超分） | **未证实**（KLS 直播转码支持标准转码与集智高清档位，未见实时增强 API 条款） | **无**：音视频通信只列「码率和帧率的智能调节」 | **无**：视频直播明确「暂不支持窄带高清转码」 | 未证实 |

### 5.3 输入限制 / 开通前置 / 地域

| 项 | 金山云 KET | 移动云 VOD | 天翼云 云点播 | 联通云 |
|---|---|---|---|---|
| 源文件来源 | **必须在 KS3 上**（`SrcInfo.path` 为 KS3 相对路径；排障页：「目前仅支持源文件位于 ks3 上」） | 客户端分片上传（`/vodupload/create_task`，需 md5），**未见 URL 直传** | 分片上传到预签名 URL（PUT），**未见 URL 直传** | 未证实 |
| 输入格式（官方列举） | 容器：3GP/AVI/ASF/FLV/GIF/MOV·MP4/MTS·M2TS/M3U8/MPG/MKV/RM·RMVB/MPEG-TS/WMV/WebM 等 | 上传仅限 mkv/flv/3gp/mp4/f4v/rmvb/avi/ts/wmv | 视频：wmv/mpg/mts/webm/m4v/mp4/flv/rmvb/avi/mov/mpeg/mkv/3gp/ts 等 | 未证实 |
| 大小 / 时长限制 | 源时长 >50 小时无法转码（错误码 2062）；默认**禁止小分辨率转大**（错误码 2049） | 单文件 ≤5GB；批量 ≤300 个文件 / ≤200GB；页面上传码率需 >200Kbps | 未抓到明确上限 → **未证实** | 未证实 |
| 并发/配额 | 默认并发 10 个，上限 50（**工单**）；提交/查询 ≤100 次/秒；接口 ≤500 次/分钟（可工单）；超时 10s；日志保留 30 天 | 未抓到 → **未证实** | 新增转码模板单用户 QPS 20 次/秒 | 未证实 |
| 开通前置 | **需联系商务开通** KS3 与点播转码服务（官方原文）；是否需企业实名 → **未证实** | **需注册 + 实名制**（官方原文）；开通需订购（账户余额要求未抓到） | 服务开通前需账户预存 **>100 元**；视频截帧**需工单/客户经理申请** | 未证实 |
| 中国大陆节点 | ✅ 华北1（北京）、华东1（上海），服务地址 `ket.cn-beijing-6.api.ksyun.com` / `ket.cn-shanghai-2.api.ksyun.com` | ✅（资源池清单未逐条抓取 → 未完全证实） | ✅（产品页/资源池列表未逐条核对 → 未完全证实） | 未证实 |
| 计价方式 | 按输出文件时长 × 编码方式与分辨率单价，后付费、自然月结算 | 按分发流量/峰值带宽 + 存储 + 转码时长 + 拨测次数 | 按需计费：下行流量 + 存储 + 离线转码 + API 请求次数 | 未证实 |
| 是否有「增强」计费项 | ❌ 无（仅普通转码/集智高清/截图） | ❌ 无 | ❌ 无 | 未证实 |

---

## 6. 关键判断：RTC 实时增强 ≠ 文件级超分

本次调研中必须显式区分两类能力，否则极易把营销话术误读成产品能力：

1. **RTC / 直播实时增强**（推流链路内、逐帧实时处理：暗光增强、美颜、实时超分、降噪）
   — 本次 4 家中：**移动云音视频通信完全没有**（只有码率/帧率智能调节）；**天翼云视频直播明确「暂不支持窄带高清转码」**；金山云云直播 KLS 只抓到标准转码与集智高清编码档位，**未见实时增强 API 条款（未证实）**；联通云未证实。
2. **文件级成片增强**（对已成片 MP4 对象发起异步任务，产出增强文件）
   — 本次 4 家中：**一家都没有公开可调用的 API**。

**特别提醒两类易混淆项**：

- **「集智高清」/「窄带高清」不是超分。** 金山云 `Kshd` + `zdParams.video_tpye`、移动云「窄带高清模板」（GOP / refs / bframes / rateControl / CRF）在文档中都被定义为**编码参数与压缩档位**（同画质下省带宽），它们**降低或维持码率**，与「提升分辨率/补帧」语义相反。金山云排障页的错误码 2049「设置了禁止分辨率、码率**小转大**，导致小转大任务失败」更是直接说明其转码链路**默认禁止**放大分辨率。
- **「锐化」在 4 家都只存在于图片处理。** 移动云 EOS `?x-eos-process=image/sharpen,<50-399>`、天翼云 XStor/ZOS `image/sharpen,<50-399>`、金山云 KS3 图片处理「锐化」，**全部是图片参数**，不能用于视频。
- **「超清」是分辨率档位名，不是超分。** 移动云 `trans_version` 的 `3-超清`、天翼云转码规格里的 `超清>720p`、金山云价格表里的「超清」，都只是输出分辨率档位标签。
- **社区文章不能当产品证据。** 天翼云站内检索 `超分` 命中的那篇《画质提升技术：深度解读天翼云所使用的智能超分、HDR、画质修复等AI增强处理能力》，页脚明确是「天翼云实名用户自发贡献，版权归原作者所有」，正文使用「某图像超分辨率技术」这类泛指措辞，未提及任何天翼云产品/接口/价格。

---

## 7. 未证实清单（本次尝试过的所有 URL 与结果）

### 7.1 金山云（docs.ksyun.com / ksyun.com）

| URL | 结果 |
|---|---|
| `https://docs.ksyun.com/` | 200，但为 SPA 外壳，正文由 JS 渲染；从中读出检索 API 路径 |
| `https://docs.ksyun.com/sitemap.xml` | 200，实际返回**首页 HTML**（非 sitemap），无效 |
| `https://docs.ksyun.com/products/34` | ✅ KET 产品页（含 12 个文档链接） |
| `https://docs.ksyun.com/products/25` | **未抓取**（productId=25 = 对象存储(KS3)，由检索 API 的 `products` 字段得出，非页面实测） |
| `https://docs.ksyun.com/products/3` `/24` `/52` `/88` | **未抓取**（仅出现在 `docs.ksyun.com` 首页导航 href 中） |
| `https://docs.ksyun.com/i/console/docs/new/search/docAndProduct?page=1&pageSize=20&q=<词>` | ✅ **官方检索 API**，本次主力穷举手段 |
| `https://docs.ksyun.com/documents/1193`（产品概述，2022-03-08） | ✅ |
| `.../documents/1194`（名词解释） | 未抓正文（导航中确认存在） |
| `.../documents/1195`（产品功能，2024-08-15） | ✅ **关键：能力清单无增强项** |
| `.../documents/1196`（产品优势，2021-06-23） | ✅ **关键：唯一「超分辨率/去噪/锐化」宣称来源，且为营销措辞** |
| `.../documents/1200`（价格总览，2020-10-27） | ✅（正文仅指向价格计算器外链） |
| `.../documents/2357` `/2358` `/2359` `/2360` `/2362` `/2363` `/2364` `/2365` `/2366` | 直播转码 API 系列（检索确认存在，未逐页抓取正文） |
| `.../documents/2385`（点播转码使用流程） | 未抓正文（检索确认存在） |
| `.../documents/2386`（点播转码API调用方式） | 未抓正文（检索确认存在） |
| `.../documents/2387`（**模板说明**，2024-08-15） | ✅ **关键：全量 Param 字段，无增强参数** |
| `.../documents/2389`–`2393`（Preset / UpdatePreset / DelPreset / GetPresetList / GetPresetDetail） | 检索确认存在，未逐页抓正文 |
| `.../documents/2397`（**CreateTask**，2024-04-12） | ✅ **关键：调用形态/参数/返回** |
| `.../documents/2402`（GetTaskByTaskID）`/2403`（GetTaskMetaInfo） | 检索确认存在（URL 来自检索结果） |
| `.../documents/5854`（直播转码快速入门） | 检索确认存在 |
| `.../documents/5855`（**点播转码快速入门**，2024-08-15） | ✅ **关键：需联系商务开通** |
| `.../documents/5856`（**服务地域**，2021-03-23） | ✅ **关键：北京/上海节点** |
| `.../documents/6137`（直播转码规格限制）`/6138`（**点播转码规格限制**，2024-08-15） | ✅（6138 已抓） |
| `.../documents/6144`（排障常见问题，2020-11-09） | ✅ **关键：50 小时限制 / 仅支持 KS3 源 / 禁止小转大** |
| `.../documents/42274`（**多媒体处理问题 FAQ**，页面日期未知） | ✅ **关键：KS3 不做视频转码，指向视频云** |
| `.../documents/45302`（数据智能理解，2026-06-29） | ✅（`llm/completions`，内容理解，非增强） |
| `.../documents/38721`（云直播价格，2025-03-10） | ✅（含集智高清转码单价） |
| `https://sw.ksyun.com/pro/calc/#/com/37445/doc` | 200，SPA（正文需 API） |
| `https://www.ksyun.com/i/www/developer/article/getArtInfo/37445` | ✅ **KET 价格正文 API** |
| `https://www.ksyun.com/i/newprice/price-cal/list?productId=37445` | ✅ 产品目录 JSON |
| `https://www.ksyun.com/i/newprice/price-cal/detail?productId=37445` | 400 `id may not be null` |
| `https://www.ksyun.com/i/newprice/price-cal/list/ptype?productId=37445` | 400 `id may not be null` |
| `https://resource.ksyun.com/project/www-doc/20260717175203/js/home.js` | 200（352 字节，仅工具提示逻辑，无 API） |

**金山云未证实项**：AI 去噪增强工具包（超分辨率/去模糊/锐化/对比度增强）是否可通过商务白名单或私有接口调用（公开文档与价格表中**无任何对应字段/接口/计费项**）；是否要求企业实名；KET 是否支持中国大陆以外节点（文档只列北京/上海）。

### 7.2 移动云（ecloud.10086.cn）

| URL | 结果 |
|---|---|
| `https://ecloud.10086.cn/op-help-center/` | 200，SPA 外壳 |
| `https://ecloud.10086.cn/op-help-center/service-api/outline/api/tree` | 200，但返回 **SPA HTML**（未走 `/request-api`，无效） |
| `https://ecloud.10086.cn/service-api/outline/api/tree` | **503 Service Unavailable** |
| `https://ecloud.10086.cn/op-help-center/search-engine/api/search?keyword=超分` | **404** |
| `POST https://ecloud.10086.cn/op-help-center/search-engine/search/` | 返回搜索 SPA HTML（非接口） |
| `GET https://ecloud.10086.cn/op-help-center/search-engine/search/?keyword=超分` | 渲染出「输入内容为空」（参数名错误，无效） |
| `GET https://ecloud.10086.cn/op-help-center/search-engine/search/?q=超分` | ✅ **服务端渲染搜索结果页**（模糊匹配） |
| `GET https://ecloud.10086.cn/op-help-center/request-api/service-api/category/tree` | ✅ 157 个产品 |
| `GET .../request-api/service-api/outline/api/tree` | ✅ 5827 条 API 条目 |
| `GET .../request-api/service-api/outline/tree?outlineId=378`（视频点播） | ✅ 147 条 |
| `...?outlineId=379`（视频直播） | ✅ 179 条 |
| `...?outlineId=704`（音视频通信 RTC） | ✅ 53 条 |
| `...?outlineId=358`（对象存储 EOS） | ✅ 1123 条 |
| `.../request-api/service-api/article/info/<id>` | ✅（多篇） |
| `.../request-api/service-api/article/content/59137` | **400**（须用 info.content 的 hash，不能用 articleId） |
| `.../request-api/service-api/article/content/<contentHash>` | ✅ 原始 HTML 正文 |
| `.../request-api/search-engine/search/suggest-global/article-product?...` | 400 `404 NOT_FOUND` |
| `.../doc/article/25339`（产品功能，2023-08-17） | ✅ |
| `.../doc/article/25346`（价格总览，2022-11-11） | ✅ |
| `.../doc/article/25349`（使用限制，2024-08-20） | ✅ |
| `.../doc/article/38119`（音视频通信产品功能，2024-04-19） | ✅ **RTC 无画质增强** |
| `.../doc/article/40483`（API概览，2023-07-10） | ✅ **无增强接口** |
| `.../doc/article/40484`（上传管理，2024-02-22） | ✅ |
| `.../doc/article/40485`（转码管理，2023-11-03） | ✅ |
| `.../doc/article/40489`（转码模板管理，2023-11-03） | ✅ **窄带高清仅编码参数** |
| `.../doc/article/59137`（视频成片操作，2023-08-30） | ✅（`/vod2/v1/getVideoAllUrl`，仅查询地址） |
| `.../doc/article/63452`（数据处理相关，2026-08-10） | ✅ |
| `.../doc/article/95208`（锐化，2025-09-24） | ✅ **图片锐化** |
| `.../doc/article/100461`（视频截帧，检索命中） | 未抓正文（属 EOS 图片/视频处理，非增强） |
| `.../doc/article/25339` 之外的 VOD 文档（媒资管理/域名管理/数据统计/资源管理等） | 未逐篇抓取 |

**移动云未证实项**：开通是否需工单/白名单（仅确认需实名 + 订购）；并发配额与转码时长上限；`/vod2/...` 接口的 host 与地域清单（文档只给了 `{host}` 占位）；是否支持源文件 URL 直传（上传接口未见该参数，但未逐篇穷举全部 147 篇）。

### 7.3 天翼云（www.ctyun.cn）

| URL | 结果 |
|---|---|
| `https://www.ctyun.cn/document` | ✅ 产品目录（SSR，含 166+ 产品链接） |
| `https://www.ctyun.cn/document/10464427/`（云点播） | ✅ 170 条 docId→标题映射 |
| `https://www.ctyun.cn/document/10306929/`（媒体存储） | ✅ 487 条映射 |
| `https://www.ctyun.cn/document/10000093/`（视频直播） | ✅ 294 条映射 |
| `https://www.ctyun.cn/document/10026735/`（对象存储 ZOS） | ✅ 导航已读 |
| `https://www.ctyun.cn/document/10464427/10464455`（功能介绍，2026-03-19） | ✅ |
| `https://www.ctyun.cn/document/10464427/10464461`（计费项目，2026-03-19） | ✅ |
| `https://www.ctyun.cn/document/10464427/10031389`（新增转码模板，2026-04-09） | ✅ **无增强参数** |
| `https://www.ctyun.cn/document/10464427/11093391`（创建视频V2，2026-04-10） | ✅（分片预签名上传） |
| `https://www.ctyun.cn/document/10306929/10027526`（视频截帧，2024-03-29） | ✅ |
| `https://www.ctyun.cn/document/10306929/10103297`（产品优势，2024-03-13） | ✅ |
| `https://www.ctyun.cn/document/10000093/10216498`（是否支持窄带高清转码，2024-10-25） | ✅ **明确不支持** |
| `https://www.ctyun.cn/document/10026735/10977370`（锐化，2025-04-14） | ✅ **图片锐化** |
| `https://www.ctyun.cn/search?keyword=超分` | 200，但结果由 JS 渲染（无正文） |
| `https://www.ctyun.cn/document/search?keyword=超分` | 200，同上（SPA） |
| `https://www.ctyun.cn/api/search?keyword=超分` | `{"returnCode":302,"message":"invalid accessKey"}`（不可用） |
| `POST https://www.ctyun.cn/v2/search/api/doc/search` | ✅ **可用检索接口**（本次穷举手段） |
| `https://www.ctyun.cn/developer/article/797889601941573` | ✅ 但为**社区用户投稿**（二手来源，不构成产品能力证据） |
| 云点播 10464427 下其余 160+ 篇文档（含 API 清单页 10040286、提交转码任务 10031382、取得任务状态 10031372 等） | 通过 docId→标题映射确认存在，未逐篇抓正文 |
| 云点播「使用限制」「产品优势」等页 | **未在目录中找到独立「使用限制」页 → 输入大小/时长上限未证实** |

**天翼云未证实项**：云点播单文件大小/时长上限与并发配额；云点播是否支持 URL 直传（已抓到的创建视频V2 为分片上传，未穷举全部 API）；资源池逐条清单（未逐条核对）；智能视图服务（`/document/10011391`）是否含视频增强（未抓正文，但其产品定位为视图设备接入/存储/分发/分析）。

### 7.4 联通云（cloud.wo.cn）

见第 4 节表格（全部 URL 与结果已列）。核心事实：根路径 **403（tengine/uengine WAF）**，子路径 **502 Bad Gateway**，`web_fetch` 亦 403，`docs.cloud.wo.cn` / `yun.wo.cn` / `docs.wo.cn` / `api.cloud.wo.cn` **DNS 不存在**。

**联通云未证实项**：全部（产品是否存在、是否有媒体处理/视频点播、是否有文件级或实时增强 API、计价、开通前置、地域）。

### 7.5 工具与流程限制（影响覆盖面，须如实记录）

1. **`web_search` 工具本次不可用**：调用返回 `HTTP 402 Insufficient Balance`（上游 endpoint `https://api.deepseek.com/anthropic/v1/messages`）。因此本次无法用通用搜索交叉验证二手来源，只能依赖各站自有检索能力 + 直接抓取。
2. **`cn.bing.com` 回退检索**：可用，但对联通云只返回运营商官网/网上营业厅，无有效产品文档结果。
3. 金山云、移动云首页均为 SPA，本次通过**其自有 JSON/markdown 接口**绕过（金山云 `docAndProduct` 检索 API + `getArtInfo` 价格 API；移动云 `/request-api/service-api/*`）；天翼云文档为 SSR，检索走 `v2/search/api/doc/search`。
4. 各站「最近更新时间」字段已逐条记录；服务端返回日期为 2026-10-04，可视为抓取日期。金山云 KS3 FAQ（42274）与 KET 价格计算器正文页**未提供日期字段**，标注为「页面日期未知」。

---

## 8. 最终答复（针对本次调研问题）

> **问题**：这 4 家是否提供文件级「视频超分 / 插帧 / 画质增强 / 老片修复」API？

- **金山云**：**只有官方营销宣称，无可调用 API（未证实）**。KS3 不做视频处理（FAQ 明说找视频云）；云转码 KET 有真正的**文件级异步转码 API**（`Action=CreateTask`，源文件须在 KS3，输出到 KS3，可轮询/回调），但模板与任务 API 的**全量字段中没有任何超分/插帧/去噪/锐化/HDR 参数**，价格表也没有对应计费项；唯一「超分辨率/去噪/去模糊/锐化/对比度增强」字样出现在 2021-06-23 的《产品优势》营销段落里。
- **移动云**：**完全没有**。视频点播全量 API 只有上传/转码/模板/水印/截图/拼接/分类/分发/回调/统计，无任何增强接口；全站搜索与 157 个产品目录树穷举均只命中 EOS 的**图片**锐化；RTC（音视频通信）**也只有码率与帧率智能调节**，无实时画质增强。
- **天翼云**：**完全没有**。云点播《功能介绍》的「媒体处理」只有转码/多分辨率多码率/水印/截图（首帧封面）；新增转码模板 API 字段仅 codec/bitRate/frameRate/height/width/autoRotate + 音频参数；官方文档检索 `超分/超分辨率/插帧/画质增强/视频增强/图像增强` **无任何命中**；视频直播明确「暂不支持窄带高清转码」；「锐化」只存在于 XStor/ZOS 的**图片**处理；唯一命中「超分」的是一篇未点名任何接口的**开发者社区用户投稿**。
- **联通云**：**未证实**。`cloud.wo.cn` 根路径 403（WAF）、子路径 502，相关文档子域名 DNS 不存在，`web_fetch` 亦 403；`web_search` 工具本次因上游余额不足不可用，无法补充二手来源。