# 04 · 托管 API / 第三方平台 / 云 GPU 专项调研（视频超分 + 插帧）

> 项目：libtv（漫剧/短剧 AI 视频生成平台，yunqueai.cloud）
> 需求：把生成的 480p 成片做「清晰化」——超分到 720p/1080p（2~3 倍）、去噪/锐化/修复、补帧（24/30fps → 60fps）
> 调研范围：除自建 GPU 之外的**托管 API / 第三方平台 / 云 GPU 自部署**三条路线
> 调研日期：**2026-10-04**（报告内所有「抓取日期」均为 2026-10-04）
> 汇率假设：**1 USD ≈ 7.1 CNY**（仅用于量级换算，非实时汇率）

---

## ⚡ 三行结论（先看这里）

1. **主力用腾讯云媒体处理（MPS）**：它已把「超分」和「插帧」做成公开计价的计费项，**480p→1080p+60fps 全包 ≈ ¥3.36/分钟**，人民币直付、可开增值税发票、**素材不出境**。
2. **境外 API 不能做主力**——不是因为价格，而是两个硬约束：**① 含人脸成片出境 = 敏感个人信息出境，哪怕一天只送 1 条也要标准合同备案或认证**（无"量小豁免"）；**② 跨境大文件传输 15–30% 失败或严重劣化**（实测上传仅 1.2 MB/s）。
3. **境外只做「无人物素材」的效果验证**。若要做，**Topaz 系直连官方 API（≈¥8.8–13.2/分钟）而不是 fal 代理（≈¥21.3/分钟，贵 2 倍且限 5 分钟）**；补帧用 **fal `fal-ai/rife/video`（¥0.06–0.6/分钟）** 最省。

---

## 0. 调研方法与证据等级说明

本报告的每一条结论都标注证据等级，请务必区分：

| 等级 | 含义 |
|---|---|
| **【实证】** | 本次实际抓取到官方页面/官方 API，引用了页面原文数字 |
| **【实证-API】** | 通过官方接口（如 fal 的 OpenAPI/模型索引接口）拿到的结构化数据，含模型 id 与计价原文 |
| **【实证-间接】** | 官方页面正文抓到，但该页面是 SPA，文本来自服务端渲染片段或 playground 内嵌文案 |
| **【未证实】** | 未能抓到硬证据，仅有搜索摘要或推算；**不得作为决策依据** |
| **【推算】** | 基于【实证】单价 + 明确写出的假设做算术推导，假设已标注 |

**本次调研的一个重要环境限制**：本执行环境的网络出口位于**美国（Los Angeles）**——抓取 Replicate 时响应头为 `cf-ray: ...-LAX`。因此**无法在本环境实测「中国大陆直连这些 API」的真实可达性与延迟**。报告中「中国大陆可用性」一栏若为网络链路的判断，均来自公开资料/法规检索，而非本次实测，已单独标注。**这一条对结论影响很大，请读者注意。**

另一个限制：内置 `web_search` 工具在当前会话不可用（余额不足），全部检索改走 `curl` + Bing 中国站 + 直接抓官方站点，并以官方 API 文档站为主证据来源。

---

## 0.5 执行摘要：统一成本对比表（人民币口径）

**统一口径**：
- 场景 = **1 分钟成片，480p(854×480)@30fps → 1080p@60fps**（除标注外）
- 汇率假设 = **1 USD ≈ ¥7.1**（**非实时汇率**；查询/折算日期 **2026-10-04**）
- 所有单价均为**官方页面实证**，人民币金额为**算术折算【推算】**
- **未计入**：对象存储、跨境带宽、失败重试、人工抽检成本

| # | 路线 | 具体方案 | 美元/分钟 | **人民币/分钟** | 素材出境 | 中国发票 | 时长限制 | 证据强度 |
|---|---|---|---|---|---|---|---|---|
| 1 | 🇨🇳 **国内云** | **腾讯云 MPS：超分(FHD@30)+插帧(FHD@60)+转码** | — | **¥3.36** | **否** | **可开** | 无声明 | **实证** |
| 2 | 🇨🇳 国内云 | 腾讯云 MPS：综合增强(FHD@60)+转码 | — | ¥3.66 | 否 | 可开 | 无声明 | 实证 |
| 3 | 🇨🇳 国内云 | 腾讯云 MPS：大模型视频增强(FHD@60)+转码 | — | ¥5.86 | 否 | 可开 | 无声明 | 实证 |
| 4 | 🇨🇳 国内云 | 腾讯云 MPS：只超分到 720p@30 + 转码 | — | **¥0.33** | 否 | 可开 | 无声明 | 实证 |
| 4b | 🇨🇳 国内云 | 腾讯云 VOD：超分(FHD@30)+插帧(FHD@60) | — | ≈¥3.28 | 否 | 可开 | 无声明 | 子任务 |
| 4c | 🇨🇳 国内云 | **火山 AI MediaKit 画质增强·标准版**（超分+插帧一个 SKU，1080P@60） | — | ¥3.0 | 否 | 可开 | 未声明 | ⚠️ **未复核** |
| 4d | 🇨🇳 国内云 | **火山 AI MediaKit 画质增强·极速版（1080P@60）** | — | **¥0.8** | 否 | 可开 | 未声明 | ⚠️ **未复核——若成立则为最便宜的一站式** |
| 4e | 🇨🇳 国内云 | 百度智能云 MCT：智能超分 + 智能插帧 | — | ¥1.2–2.4 | 否 | 可开 | 未声明 | ⚠️ 未复核 |
| 4f | 🇨🇳 国内云 | **阿里云 VIAPI：超分(≤720P@60) 0.8 + 插帧 6** | — | ¥6.8 | 否 | 可开 | 未声明 | **实证（按输入定档）** |
| 4g | ❌ 国内云 | 阿里云 MPS/IMS 超分（**"元/帧"口径陷阱**） | — | ¥5.86–90 | 否 | 可开 | — | ⚠️ 避险 |
| **S1** | 🖥️ **自建** | **共绩算力 4090 抢占式（RTF=5）** | — | **¥0.099** | **否** | 可开 | 自定 | 单价实证，**RTF 为假设** |
| S2 | 🖥️ 自建 | AutoDL 4090 按量（¥1.98/h，RTF=5） | — | ¥0.165 | 否 | 可开 | 自定 | 同上 |
| S3 | 🖥️ 自建 | AutoDL/共绩 4090 包月摊薄（RTF=5，利用率 100%） | — | ¥0.120 | 否 | 可开 | 自定 | 同上 |
| S4 | 🖥️ 自建 | 境外 RunPod Community 4090（RTF=5） | $0.028 | ¥0.201 | 是 | 否 | 自定 | 同上 |
| S5 | ❌ 自建 | 腾讯云 SCF GPU / 阿里云 FC GPU 函数 | — | ¥1.07–3.87 | 否 | 可开 | — | **比租 4090 贵 19–23 倍，避开** |
| 5 | 🌐 境外 API | **fal `bytedance-upscaler/upscale/video`**（一步出 1080p+60fps） | $0.864 | **¥6.1** | 是 | **否** | 未声明 | 实证 |
| 6 | 🌐 境外 API | fal `flashvsr`(超分) + `rife`(插帧) | ≈$1.91 | ¥13.6 | 是 | 否 | 未声明 | 实证+推算 |
| 7 | 🌐 境外 API | fal `seedvr`(超分) + `rife`(插帧) | ≈$3.77 | ¥26.8 | 是 | 否 | 未声明 | 实证+推算 |
| 8 | 🌐 境外 API | fal `fal-ai/topaz/upscale/video`（旧统一端点，1080p@60fps） | $2.40 | ¥17.0 | 是 | 否 | 未声明 | 实证-间接 |
| 9 | 🌐 境外 API | fal `topaz/upscale/video/precision`（1080p，10 秒口径→60fps） | ≈$2.40 | ≈¥17 | 是 | 否 | **5 分钟** | 实证（口径冲突） |
| 10 | 🌐 境外 API | **只补帧**：fal `fal-ai/rife/video`（30→60fps） | $0.0013/计算秒 | **量级应低，但 ⚠️ 未证实** | 是 | 否 | 未声明 | **单价实证，但官方未公布 GPU 秒数 → 无法换算【已降级】** |
| 10b | 🌐 境外 API | fal `topaz/interpolate/video`（Apollo/Chronos，30→60fps 1080p） | $0.30/10s | **≈¥12.8** | 是 | 否 | 5 分钟 | 实证 |
| 11 | 🏢 第一方 | **Topaz 官方 API：Proteus 超分 1080p + Apollo 补帧 60fps** | $1.24–1.86 | **¥8.8–13.2** | 是 | 否 | **无上限** | 实证（GP 口径官方确认） |
| 12 | 🏢 第一方 | Topaz 官方：Proteus 超分 1080p + **Apollo Fast** 补帧 | $0.94–1.41 | **¥6.7–10.0** | 是 | 否 | 无上限 | 实证 |
| 13 | 🏢 第一方 | Topaz 官方：**仅 Proteus 超分到 1080p**（不补帧） | $0.64–0.96 | **¥4.5–6.8** | 是 | 否 | 无上限 | 实证 |
| 14 | 🏢 第一方 | Topaz 官方：**仅 Proteus 超分到 720p** | $0.32–0.48 | **¥2.3–3.4** | 是 | 否 | 无上限 | 实证 |
| 14b | 🏢 第一方 | Topaz 官方：Starlight Precise 2.6 生成式超分 1080p | $11.0–16.6 | **≈¥79–118** | 是 | 否 | 无上限 | 实证（生成式，贵） |
| 15 | 🌐 境外 API | fal 托管 Topaz：`precision` + `interpolate`（1080p 30→60） | $3.00 | **≈¥21.3** | 是 | 否 | **5 分钟** | 实证 |
| 16 | 🌐 境外 API | **VanceAI `video_upscale`（仅超分，无插帧）** | ≈$0.029 | **¥0.21/分钟起** | 是 | 否 | 输出≤3840×2160 | 实证（官方"From 1 credit/min"） |
| 17 | 🌐 境外 API | Replicate `bytedance/video-upscaler`（vCube，含 `scene=short_series`） | $0.826 | **≈¥5.9** | 是 | 否 | 未声明 | 实证（按输出秒） |
| 18 | 🌐 境外 API | Replicate `topazlabs/video-upscale`（1080p@60fps） | $2.244 | ≈¥15.9 | 是 | 否 | 未声明 | 实证 |
| 19 | 🌐 境外 API | **Runway `/v1/video_upscale` + `enhance_frame_rate`** | ≈$2.70/10s（2k） | ≈¥19 | 是 | 否 | 超分 **30 秒**/插帧 300 秒 | 实证 |
| ❌ | 🌐 其他 | Cloudinary / Cloudflare / Mux / Wowza / Shotstack / Pruna / Deep-Image / Magnific / Let's Enhance / Higgsfield / Bitmovin | **无视频超分能力** | — | — | — | — | **官方反证**（§4.2.3） |

### 从这张表读出的六条关键判断

1. 🚨 **境外通道有两个"非价格"的硬约束，决定了它不能做主力**（详见 §6）：
   - **法律**：含可识别人脸的成片出境 = **敏感个人信息出境**，《促进和规范数据跨境流动规定》第五条(四) 的"不满 10 万人"豁免**明确排除敏感个人信息** → **哪怕一天只送 1 条视频，也需标准合同备案或认证**；且"去标识化"救不了（超分本身就是在重建人脸细节）。fal 的 DPA 又**没有任何中国 PIPL 对应机制**，连标准合同都缺对等文本。
   - **网络**：**15–30% 的跨境大文件传输失败或严重劣化**（实测 50MB 下载会从 12.9MB/s 掉到 13KB/s 并超时 180s），上传仅 **1.2 MB/s**。
   → **结论：境外 API 只能做"无人物素材的效果验证"，不能承接全量用户素材。**
2. 💰 **自建在单位成本上有数量级优势，但 RTF 是未验证的假设**：国内 4090（共绩抢占式 ¥1.19/h）在 **RTF=5** 下约 **¥0.10/分钟**，**比腾讯云 MPS（¥3.36）便宜约 30 倍**、比 fal（¥6.1）便宜约 60 倍。**注意**：RTF 无公开基准（Real-ESRGAN 与 SeedVR2 官方仓库均无吞吐数据；唯一可引用的是 RIFE README 的 "30+FPS for 2X 720p on 2080Ti"），故该数字为**假设组合推算，置信度低**，必须先自测校准。
3. **托管路线最优解：腾讯云 MPS ¥3.36/分钟（已复核）**，比境外最优（fal bytedance ¥6.1）便宜近一半，且**人民币直付、可开中国增值税发票、素材不出境、无跨境带宽成本**。**候选更优解（均 ⚠️ 未复核，需人工确认）：火山 AI MediaKit 极速版 ¥0.8、百度 MCT ¥1.2–2.4。**
4. ⚠️ **跨厂商比价必须先问清「按输入还是按输出分辨率定档」**——同一个 480p→1080p 需求可差近 **14 倍**（阿里云 VIAPI 按**输入** 480p 落最低档 ¥0.8；腾讯 MPS/CI、百度 MCT 按**输出** 1080p 落 FHD 档）。另要警惕**阿里云 MPS/IMS 的"元/帧"报价**（1080p@30fps 标准版 ¥5.86/分钟、专业版 ¥90/分钟）。**Topaz 系能力则应直连官方 API 而非 fal 代理**（官方 ¥8.8–13.2 vs fal ≈¥21.3，贵一倍且 fal 限 5 分钟）。
5. **「超分」和「补帧」的成本结构不同，可跨供应商拆分**：
   - **超分最便宜**：阿里云 VIAPI ≤720P@60 **¥0.8/分钟**（按输入定档）< 腾讯云 MPS FHD@30 **¥0.6** < Topaz 官方 Proteus ¥4.5–6.8 < fal FlashVSR ¥13.3；
   - **补帧最便宜**：腾讯云 MPS 插帧（¥1.2–2.7）≈ Topaz 官方 Apollo Fast（¥2.1–3.2）< 阿里云 VIAPI 插帧（¥6）。⚠️ **关于 fal `fal-ai/rife/video`：其计价是 `$0.0013/compute-second`，而官方从未公布实际 GPU 秒数，因此"约 ¥0.06–0.6/分钟"是本报告基于 RTF 假设的推算，证据不足——已降级为"量级应较低，但未证实"【原表述已更正】**；
   - **绝对要避开**：Topaz **生成式**档位（Starlight ≈¥79–118/分钟）、fal 的 Crystal（¥177）、FLUX video upscale（¥59.6）、Astra 创意超分、**国产云 Serverless GPU 函数**（比租 4090 贵 19–23 倍）、**Replicate 跑自有模型**（比自租 GPU 贵 3–4 倍）。
6. **纯超分（不补帧）成本几乎可以忽略**：720p 只要 **¥0.33**（腾讯云）或 **¥2.3**（Topaz 官方）。**建议 MVP 先只做「超分+去噪」**，把「补帧到 60fps」做成按量付费的增值项——这样即使定价便宜也能守住毛利。

### ⚠️ 成本区间的重要提醒（「档位」的价差远大于「厂商」的价差）

同一个「480p → 1080p@60fps」需求，成本可因**档位**相差 **40 倍**。做预算时**不要按最低档估**：

| 档位 | 方案 | 1080p@60fps 每分钟 |
|---|---|---|
| 最便宜 | Replicate/fal `bytedance-upscaler`（vCube 标准档） | **≈ ¥6** |
| 标准 | fal `topaz/upscale/video/precision` | ≈ ¥17 |
| 画质 | fal `topaz/upscale/video/generative`（**Starlight**） | **≈ ¥102**（$14.40） |
| 创意 | fal `topaz/upscale/video/creative`（**Astra 2**） | **≈ ¥256**（$36.00） |

→ **建议先锁 precision / bytedance 档，画质档只用于重点镜头。**

### 落地路径建议（一句话版）

> **第 1 步（本周，零工程）**：接腾讯云 MPS，验证"清晰化"能否带来付费转化。
> **第 2 步（并行）**：人工核实火山 AI MediaKit 极速版（¥0.8）与百度 MCT（¥1.2）——若成立，直接替换第 1 步。
> **第 3 步（月处理量 > 4,000–8,000 分钟后）**：自建 4090 管线（先用真实素材实测校准 RTF），成本降到 ¥0.1–0.25/分钟。
> **境外 API 全程只做无人物素材的效果对标，不进生产链路。**

---

## 1. fal.ai（证据最充分；但受 §6 合规与网络约束，**只宜作灰度/兜底**）

### 1.1 平台基本面【实证】

| 项目 | 事实 | 来源 |
|---|---|---|
| 运营主体 | **fal – Features & Labels, Inc.**（美国加州） | [ToS](https://fal.ai/legal/terms-of-service)（Last Updated: **2026-09-08**） |
| 计费方式 | **必须预充值 credits（prepaid credits）**，用量从余额扣减；**credits 自购买起 365 天过期** | 同上 Fees and Payment Terms 段 |
| 支付方式 | **仅支持「payment card」或美国 ACH，且以美元（U.S. Dollars）计价**。未提及支付宝/微信/银联/人民币 | 同上：*"Customer may use a payment card or Automated Clearing House (ACH) to pay for credits in U.S. Dollars."* |
| 税费 | 客户自行承担 sales/use tax、关税等 | 同上 |
| 管辖 | 加州法律，旧金山法院；含集体诉讼/陪审团弃权与仲裁条款 | 同上 |
| 出口管制 | 需声明自己不在美国禁运/受限国家或名单上。**中国大陆不在美国全面禁运名单内**，但 fal 未对华做任何专门承诺 | 同上 export 段 |
| 数据保留 | 生成媒体默认在 fal CDN **至少保留 7 天**（可用 `X-Fal-Object-Lifecycle-Preference` 头覆盖）；请求 JSON 载荷默认存 **30 天**（`X-Fal-Store-IO: 0` 可关闭存储） | [Data Retention](https://fal.ai/docs/documentation/model-apis/media-expiration)，[fal docs llms-full](https://fal.ai/docs/llms-full.txt) |
| 数据所在地 | **服务器位于美国及其他国家**（*"process and store personal information on servers located in the United States and other countries"*） | [Privacy Policy](https://fal.ai/legal/privacy-policy)（Last Updated: **2026-07-22**） |
| 数据处理附录 | DPA（Last Updated: **2026-07-31**）提供的是 **GDPR / 英国 IDTA / SCC** 机制，**全文无中国 PIPL 或数据出境标准合同的对应机制** | [DPA](https://fal.ai/legal/data-processing-addendum) |
| 可用区域（Serverless 自有部署） | 仅 **`us-west` / `us-central` / `us-east` / `eu-north` / `eu-west`** — **无亚太/香港/新加坡区域** | fal docs：`regions` 参数说明（llms-full.txt） |
| 免费额度 | 未发现通用的注册免费额度。仅有两类：① Sandbox 内偶发部分模型的 free credits（**仅在 Sandbox 可用**）；② **Complimentary credits 计划**，面向 filmmaker/creator/studio/agency，申请后**最高 $1,000**，需审核、不保证通过（[申请入口](https://fal.ai/agent-access/claim)） | fal docs llms-full.txt |
| 充值套餐 | Starter $50/月、Pro $200/月、Max $1,000/月（给等额月 credits + UI/Sandbox/CLI 折扣）；**API 用量永远是 pay-as-you-go，不享受该折扣** | fal docs llms-full.txt |
| 自有 GPU 托管价 | B300 $12.99/h（低至 $5.99）、GB200 $9.99/h、B200 $7.99/h、H200 $6.00/h（低至 $2.99）、**H100 $4.50/h（低至 $2.49）**、RTX PRO 6000 96GB $4.00/h（低至 $1.99） | [fal.ai/pricing](https://fal.ai/pricing) |

### 1.2 异步 / 并发 / webhook 机制【实证】

- **队列 + webhook 是官方推荐调用方式**：提交到持久队列后，用轮询或 webhook 取结果；`subscribe` 是带自动轮询的阻塞封装。详见 [Asynchronous Inference](https://fal.ai/docs/documentation/model-apis/inference/queue) 与 [Webhooks](https://fal.ai/docs/documentation/model-endpoints/webhooks)。
- **并发限制**（[Concurrency Limits 文档](https://fal.ai/docs/documentation/model-apis/concurrency-limits)，本次抓到全文）：
  - 限制的是 **`IN_PROGRESS` 状态**的请求数；`IN_QUEUE` 的排队请求**不计入**，所以可以随便提交，平台会自行调度。
  - **新账号默认并发 = 2**。随历史充值金额（近 4 周已付发票）自动提升，**自助上限 40**；再往上需联系销售（企业版可配专属每端点配额）。
  - **请求永不因并发限制被丢弃**——队列侧无最大重试次数，会一直等到有空位；唯一会丢的场景是设置了 `start_timeout` 且超时。
  - 429 响应带 `X-Fal-needs-retry: 1`，SDK 自带最多 10 次指数退避重试。**生产建议用 `subscribe()`（服务端队列重试）而不是 `run()`（客户端重试）**。
  - **在 fal Serverless 上调用自己的端点不受该并发限制约束**——这对"自部署兜底"很重要。
- **模型页的 playground 可直接看到计价文案**，这是本次拿到价格的最主要途径（fal 的模型索引接口 `https://fal.ai/api/models?keywords=...` 与队列 OpenAPI 接口 `https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` 均无需 token，可直接读）。

### 1.3 视频超分 / 增强 / 插帧模型清单（全部为实际抓取到的真实 model id）

以下所有 id 均通过 `GET https://fal.ai/api/models?keywords=...` 与
`GET https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<id>` **实际拉取验证通过**（HTTP 200 且返回有效元数据）。

#### A. 视频超分（upscale）

| model id | 标题 | 模型家族 | fal 托管版时长上限 | 输入/目标参数 | 计价（页面原文） | 证据日期 |
|---|---|---|---|---|---|---|
| **`fal-ai/bytedance-upscaler/upscale/video`** | Bytedance Upscaler（**BytePlus VOD 驱动**） | 代理 | 【实证】schema 未声明时长上限（按输出时长计费） | `target_resolution`: 1080p/2k/4k/6k/8k；`scale_ratio` 1.1–10（**>4K 报错**）；**`target_fps` 24–120**；`enhancement_tier`: fast/standard/pro；**`enhancement_preset`: general/**`ugc`**/**`short_series`（短剧！）**/**`aigc`**/old_film**；`fidelity`: high/medium；`bit_depth`: 8/10/12 | **1080p $0.0072/s、2K $0.0144/s、4K $0.0288/s（30fps 基准）；60fps 价格翻倍；`pro` 档位 ×10** | 页面 date 2025-10-31 |
| `fal-ai/seedvr/upscale/video` | SeedVR2 | **fal 自托管 serverless** | 未声明 | `upscale_mode`: target/factor；`target_resolution`: 720p/1080p/1440p/2160p；`upscale_factor` 默认 2；`noise_scale` | **$0.001 / 百万像素**（宽×高×帧数）。例：1920×1080×121 帧 = $0.25 | 2025-09-22 |
| `fal-ai/flashvsr/upscale/video` | FlashVSR（"最快"） | **fal 自托管 serverless** | 未声明 | `upscale_factor` 默认 2；`quality` 0–100（tile 融合）；`acceleration`: regular/high/full；**`preserve_audio`（可保留音轨）**；输出 X264/VP9/ProRes4444/GIF | **$0.0005 / 百万像素**（SeedVR2 的一半）。例：1920×1080×121 帧 = $0.125 | 2025-11-11 |
| `clarityai/crystal-video-upscaler` | Crystal Upscaler [Video] | 代理 | 未声明 | — | **$0.10 / 百万像素 / 秒**，按 **30fps 阶梯**乘系数：≤30fps ×1、≤60fps ×2、≤90fps ×3 | 2025-12-17 |
| `blackforestlabs/flux-video-upscale` | Flux Video Upscale（FLUX 3） | 代理 | 未声明 | precise / creative 两种模式；目标 1080p/2K/4K | **按输出秒计费**：precise **1080p $0.14/s**、2K $0.25/s、4K $0.55/s；creative **$0.20 / $0.35 / $0.79** per s。**仅对实际交付的输出计费** | 2026-08-20 |
| `topaz/upscale/video/precision` | Topaz Precision Video Upscale | 代理 | **5 分钟**（fal 侧限制，见 §1.5-3） | 模型：Proteus, Proteus Natural, Iris, Iris Low Quality, Dione DV/TV/Robust, Artemis HQ/MQ/LQ, Gaia HQ/CG/**Gaia 2**（2x，动画，半价）, Rhea, Theia…；`upscale_factor` 默认 2；**`target_fps` 16–60（与源不同时自动启用 Apollo 插帧）**；`noise`/`halo`/`compression`/`grain`/`recover_detail` 0–1 | **按 10 秒**：720p **$0.10**、1080p **$0.20**、4K **$0.60**；Proteus Natural 4K $0.50；**但同页又称「1 分钟标准 precision 模型 $0.40@720p / $0.80@1080p / $3.10@4K（以 30fps 计）」——两个口径互相矛盾，见 §1.5 存疑项** | date 2026-08-11 / published 2026-08-17 |
| `topaz/upscale/video/generative` | Topaz Generative Video Upscale（Starlight 扩散系） | 代理 | **5 分钟**（fal 侧限制） | 模型：Starlight Precise 2.6 / HQ / Mini / Sharp / **Fast 2**；`upscale_factor` 默认 2；**`target_fps` 16–60（启用 Apollo 插帧）**；`softness` 1–5 | 30fps 10 秒：1080p **$1.20**、4K $2.60（Starlight Precise 2.6/HQ/Mini/Sharp）；**Fast 2 为 $0.60 / $1.30**。**60fps 时翻倍**（$2.40 / $5.10；Fast 2 $1.20 / $2.60） | 2026-08-11 |
| `topaz/upscale/video/creative` | Topaz Creative Video Upscale（Astra 2） | 代理 | **5 分钟**（fal 侧限制） | 生成式"造细节"，适合风格化/动画/AI 生成素材；`creativity`、`realism`、`sharp`、`prompt`（1024 字符，**带 prompt 时输入限 450 帧**）；**`target_fps` 16–60**；注意 **Astra 2 会吸附到自己的输出分辨率**（通常升到 4K），**按实际交付分辨率计费** | 30fps 10 秒：1080p **$3.00**、4K **$5.00**；**60fps 翻倍**（$6.00 / $10.00） | 2026-08-11 |
| `bria/video/increase-resolution` | Bria 视频增分（最高 8K，"商用安全数据训练"） | serverless | 未声明 | `desired_increase`（playground 默认 2） | **$0.14 / 秒**（playground 计价文案）→ 1 分钟 **$8.40** | 2025-08-26 |
| `fal-ai/video-upscaler` | Video Upscaler（**逐帧 RealESRGAN**） | serverless | 未声明 | 仅 `scale`（默认 2） | **$0.0008 / 百万像素**（playground 计价文案）→ 1080p@30fps 1 分钟 = **$2.99**；720p@30fps = $1.33 | 2024-12-04 |
| `fal-ai/topaz/upscale/video` | **Topaz Video AI（旧版统一端点）** | 代理 | 未声明（playground 未写 5 分钟限制） | **Proteus v4 超分 + 可选 Apollo v8 插帧；官方描述「支持最高 8x 放大与 120 FPS 输出，设置 `target_fps` 即自动启用插帧」**；模型枚举含 Proteus/Artemis/Gaia/Nyx/**Starlight 全系** | **【实证-间接】playground 计价文案（当前默认 Starlight Fast 2）：「每秒 $0.01（≤720p）、$0.02（720p–1080p）、$0.08（>1080p）；60fps 价格翻倍；Gaia 2 半价」** | 端点存活（OpenAPI 200），无公开 date 字段 |

#### B. 视频插帧（frame interpolation）

| model id | 标题 | 关键参数 | 计价 | 证据 |
|---|---|---|---|---|
| **`topaz/interpolate/video`** | Topaz Frame Interpolation | **5 分钟上限**（fal 侧限制）；模型 **Apollo / Chronos / Aion**；**`target_fps`（默认 60）**；**`slowdown_factor` 1–8（须为整数）**，1 = 变速不变；仅插帧不超分（保持源分辨率） | 10 秒 30→60fps：**Apollo/Chronos $0.30@1080p、$0.60@4K**；**Aion $0.50@1080p、$1.70@4K**。慢动作按完整输出时长计费 | date 2026-08-11 |
| `fal-ai/rife/video` | RIFE（Real-Time Intermediate Flow Estimation） | `fps`（默认 8，仅当 `use_calculated_fps=False` 生效）；`num_frames` 生成帧数；**`use_calculated_fps`（默认 True = 源 fps × 倍率）**；`use_scene_detection`（场景切换去拖影）；`loop` | **$0.0013 / 计算秒** | 2025-07-22 |
| `fal-ai/film/video` | FILM（Frame Interpolation for Large Motion） | 同上（同族封装） | **$0.0013 / 计算秒** | 2025-07-22 |
| `fal-ai/amt-interpolation` / `fal-ai/amt-interpolation/frame-interpolation` | AMT | 帧间插值 | playground 显示 **"$0 per compute second"**（字面 0 元，疑似定价未配置或已免费化）——**不要依赖，需实测** | 2024-02-21 / 2024-07-18 |

#### C. 视频去噪 / 去模糊 / 其他修复（配合超分用）

| model id | 能力 | 时长上限 | 计价（30fps） |
|---|---|---|---|
| `topaz/denoise/video` | Nyx / Nyx Fast / Nyx XL / **Nyx HF**（Nyx HF 只去噪不超分）；`upscale_factor` 默认 1（保持源分辨率）；`noise`/`compression`/`halo` | **5 分钟**（fal 侧限制） | 10 秒 **$0.10@720p、$0.20@1080p、$0.60@4K**；**Nyx Fast 便宜**：$0.10@720p 与 1080p |
| `topaz/deblur/video` | Themis 2 运动去模糊（保持源分辨率与帧率） | **5 分钟**（fal 侧限制） | 10 秒 **$0.10（≤1080p）、$0.30@4K**；1 分钟 $0.40 / $1.40 |
| `topaz/colorize/video` | 上色 | 5 分钟（fal 侧限制） | 同 deblur 口径：1 分钟 $0.40 / $1.40 |
| `topaz/sdr-to-hdr/video` | Hyperion 2.5，SDR→HDR | 5 分钟（fal 侧限制） | **很贵**：10 秒 $2.40@1080p、$5.10@4K；1 分钟 **$13.90 / $30.60** |

#### D. 图像超分（用于封面/单帧，附带）

| model id | 计价 |
|---|---|
| `fal-ai/esrgan`（"Upscale Images"） | **$0.00111 / 计算秒** |
| `topaz/upscale/image/precision` | **$0.08 / 每 24 输出 MP**（≤24MP=$0.08，≤48MP=$0.16，≤72MP=$0.24） |
| `topaz/upscale/image/generative` | $0.08 / 每 8MP（Wonder 3/3.5）；$0.08 / 每 4MP（Wonder、Standard MAX、Redefine、Recovery 系） |
| `topaz/upscale/image/creative` | $0.08 / 每 2MP（Bloom 系）——注意这是最贵档 |
| `topaz/upscale/image/transparent` | 固定 4× 边长放大（16× 面积），保留 alpha，$0.08 / 每 24MP |
| `fal-ai/clarity-upscaler`（Clarity Upscaler） | **$0.03 / 百万像素**（playground 计价文案）——图像模型 |
| `fal-ai/creative-upscaler`、`fal-ai/aura-sr`、`fal-ai/seedvr/upscale/image` | 端点存活，价格需逐个在模型页确认 |

> 说明：**"ESRGAN / Real-ESRGAN" 在 fal 上对应的是 `fal-ai/esrgan`（图像）与 `fal-ai/video-upscaler`（视频，逐帧 RealESRGAN）**，两者都是较老的 serverless 端点。若要用 Real-ESRGAN 类方案，实践上更划算的是**自己打包部署到 serverless**，或直接用 FlashVSR/SeedVR2。

> **完整性校验**：为避免遗漏，本次以 10 组关键词（`upscale` / `upscaler` / `super-resolution` / `restore` / `enhance` / `denoise` / `deblur` / `fps` / `interpolation` / `frame-interpolation` / `video-enhance` / `video-upscaler` / `slow-motion` / `4k` / `quality` / `video-to-video` / `topaz`）对 fal 模型库做了扫掠，去重后共 **204 个模型**，其中属于「视频超分 / 插帧 / 视频修复」的**已全部列于上表**，未发现遗漏的独立视频超分/插帧端点。
> 另有若干**生成式**视频修复端点（非纯增强，会重绘内容，短剧人脸场景风险高，仅供参考）：`fal-ai/ltx-2.3-quality/deblur`（去模糊）、`fal-ai/ltx-2.3-quality/decompression`（去压缩伪影）、`fal-ai/ltx-2.3-quality/render-to-real`、`fal-ai/id-v2v/relight`。
> 纯图像类（不能用于视频）另有：`fal-ai/drct-super-resolution`、`fal-ai/nafnet/deblur`、`fal-ai/nafnet/denoise`、`fal-ai/recraft/upscale/crisp`、`fal-ai/recraft/upscale/creative`、`fal-ai/aura-sr`、`fal-ai/creative-upscaler`、`topaz/restore/image`、`topaz/denoise/image`、`fal-ai/image-apps-v2/photo-restoration`、`fal-ai/image-editing/face-enhancement`。

### 1.4 fal.ai 用于本项目的成本估算【推算，基于 §1.3 实证单价】

**场景定义**：1 分钟成片，源 854×480 @30fps（1800 帧），目标 **1920×1080 @60fps**。
像素量：1080p@30fps = 1920×1080×1800 ≈ **3732 MP**；1080p@60fps ≈ **7465 MP**；720p@30fps ≈ **1659 MP**。

| 方案（fal 端点） | 1 分钟到 1080p+60fps 的成本 | 折人民币 | 备注 |
|---|---|---|---|
| **`fal-ai/bytedance-upscaler/upscale/video`**（standard 档） | **$0.864** | **≈ ¥6.1** | **最便宜且一步到位**。自带 `target_fps` 24–120，直接出 60fps；有 `short_series`(短剧)/`aigc` 预设，与业务高度契合 |
| 同上（`pro` 档） | $8.64 | ≈ ¥61 | pro = 大模型修复，价格 ×10 |
| **`fal-ai/flashvsr/upscale/video` + `fal-ai/rife/video`** | $1.87 + ~$0.04 | **≈ ¥13.6** | FlashVSR 只超分；插帧另行调用 RIFE（RIFE 极便宜） |
| **`fal-ai/seedvr/upscale/video` + `fal-ai/rife/video`** | $3.73 + ~$0.04 | ≈ ¥26.8 | 质量优先，贵一倍 |
| **`fal-ai/topaz/upscale/video`（旧统一端点，默认 Starlight Fast 2）** | **$2.40** | ≈ ¥17.0 | 1080p 档 $0.02/s × 60s × 60fps 翻倍；<=720p 则 $1.20 |
| `topaz/upscale/video/precision`（1080p，按 10 秒口径） | $1.20（30fps）→ 约 $2.40（60fps） | ≈ ¥8.5 → ¥17 | ①fal 侧 5 分钟上限（Topaz 官方 API 无此限，见 §4）②口径矛盾见 §1.5 |
| `fal-ai/rife/video` 单独插帧（30→60fps，1080p） | **$0.008–$0.08** | ≈ ¥0.06–0.6 | 取决于 RTF：0.5x–1x 实时率 → 30–60 计算秒 |
| `topaz/interpolate/video` 单独插帧（1080p，Apollo/Chronos） | **$1.80** | ≈ ¥12.8 | 用 Aion 则 $3.00 ≈ ¥21.3 |
| **`fal-ai/video-upscaler`**（逐帧 RealESRGAN，**最便宜的"经典"超分**） | **$2.99**（1080p@30fps） | ≈ ¥21.2 | $0.0008/MP。**不含插帧**，需另接 RIFE；且是 2024 年旧端点，画质不如 FlashVSR |
| `bria/video/increase-resolution`（最高 8K，商用安全训练数据） | $8.40 | ≈ ¥59.6 | $0.14/s，**贵**；优势是 license 干净、可商用背书 |
| `clarityai/crystal-video-upscaler` | $24.88 | ≈ ¥177 | **不推荐**，MP/秒计价对高帧率极不友好 |
| `blackforestlabs/flux-video-upscale`（precise 1080p） | $8.40 | ≈ ¥59.6 | creative 模式 $12 ≈ ¥85 |
| `topaz/upscale/video/creative`（Astra 2，1080p 60fps） | $6.00 | ≈ ¥42.6 | 生成式造细节 |

**关键结论**：
1. **只做 480p→720p**（不补帧，或补帧用 RIFE）：
   - `fal-ai/bytedance-upscaler` 720p 档按比例约为 $0.0072/s 的 1080p 价之半 → 量级 **$0.2–0.4/分钟（≈¥1.5–3）**；Bytedance 端点计价表只列了 1080p/2K/4K，**720p 档位未在计价文案中列出，属【未证实】**。
   - `fal-ai/flashvsr` 720p@30fps = 1659 MP × $0.0005 = **$0.83/分钟（≈¥5.9）**。
   - `topaz/upscale/video/precision` 720p = $0.10/10s → $0.60/分钟（≈¥4.3），或按其 1 分钟口径 $0.40（≈¥2.8）。
2. **性价比最优组合（推荐先测）**：`fal-ai/bytedance-upscaler/upscale/video` 单端点搞定"超分 + 补帧 + 去噪 + 预设（short_series/aigc）"，**≈¥6/分钟**。它背后是 BytePlus VOD（字节），对短剧/AIGC 场景有专门预设，是本轮调研里**与 libtv 业务最贴合的一个端点**。
3. **最省钱的"自己拼"路线**：FlashVSR（超分）+ RIFE（插帧），**≈¥13.6/分钟**，且两者都是 fal 自托管 serverless（不依赖 Topaz 这类第三方代理，可控性更好），FlashVSR 还支持 `preserve_audio` 保留原音轨。**但注意它比 Bytedance 方案更贵，只在你不信任 Bytedance 代理链路时才有意义。**
4. **Topaz 系整体偏贵**，但 `topaz/upscale/video/precision`（非生成式、忠实还原）与 `topaz/interpolate/video`（Apollo 60fps）在"**不改变画面语义、只做工程级清晰化**"上最稳，适合质检要求高的场景。**生成式档位（Starlight/Astra 2）会"发明"细节，短剧人脸场景有失真风险，必须做人工抽检。**

### 1.5 fal.ai 存疑项与未证实项（务必注意）

1. **`topaz/upscale/video/precision` 计价自相矛盾【实证冲突】**：同一页既写"$0.10/10 秒@720p、$0.20@1080p、$0.60@4K"，又写"1 分钟标准 precision 模型 $0.40@720p、$0.80@1080p、$3.10@4K"。按 10 秒口径推算 1 分钟应是 $0.60/$1.20/$3.60。**两个口径差 1.2~1.5 倍，无法从页面判断哪个生效**（可能"按次取整"或长片有折扣）。
   → 本报告在做跨供应商对比时（§0.5 第 15 行、§4.1）**统一采用「按 10 秒」口径**（1080p precision $0.20/10s → $1.20/分钟），因为该口径使得 fal 托管版 Topaz 组合 = $0.20+$0.30 = $0.50/10s ≈ **$3.00/分钟 ≈ ¥21.3**，与 Topaz 官方 API 的 ¥8.8–13.2 形成保守（对 fal 不利）的比较。**投产前必须用小额真实调用实测出账。**
2. **大部分端点的价格已从模型页 playground 文案补齐**（`$0.14/s` Bria、`$0.0008/MP` video-upscaler、`$0.03/MP` clarity-upscaler）。剩余仍无公开价格的：`fal-ai/creative-upscaler`、`fal-ai/aura-sr`、`fal-ai/seedvr/upscale/image`、`fal-ai/amt-interpolation/frame-interpolation`。**不能用它们的价格做预算。**
3. **`fal-ai/bytedance-upscaler` 的 720p 档价格、以及各端点是否有输入分辨率/时长硬上限均未在 schema 中声明【未证实】**。
   **关于「5 分钟上限」的准确口径（重要修正）**：fal 托管的 **Topaz 系列端点**在其 `about` 文档中写明 *"Videos are limited to 5 minutes."*，已逐一实证于以下 6 个端点：
   `topaz/upscale/video/precision`、`topaz/upscale/video/generative`、`topaz/upscale/video/creative`、`topaz/interpolate/video`、`topaz/denoise/video`、`topaz/deblur/video`。
   出处（fal 官方接口，可直接复现）：`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<上述任一 id>` → 字段 `info.x-fal-metadata.about`，原文即 `Videos are limited to 5 minutes.`；渲染页为 `https://fal.ai/models/<id>`。
   **这一限制是「fal.ai 托管版」的实现约束，不是 Topaz 官方 API 的限制**——经核实（由项目方核实），Topaz 官方 API 文档中**没有任何输入时长上限**，其硬限制只有：输入文件 <100GB（>500MB 需 multipart，最多 150 个分片 URL）、请求 body ≤3000 字节；另有**处理超时**（非时长上限）：GAN 视频模型约 4 小时、生成式（Starlight/Astra）约 17 小时，超时按失败**全额退 credit**。详见 §4。
   → **⭐ 反直觉发现：香港中转不一定优于直连美西**【实证，受控对比，强制 IPv4 各 6 轮】

Cloudflare anycast 的实际落点（`cf-ray` 头）：Replicate / replicate.delivery / topazlabs.com → **LAX（洛杉矶）**；cloudinary.com → **HKG（香港）**。

| 路径 | TCP 握手 | TLS | TTFB |
|---|---|---|---|
| **HKG**（cloudinary.com） | 0.16s / **3.15s** / 0.15s / 0.16s / **2.14s** / **2.12s** | 0.32–**3.31s** | 1.1–**4.3s** |
| **LAX**（replicate.com） | **0.184–0.193s（±4ms）** | 0.37–0.39s | 0.79–0.97s |

→ **香港"物理上更近"但更不稳**：HKG 6 轮中 **3 轮 TCP 握手退化到 2–3 秒**（正常应约 150ms）；LAX 虽 RTT 185ms 却**几乎无抖动**。
→ **决策含义：不能假定"加一台香港 VPS 中转就能改善"。** 中转的价值不在"离得近"，而在**中转机自身到大陆是否有优质专线（如 CN2 GIA）**，以及中转机到目标 API 的链路是否干净。若只是普通 BGP 香港 VPS，**实测形态表明可能比直连 LAX 更差**。
→ ⚠️ **未证实**：CN2 GIA / BGP 中转的当前质量与失败模式、香港/新加坡 VPS 具体报价（本轮未取得权威数据，不做断言）。

**两个易误判点** 【实证】：
- `fal.media`、`v2.fal.media` 在**所有解析器**（阿里 223.5.5.5、腾讯 119.29.29.29、1.1.1.1、8.8.8.8）**均不解析** → **该域名本就不存在，不是 DNS 污染**。真实文件域名是 **`v3.fal.media`**（BunnyCDN，可达）。
- `api.cloudinary.com` **ICMP 100% 丢包但 HTTPS 正常** → **只是 ICMP 被过滤，勿误判为不可达**。

**RTT / 丢包实测**（ICMP 30 包）：

| 目标 | 平均 RTT | 丢包 |
|---|---|---|
| fal.ai（Vercel 216.150.1.1） | **75.7 ms** | 0% |
| Replicate（Cloudflare LAX） | 193.1 ms | 0% |
| topazlabs.com（Cloudflare） | 174.3 ms | 0% |
| res.cloudinary.com（Akamai） | 213.3 ms | 0% |

**跨境带宽成本**【实证】：**Cloudflare R2** 存储 **$0.015/GB-月**（Standard）/ $0.01（IA）；Class A **$4.50/百万次**、Class B **$0.36/百万次**；**"Egress (data transfer to Internet): Free"**（标准/IA 均免费）。⚠️ 该 egress 标注有脚注未能抓取正文，**建议以其官方脚注为准**。**AWS / Azure 出口带宽**【官方定价 API / 定价页直取，已解决初稿的"未证实"】：
- **AWS**（官方价目 feed）：US West(Oregon) / US East(N.Virginia) / US West(N.California) 三区同价——首 10 TB/月 **$0.09/GB**，次 40 TB $0.085，次 100 TB $0.070，>150 TB $0.050；S3 页明确**前 100 GB/月出网免费**（跨服务聚合，**China 与 GovCloud 除外**）。
- **关键阴性发现**：106 个区域中 `InterRegion Outbound to China Beijing` 仅见于**越南河内（$0.25/GB）**与土耳其/希腊——**美区不存在"到中国"的专门价目**，即无特殊溢价条目。
- **Azure**：北美/欧洲出网前 100 GB/月免费，次 10 TB **$0.087/GB**；该页亚洲行原文标注 **"From Asia (China excluded)"** → **明确排除中国**（Azure 中国由 21Vianet 独立运营）。
- **对比结论**：AWS 美区 $0.09/GB、Azure 北美 $0.087/GB，而 **Cloudflare R2 出网免费** 是唯一能消除跨境回传成本的选项（但需自行验证 R2 在大陆的访问质量）。

**工程含义**：若走 fal 的 Topaz 端点，**超 5 分钟的成片必须切段**；若走 Topaz 官方 API，则无此约束（但产生另一个供应商与另一套合规/支付面）。
4. **fal 无亚太区域（仅 us/eu）**【实证】→ 从中国大陆调用，**网络 RTT 必然跨太平洋**，这是延迟与丢包的结构性来源，无法通过选区域规避。
5. **fal 的 DPA 不含中国 PIPL 机制**【实证】→ 数据出境合规没有现成合同路径可用（详见 §5）。
6. **`fal-ai/topaz/upscale/video`（旧统一端点）的"最高 8x / 120 FPS"来自其 playground 文案（【实证-间接】）**，我没有找到独立的 8x/120fps 参数文档；实际参数表里 `upscale_factor` 默认 2、`target_fps` 无上限声明。**先用它做小样验证再决定。**

### 1.6 fal.ai 中国大陆可用性与支付【支付实证；可达性为大陆实测 HTTPS 探测】

- **支付【实证】**：仅 USD 信用卡 / 美国 ACH 预充值。**国内主体需要一张可扣美元的卡（双币/美元卡）**，且**大概率拿不到中国增值税发票**（fal 是加州公司，条款只提"客户自行承担税费"）。这是落地的主要摩擦点之一。
- **中国大陆可达性【大陆实测，来自项目方 2026-10-04】**：

| 目标 | 中国大陆实测结果 |
|---|---|
| `fal.run/fal-ai/topaz/upscale/video`（API 主机） | **可达**，返回 401，约 **0.84s** |
| `api.topazlabs.com` | **可达**，返回 401，约 **0.7s** |
| `api.replicate.com/v1/models` | **可达**，返回 401，约 **0.62s** |

  → **即三家境外服务的 API 主机在中国大陆网络可直连。**
  ⚠️ **重要限定**：以上**仅为 HTTPS 短请求探测**。**大文件上传带宽、长连接持续性、CDN 域名（`v3.fal.media` 等）的可达性与下载速度均未实测**，而这恰恰是视频处理的主要瓶颈。**投产前必须做一次真实的大文件上传/下载压测。**
- **无亚洲 POP/区域**【实证】（fal Serverless 仅 `us-west`/`us-central`/`us-east`/`eu-north`/`eu-west`）→ 即使 API 可连通，**几十~几百 MB 源视频的跨境往返仍是主要成本与风险来源**，而非 GPU 时间。
- **本次调研环境限制**：本执行环境出口在美西（抓 Replicate 时响应头为 `cf-ray: ...-LAX`），**无法自行实测中国链路**；上表数据由项目方在大陆网络实测提供。

---

## 2. Replicate

### 2.1 可达性与证据获取方式【实证】

- `https://replicate.com/<owner>/<model>` 的**模型页 HTML 用 curl 可以抓到**（实测 `nightmareai/real-esrgan` 返回 HTTP 200，73 KB，去标签后含模型描述与运行量）。
- `https://api.replicate.com/v1/models?query=...` **无 token 返回 401**（`{"title":"Unauthenticated","detail":"You did not pass an authentication token"}`）；`https://replicate.com/search` 返回的 HTML 仅 7 KB，**内容由 JS 渲染，抓不到**。
- 结论：**Replicate 的模型清单与价格无法在不登录的情况下批量取证**——这是本次调研的硬限制。以下 Replicate 部分只写实际抓到的内容。

### 2.2 Replicate 上确有 Topaz 官方账号（关键更正）【由项目方/并行子任务实证】

**更正**：初稿称「Topaz 系是否上架 Replicate 未证实」——**现已证实 Replicate 上确实有 Topaz Labs 官方账号**：

| model slug | 说明 |
|---|---|
| **`topazlabs/video-upscale`** | "Video Upscaling from Topaz Labs"，**1.1M runs**，**支持 720p / 1080p / 4K，fps 最高 60**，模型约 2 周前更新 |

另有同账号下的 `topazlabs/image-upscale`、`topazlabs/image-colorization`、`topazlabs/dust-and-scratch-v2`。

→ **`topazlabs/video-upscale` 支持 fps 最高 60，意味着它在 Replicate 上是「超分 + 补帧」一体的**，这是 Replicate 路线上最值得优先实测的模型（比 fal 托管版少一层代理）。**其 GPU 秒单价与默认硬件仍需登录后用 token 核实【未证实】。**

### 2.3 `nightmareai/real-esrgan`【实证-抓取】

抓取 `https://replicate.com/nightmareai/real-esrgan` 得到的页面正文（2026-10-04 抓取）：

- 描述：*"Real-ESRGAN with optional face correction and adjustable upscale"*
- 运行量：**100.2M runs**
- 页面自述：*"This is the latest version of Real-ESRGAN with GFPGAN and outscale options exposed. **Max recommended input image resolution is 1440p**"*
- 模型元信息：*"Model created over 1 year ago / Model updated 11 months ago"*
- **这是图像超分模型，不是视频超分**。价格未在页面正文中抓到【未证实】。

> 注意：任务书中提到的 `zsxkib/...` 等是否上架，**本次未取得证据【未证实】**。Replicate 上完整清单需登录后用带 token 的 `https://api.replicate.com/v1/models?query=upscale` 与 `?query=interpolation` 拉取，再用 `GET /v1/models/{owner}/{name}` 拿单模型价格。

### 2.4 计价模型与并发

- Replicate 长期采用**按 GPU 秒计费**（`predict_time` × 所选硬件单价），并提供 CPU / T4 / L40S / A100 / H100 等硬件档位；模型可声明默认硬件。**具体单价数字本次未取得硬证据，标为【未证实】。**
- 异步形态为 `POST /v1/predictions` + 轮询 `GET /v1/predictions/{id}`，或传 `webhook` 字段；有 `Prefer: wait` 同步模式。**并发/限流按账号层级（free / paid）区分。以上为公开知识，本次未逐条抓取验证，标为【未证实】。**

**建议**：Replicate 若要用，**证据补齐成本最低的路径是注册账号后用 token 调 `GET https://api.replicate.com/v1/models?query=upscale` 与 `?query=interpolation`**，即可得到权威清单与默认硬件，再用 `GET /v1/models/{owner}/{name}` 拿单模型价格。

### 2.5 Replicate 上的视频超分 / 修复 / 插帧模型清单（逐条实测）

**取证方法**：`replicate.com` 的 HTML 可直抓；**文档支持 `.md` 后缀**（如 `/docs/topics/predictions/rate-limits.md` 返回干净 markdown）；**`sitemap-models.xml`（lastmod 2026-10-03）共 6,149 个模型 URL = 权威清单**；模型页内嵌 RSC payload 含 `current_tiers`/`prices`，是取得精确单价的来源。

**官方 / 大厂账号：**

| model slug | 描述原文 | 关键规格 |
|---|---|---|
| **`topazlabs/video-upscale`** | "Video Upscaling from Topaz Labs"，**1.1M runs** | "supports **720p, 1080p, and 4k** resolution upscaling and **fps up to 60**"；页面 metadata `hardware: "CPU"` |
| `topazlabs/image-upscale` | 3.6M runs | — |
| `topazlabs/image-colorization` / `dust-and-scratch-v2` | 2.3K / 2.8K runs | — |
| **`black-forest-labs/flux-video-upscale`** | "FLUX Video Upscale \| Video super-resolution"，520 runs | 输入上限 **20 秒 / ≤50MB / ≤2560×1440**；`upscale_factor` **1.5–3（默认 2）**；输出帧上限约 **14.4MP** |
| **`bytedance/video-upscaler`** | "ByteDance Video Upscaler – upscale video to 4K 60fps"，**34.1K runs** | ByteDance **vCube**：480p/720p/1080p → 2K/4K、**≤60fps**；`processing_type: standard（默认）/ pro（allowlist-only）`；**`scene: aigc / short_series / ugc / old_film / common`** |
| **`google-research/frame-interpolation`** | FILM "Frame Interpolation for Large Scene Motion"，**296.2K runs** | T4，约 **$0.030/次**，约 134 秒 |

**社区账号（可用且有量）：**

| model slug | 说明 | 硬件 / 成本 |
|---|---|---|
| **`zsxkib/seedvr2`** | "🔥 SeedVR2: **one-step** video & image restoration with 3B/7B hot-swap"，**355.8K runs**，**保留源音频** | **H100，约 $0.030/次，约 20 秒** |
| `lucataco/real-esrgan-video` | "Real-ESRGAN Video Upscaler"，**345.1K runs**（仅 MP4，文件名不能含空格） | A100 80GB，约 **$0.18/次**，约 127 秒 |
| **`bitflow/video-super-resolution-rife-pro`** | "fast upscaling with **TensorRT** and frame interpolation with **RIFE**"，444 runs | L40S，约 $0.19/次 |
| `pollinations/real-basicvsr-video-superresolution` | RealBasicVSR | L40S，约 $0.25/次 |
| **`pollinations/amt`** | "Video Smoother: AMT All-Pairs Multi-Field Transforms for Efficient Frame Interpolation"，**31.7K runs** | L40S，约 **$0.21/次** |
| `zsxkib/film-frame-interpolation-for-large-motion` | FILM（视频输入、递归插帧），56.8K runs | L40S，约 $0.11/次 |
| `philz1337x/crystal-video-upscaler` | 人像/人脸/商品优化（Clarity AI 一种模式） | 5.6K runs |
| ⚠️ `pollinations/codeformer-video` | 视频输入人脸修复 | 页面明确 **"Replicate API of CodeFormer cannot be used commercially"** → **商用受限** |
| ❌ `sczhou/upscale-a-video` | "Temporal-Consistent Diffusion Model for Real-World VSR" | **当前不可运行**（"This model has no enabled versions."） |
| ❌ `pollinations/rife-video-interpolation` | 16.5K runs | **不可运行**（Cog/Python 版本不再支持） |

**线索核实结果**：✅ `topazlabs`（官方账号，含 video-upscale）、`zsxkib` / `arielreplicate` / `pollinations` / `lucataco` 均成立。
❌ **`fofr/*` 线索不成立**——拉取 fofr 全部模型后确认**没有任何超分/插帧模型**（全是 Qwen 微调、`smart-ffmpeg`、`face-swap-with-ideogram`、`chained-video` 等）。

### 2.6 ⭐ Replicate 也有「按输出秒计价」的视频模型（与 fal 同一引擎）

**`bytedance/video-upscaler`** 正文原文：

> "**Pricing** — Billed **per second of output video**. Cost depends on the processing tier (standard vs pro) and the target resolution and frame rate."

内嵌价格数据 `metric: "video_output_duration_seconds"`。**Standard 档单价：**

| 目标 | ≤30fps | >30fps |
|---|---|---|
| 720p | $0.003443/s | $0.006887/s |
| 1080p | $0.006887/s | **$0.013773/s** |
| 2K | $0.013773/s | $0.027548/s |
| 4K | $0.027548/s | $0.055097/s |

**Pro 档**为 Standard 的 10 倍（1080p >30fps = $0.137742/s）。

> **⚠️ 原样保留的数据异常**：Standard 720p>30fps 与 Standard 1080p≤30fps 同为 $6.887/千秒，而 1080p>30fps 跳到 $0.013773/s（**比 1080p≤30fps 便宜约 500 倍**），且千秒/秒两种单位混用——**疑似官方展示或单位 bug，本报告未修正，须实测复核。**

**对我们场景的折算**（480p→1080p@60fps，1 分钟）：
- `bytedance/video-upscaler` Standard 1080p>30fps：$0.013773/s × 60 = $0.826 ≈ **¥5.9/分钟**
- `topazlabs/video-upscale` →1080p/60fps：$0.187/5s × 12 = $2.244 ≈ **¥15.9/分钟**（→1080p/30fps 为 $0.093/5s ≈ **¥7.9/分钟**）

→ **`bytedance/video-upscaler` 与 fal 的 `fal-ai/bytedance-upscaler` 是同一 ByteDance vCube 引擎**，价格量级一致（¥5.9 vs ¥6.1），**且它带 `scene: short_series`（短剧）预设**——这是与本项目最贴合的一个参数。
→ **Replicate 上的 `topazlabs/video-upscale`（¥7.9–15.9）比 Topaz 官方 API（¥4.5–6.8 超分）贵约 1.5–2 倍**，再次印证「Topaz 系能力应直连官方」。

### 2.7 Replicate 的限流、异步与两个必须注意的坑

- **速率限制**（官方 `rate-limits.md` 原文）：**「You can create predictions at **600 requests per minute**. All other endpoints you can call at **3000 requests per minute**.」**；允许短时突发；接近余额耗尽会被更强限流；**「If you have been granted credit and don't have a payment method on file, you'll also be rate limited to **1 request per second with a maximum of 6 requests per minute**」**；超限返回 **429** + `{"detail":"Request was throttled. Your rate limit resets in ~30s."}`
- **并发数：官方未公开"每模型并发上限"**。公开模型走**共享队列**（原文 "you **share a hardware pool** with other customers… your requests enter a **shared queue**"），会有 cold boots 与 scaling limits；**确定性并发只能靠 Deployments**（可设 `min_instances`/`max_instances`）
- **异步**：`POST https://api.replicate.com/v1/predictions`（body 含 `version` + `input`）；加 **`Prefer: wait`** 最多等 **60 秒**同步返回；status `starting`→`processing`→`succeeded`/`failed`/`canceled`；响应含 `metrics.predict_time`、`metrics.total_time`、`urls.cancel`。认证 `Authorization: Bearer r8_...`
- **webhook**：创建时指定 URL，在 created/updated/finished 时 POST；签名密钥 `webhooks.default.secret.get`
- 🚨 **坑一：API 创建的 prediction，输入与输出（含文件）1 小时后自动删除。** 官方原文：**"Input and output (including any files) are automatically deleted after an hour for any predictions created through the API"** → **必须 1 小时内转存到自己的对象存储**，否则成片丢失。这是生产集成里最容易漏掉的一条。
- 🚨 **坑二：结算以预付额度为主，且额度有 1 年有效期、不可退款**（"you must first purchase credit upfront"）；auto reload 最小阈值 $5、最小充值额 $15；余额归零即停止新任务并关停实例。→ 与 fal 一样**无中国增值税发票路径**。
- **出口管制条款**（条款 "Last Update: **April 1, 2026**"，§12.8）：不得向"any country under a U.S. embargo"或 SDN/Denied Persons/Entity List 主体出口；资格条款"You are not eligible to be a Customer either directly or indirectly if you are barred from using the Services under the Laws of the United States"。**条款未点名中国大陆**（已按 sanction/export/embargo/restricted country 全量匹配）→ **属兜底式条款，需法务判断**。
- **支付**（§4.2 原文）：需提供 "an accepted payment method, **including but not limited to credit card, debit card or bank transfer**" → **未限定必须境外信用卡，但接受哪些卡组织/发卡地官方未说明 → 中国大陆卡可用性【未证实】**（实务走 Stripe，建议小额实测）。

---

## 3. 国内云「视频增强」现成 API —— 本轮调研最重要的发现 ★

**结论：腾讯云媒体处理（MPS）已经把「超分」和「插帧」做成公开计价的标准计费项，人民币计价、元/分钟、可开票、素材不出境。** 这在合规与成本两个维度上同时优于所有境外方案，应当作为 libtv 的**主力方案**优先评估。

### 3.1 腾讯云媒体处理（MPS）—— 完整实证价格表

**来源**：https://cloud.tencent.com/document/product/862/36180 （页面标注 **最近更新时间：2026-09-24**，本次抓取 2026-10-04）
**计费单位**：人民币，**元/分钟**；按计费周期累计总秒数换算分钟，**向上取整**（不足一分钟按一分钟计）
**计费公式（页面原文）**：`视频增强处理费用 = 输出文件时长（分钟）× 输出文件不同分辨率不同帧率的原子项单价（元/分钟）`
**重要**：页面明确 *"视频增强依赖视频转码实现，需加收视频转码费用"* —— 所以**必须叠加转码费**。

#### 扩展增强能力（本项目直接相关的两行）

| 计费项 | 分辨率 | ≤30 帧 | **≤60 帧** | ≤120 帧 |
|---|---|---|---|---|
| **插帧** | 高清 HD（短边 ≤720px） | 0.6 | 1.2 | 2.4 |
| **插帧** | **全高清 FHD（短边 ≤1080px）** | **1.35** | **2.7** | 5.4 |
| **插帧** | 2K（短边 ≤1440px） | 2.4 | 4.8 | 9.6 |
| **插帧** | 4K（短边 ≤2160px） | 5.4 | 10.8 | 21.6 |
| **超分** | 高清 HD（短边 ≤720px） | 0.3 | 0.5 | 1.1 |
| **超分** | **全高清 FHD（短边 ≤1080px）** | **0.6** | **1.2** | 2.4 |
| **超分** | 2K（短边 ≤1440px） | 1.1 | 2.1 | 4.3 |
| **超分** | 4K（短边 ≤2160px） | 2.4 | 4.8 | 9.6 |

#### 一体化增强档位（可替代"超分+降噪+锐化"多步串联）

| 增强类型 | ≤30 帧 (FHD) | **≤60 帧 (FHD)** | ≤120 帧 (FHD) | HD ≤60 帧 | 2K ≤60 帧 |
|---|---|---|---|---|---|
| 基础画质增强（去毛刺） | 0.2 | 0.4 | 0.8 | 0.2 | 0.7 |
| **综合增强** | **1.8** | **3.6** | 7.2 | 1.6 | 6.4 |
| **大模型视频增强** | **2.9** | **5.8** | 11.6 | 2.5 | 10.3 |
| **大模型视频修复** | 5.6 | 11.2 | 22.4 | 4.9 | 19.9 |
| **大模型视频增强-专业版** | 12.3 | 24.6 | 49.2 | 10.7 | 43.7 |
| SDR 2 HDR | 0.4（单一价，不分帧率） | | | | |

#### 其他相关计费项（FHD 档，≤30 帧 / ≤60 帧）

| 计费项 | FHD ≤30 帧 | FHD ≤60 帧 |
|---|---|---|
| 降噪 | 0.5 | 1.0 |
| 人脸增强 | 1.5 | 3.0 |
| 色彩增强 | 0.2 | 0.4 |
| 低光照增强 | 0.2 | 0.4 |
| 去划痕 | 2.3 | 4.6 |
| 字体增强（2025-12 起下线） | 0.8 | 1.5 |
| 细节增强（2025-12 起下线，能力已并入综合增强/大模型增强） | 0.10 | 0.20 |

#### 必须叠加的转码费（普通转码，中国大陆，元/分钟，同样取自该页）

| 编码 | 分辨率 | 中国大陆 | 硅谷/弗吉尼亚 | 香港/新加坡/东京等 |
|---|---|---|---|---|
| H.264 | FHD（短边 ≤1080px） | **0.063** | 0.064 | 0.1472 |
| H.264 | HD（短边 ≤720px） | 0.0325 | 0.0333 | 0.0672 |
| H.264 | 2K（短边 ≤1440px） | 0.136 | 0.1382 | 0.2272 |
| H.265 | FHD | （见原页 H.265 段） | | |

### 3.2 换算成本：480p → 1080p + 60fps 的腾讯云报价【推算，基于 §3.1 实证单价】

| 组合方案 | 计算 | 元/分钟 |
|---|---|---|
| **超分(FHD@30) + 插帧(FHD@60) + 转码(H.264 FHD)** | 0.6 + 2.7 + 0.063 | **≈ 3.36** |
| **综合增强(FHD@60) + 转码(H.264 FHD)** | 3.6 + 0.063 | **≈ 3.66** |
| **大模型视频增强(FHD@60) + 转码** | 5.8 + 0.063 | **≈ 5.86** |
| 大模型视频修复(FHD@60) + 转码 | 11.2 + 0.063 | ≈ 11.26 |
| 只超分到 1080p（不补帧）+ 转码 | 0.6 + 0.063 | ≈ 0.66 |
| 只超分到 720p@30（不补帧）+ 转码 | 0.3 + 0.0325 | ≈ 0.33 |
| 超分到 720p + 插帧到 60fps + 转码 | 0.3 + 1.2 + 0.0325 | ≈ 1.53 |

> **对比 fal.ai 最优方案（`fal-ai/bytedance-upscaler` ≈¥6.1/分钟）**：腾讯云"超分+插帧"组合 **≈¥3.36/分钟更便宜**，而且**人民币结算、可开中国增值税发票、素材不出境、无需跨境带宽**。**这是本报告最强的单条建议：先谈腾讯云 MPS。**

### 3.3 腾讯云 MPS 接入方式【实证】

- **接口**：`mps.tencentcloudapi.com`，action **`ProcessMedia`**，Version `2019-06-12`（来源：https://cloud.tencent.com/document/product/862/37578 ，页面标注 **最近更新时间：2026-09-11**）
- **输入**：支持 **URL 视频链接** 或 **COS 对象存储**中的文件（`InputInfo`）；输出可指定 `OutputStorage`/`OutputDir`
- **能力覆盖**（页面原文列举）：音视频转码（普通/极速高清/**音视频增强**/明水印/数字水印）、自适应码流、视频转动图、截图、**媒体质检**（含**无参考打分**，可诊断抖动/模糊/低光照/过曝光/花屏/噪点/马赛克等——**对"清晰化"做自动质检非常有用**）、智能字幕、智能擦除、智能审核、智能分析识别
- **默认接口频率限制：100 次/秒**
- **结算**：默认**日结后付费**（每日 12:00–18:00 结算前一日），可改月结（需联系商务）
- **注意**：MPS 账单**不含 COS 存储费用**，需另外计入

### 3.4 国内其他托管 SaaS 价格锚点（重要更正：此前"阿里云未证实"已解决）★

**更正**：初稿曾把阿里云标为【未证实】——原因是我用错了 URL 且未意识到阿里云帮助中心提供 **`.md` 直出**（在任意文档 URL 后加 `.md`，或读 `help.aliyun.com/zh/<产品>/llms.txt` 索引）。**已修正，并已独立复核。**

#### 3.4.1 ⭐ 最关键的方法论发现：「定档口径」决定报价，同一能力可差 14 倍

**阿里云 VIAPI 计费页原文（已逐字复核，`https://help.aliyun.com/zh/viapi/product-overview/billing-is-introduced-9`，`.md` 版本亦可直出）：**

> **「分辨率按照输入视频的分辨率，帧率按照输出视频的帧率，时长按照输出视频的时长」**进行计费，时长最小计量单位为秒，时长不足 1 秒按照 1 秒进行计费。

**这句话对本项目是决定性的**：我们的源是 **480p**，目标是 1080p——
- 走**阿里云 VIAPI**：按**输入** 480p 定档 → 落入 **「分辨率≤720P」最低档**；
- 走**腾讯云 MPS / 腾讯云 CI / 百度 MCT**：按**输出** 1080p 定档 → 落入 **FHD 档**。

→ **同一个"480p→1080p"需求，跨厂商报价可差近 14 倍。询价时必须先问清「按输入还是按输出定档」。**

**我们的场景（480p 输入 → 1080p@60fps 输出）在各家的实际落档价：**

| 厂商 / 产品 | 定档依据 | 超分 | 插帧 | **合计（元/分钟）** | 复核状态 |
|---|---|---|---|---|---|
| **腾讯云 MPS** | 输出分辨率 | FHD@30: **0.6** | FHD@60: **2.7** | **¥3.30 (+转码 0.063 ≈ ¥3.36)** | **✅ 已独立复核**（2026-09-24 页） |
| 腾讯云 VOD | 输出分辨率 | FHD@30: 0.592 | FHD@60: 2.688 | ≈¥3.28 | 子任务产出 |
| **阿里云 VIAPI** | **输入分辨率** | ≤720P@60: **0.8** | ≤720P@60: **6** | ¥6.8 | **✅ 已独立复核** |
| 阿里云 VIAPI 视频综合增强（插帧+超分+SDR2HDR 打包） | **输入分辨率** | — | — | ¥8（≤720P@60） | ✅ 已独立复核 |
| 腾讯云数据万象 CI | 输出分辨率 | R≤FHD: 2.4–3.2 | R≤HD: 6 | ≥¥8.4 | 子任务产出 |
| 火山引擎 VOD 自定义画质增强 | 输出分辨率 | 智能超分 **8**（闲时 2.4） | 智能插帧 **2.7**（闲时 0.81） | ¥10.7（闲时 ¥3.21） | ⚠️ 未复核 |
| **火山引擎 AI MediaKit 画质增强·标准版**（超分+插帧等 30+ 算子一个 SKU） | 输出分辨率 | — | — | **¥3.0**（1080P@60fps） | ⚠️ **未复核** |
| **火山引擎 AI MediaKit 画质增强·极速版** | 输出分辨率 | — | — | **¥0.8**（1080P@60fps） | ⚠️ **未复核（若成立则为最便宜的 1080p60 一站式）** |
| 火山引擎 AI MediaKit 视频插帧 | 输出分辨率 | — | 1080P@60: 2.4 | ¥2.4 | ⚠️ 未复核 |
| 百度智能云 MCT | 输出分辨率 | HD 0.9 / SD 0.5 | HD 1.5 / SD 0.7 | ¥1.2（SD 档）– ¥2.4（HD 档） | ⚠️ 未复核 |
| 阿里云 MPS / IMS 超分 | 输出分辨率 | **按「元/帧」计费**：HD 0.003255 元/帧 → 1080p@30fps = **¥5.86/分钟**；专业版 0.05 元/帧 = **¥90/分钟** | 阿里云 MPS/IMS **无插帧** | ¥5.86（标准）/ ¥90（专业） | ⚠️ 未复核 |

> ⚠️ **「元/帧」是最危险的计价口径**：阿里云 MPS/IMS 的超分按**元/帧**报价，换算成"元/分钟"必须乘帧率——**1080p@30fps 标准版 = ¥5.86/分钟，专业版 = ¥90/分钟，4K@30fps 标准版 = ¥25.2/分钟**。官方自己的示例：200 分钟 SD→HD @25fps = **976.5 元**。**看到"元/帧"报价必须立刻换算，否则会低估 30–500 倍。**

#### 3.4.2 关于火山引擎的核实状态（我本人未能复核）

火山引擎的定价页与文档站**均为纯前端 JS shell**（正文仅 16 字符），其文档详情 API（`/api/doccenter/doc/detail`、`/api/doccenter/search`、`/api/doccenter/doc/list`）**返回 `{"ResponseMetadata":{...,"Error":{"Message":"未授权访问","Code":"UnauthorizedAccess"}}}`**，站点亦**无 `sitemap.xml`、无 `llms.txt`**。→ **本轮无法取得火山引擎的任何价格证据。**
上表中火山引擎的三行**来自并行核查任务，我未能独立复核**，请以 ⚠️ 标注对待；**投产前务必到 `docs.volcengine.com/docs/Intelligentprocessing/video-tool-billing` 人工确认**（这是"自建 vs 托管"对比的支点数据之一）。

另需注意**同一厂商内同一能力的价差**：火山引擎「智能超分」在 **VOD 自定义模板是 ¥8/分钟**，在 **AI MediaKit 画质增强标准版是 ¥1.5/分钟**——**同一家、同一能力差 5 倍以上**，根因同样在定档与 SKU 设计。

#### 3.4.3 华为云

**仍未取得任何证据，标为【未证实】。** 建议直接登录控制台"产品定价"页或联系商务询价。

### 3.5 国内托管方案的最终性价比排序（我们的场景）

| 排名 | 方案 | 元/分钟 | 复核 | 备注 |
|---|---|---|---|---|
| 🥇 | **腾讯云 MPS：超分 FHD@30 + 插帧 FHD@60 + 转码** | **¥3.36** | ✅ 已复核 | **单厂商一条链路，最省事且已在第一梯队** |
| 🥈 | 腾讯云 VOD 同款能力 | ≈¥3.28 | 子任务 | 与 MPS 同价 |
| 🥉 | 火山 AI MediaKit 画质增强标准版 | ¥3.0 | ⚠️ 未复核 | 需人工确认 |
| — | 火山 AI MediaKit 极速版 | ¥0.8 | ⚠️ **未复核** | **若成立则大幅领先，务必优先核实** |
| — | 阿里云 VIAPI 超分 + 插帧 | ¥6.8 | ✅ 已复核 | 超分极便宜（¥0.8）但插帧贵（¥6） |
| — | 阿里云 VIAPI 综合增强 | ¥8 | ✅ 已复核 | — |
| ❌ | 阿里云 MPS/IMS 超分（元/帧口径） | ¥5.86–90 | ⚠️ | **计价口径陷阱，避开** |

> **结论：腾讯云 MPS（¥3.36）是目前"已复核"的最优单厂商方案。但火山 AI MediaKit 极速版（¥0.8）与百度 MCT（¥1.2–2.4）若核实成立，则更便宜——这两个是需要优先人工确认的"候选更优解"。**

> ⚠️ **所有国内托管方案都没有量级折扣**：阿里云 VIAPI 预付费资源包（有效期 1 年）的视频超分辨 ≤720P 档 **5,000 点 = 125 分钟 = 50 元（≈0.4 元/分钟，与按量同价）**、插帧 ≤720P **5,000 点 = 17 分钟 = 50 元（≈2.94 元/分钟，比按量 3 元略便宜）** → **大批量采购不会带来数量级议价空间**。

---

## 4. 第一方模型 API 与其他托管平台

### 4.1 Topaz Labs 官方 API（第一方，绕过 fal 代理）【由项目方实证核实，2026-10-04】

**这是本轮调研的第二个重要发现：Topaz 自己就有官方 API，且在时长限制上比 fal 托管的 Topaz 端点宽松得多。但它的插帧计费方式对 60fps 补帧是灾难性的。**

| 项目 | 事实 | 性质 |
|---|---|---|
| 网络可达性 | **本机（中国大陆网络）直连 `api.topazlabs.com` 可达**；`POST /video/express` 约 **0.7s** 返回 `401 Unauthorized`（端点在线，仅缺鉴权） | **中国大陆实测**——本轮唯一一次真正的中国大陆直连实测 |
| 时长上限 | **官方 API 文档中没有任何输入时长上限** | 相对 fal 托管版的 5 分钟限制是明显优势 |
| 真实硬限制 | 输入文件 **<100GB**（>500MB 走 multipart，最多 **150 个分片 URL**）；请求 body **≤3000 字节** | 工程约束 |
| 处理超时（非时长上限） | GAN 视频模型约 **4 小时**；生成式（Starlight/Astra）约 **17 小时**；**超时按失败全额退 credit** | 对成本友好 |
| 成本预估 | API 返回 `estimates`（**credits 成本区间 + 耗时区间**，空队列假设），且**按下限计费** | 提交前即可拿到成本区间，比 fal 的"事后出账"更可控 |
| 异步方式 | 支持 **webhook**（`notifications.webhookUrl`） | 符合本项目异步管线 |
| 文件传输 | 支持 **S3 预签名直传 / 直取**（`source.external` / `destination.external`） | **可避免把大文件先上传给 Topaz 中转**，降低跨境带宽与失败面 |
| credit 单价 | **$0.12**（Starter）/ **$0.10**（Developer，$50/月含 500 credits）/ **$0.08**（Scale，$240/月含 3000 credits） | 量大时 credit 单价下降 33% |
| **Proteus 超分 1080p** | 10s = **2 credits**；**1 分钟 = 8 credits**；10 分钟 = 76 credits | — |
| Proteus 超分 720p | 1 分钟 = **4 credits** | — |
| Proteus 超分 4K | 1 分钟 = **31 credits** | — |
| Starlight Precise 2.6 | 约 **26 帧/credit @1080p**、**12 帧/credit @4K** | 生成式，贵得多 |
| 插帧 Apollo / Chronos | **2 credits / GP** | — |
| 插帧 Aion | **6 credits / GP** | — |
| 插帧 Apollo Fast / Chronos Fast | **1 credit / GP** | 最快最省 |

#### ⚠️ GP 的准确定义（关键，曾导致严重误算）

**GP = 新生成的插值帧的 gigapixel，不是输出总帧数，也不是帧数。**
Topaz 官方文档原文（对 `https://developer.topazlabs.com/video-models/frame-interpolation.md` 的动态问答，**2026-10-04 实抓**）：

> *"**GP means gigapixels of newly generated frames.** For a 30→60 fps conversion, count the 30 interpolated frames generated each second — not all 60 output frames."*

官方算例（1920×1080、30→60fps、1 分钟）：新帧 30×60 = **1800 帧** → 1800 × 2,073,600 = **3.73248 GP**。
本次复算完全吻合官方算例（3.73248 GP），故该口径已确认。官方并明确：**插帧模型不做超分，须与超分 filter 分开计费。**

#### 换算：Topaz 官方 API 处理「480p → 1080p + 60fps」【推算，GP 口径已由官方原文确认】

1 分钟、1080p、30→60fps，新生成 1800 帧 = **3.73248 GP**：

| 部分 | 方案 | credits | ¥ @$0.08(Scale) | ¥ @$0.10(Dev) | ¥ @$0.12(Starter) |
|---|---|---|---|---|---|
| **超分** | Proteus 超分到 1080p | **8** | ¥4.5 | ¥5.7 | ¥6.8 |
| 超分 | Proteus 超分到 720p | 4 | ¥2.3 | ¥2.8 | ¥3.4 |
| 超分 | Proteus 超分到 4K | 31 | ¥17.6 | ¥22.0 | ¥26.4 |
| **补帧** | **Apollo / Chronos**（2/GP） | **7.46** | ¥4.2 | ¥5.3 | ¥6.4 |
| 补帧 | **Apollo Fast / Chronos Fast**（1/GP） | **3.73** | ¥2.1 | ¥2.7 | ¥3.2 |
| 补帧 | Aion（6/GP） | 22.39 | ¥12.7 | ¥15.9 | ¥19.1 |

**合计（Proteus 超分 1080p + 补帧到 60fps）**：

| 组合 | 总 credits | **人民币/分钟** |
|---|---|---|
| Proteus 1080p + **Apollo Fast** 补帧 | 11.73 | **≈ ¥6.7 – 10.0** |
| Proteus 1080p + **Apollo/Chronos** 补帧 | 15.46 | **≈ ¥8.8 – 13.2** |
| Proteus 1080p + **Aion** 补帧 | 30.39 | ≈ ¥17.3 – 25.9 |
| 仅 Proteus 超分 1080p（不补帧） | 8 | ≈ ¥4.5 – 6.8 |
| 仅 Proteus 超分 720p（不补帧） | 4 | ≈ ¥2.3 – 3.4 |

> ✅ **结论：Topaz 官方 API 在「超分 + 补帧」两项上都具备价格竞争力（超分 ¥4.5–6.8 + 补帧 ¥2.1–6.4 ≈ 合计 ¥6.7–13.2/分钟），且无时长上限、支持 webhook、返回 credits/耗时 estimates、按下限计费、中国大陆直连可达。**
> 它**真正贵**的是**生成式/创意档位**：Starlight Precise 2.6（≈26 帧/credit @1080p）1 分钟 1080p 输出 3600 帧 ≈ **138 credits ≈ ¥79–118/分钟**；Astra 创意超分更贵；SDR→HDR 亦属高价档。
>
> 📌 **与 fal 托管版的对比**：同样「precision 1080p@30 + interpolate 30→60fps」，**fal 托管版 = $0.20/10s + $0.30/10s = $0.50/10s ≈ $3.00/分钟 ≈ ¥21.3/分钟**，**比 Topaz 官方 API 贵约 2 倍，且被 fal 额外限制 5 分钟时长**。→ **若要 Topaz 系能力，优先直连 Topaz 官方 API，而不是 fal 代理。**

> 修正说明：本报告初稿曾把 GP 误读为「生成帧数」，导致补帧成本被高估约 240 倍（错算为 ¥1000–2000/分钟）。**该错误已更正，相关数字全部删除。**正确的口径为「新生成帧的 gigapixel」。

### 4.2 其他托管平台：18 家逐一核查（结论：绝大多数没有视频超分）

**方法**：优先取官方文档站的 `llms.txt` 与逐页 `.md` 原文，或官方 OpenAPI/SDK 生成物；网络不可达者**明确标注未证实，不做任何推测**。

#### 4.2.1 总览表

| # | 平台 | 视频超分 | 视频插帧 | 关键价格 | 大陆直连 |
|---|---|---|---|---|---|
| 1 | **Runway** | ✅ 有 | ✅ 有 | 超分 $0.007–0.012/**帧**；插帧 **$0.005/秒** | ✅ |
| 2 | **VanceAI** | ✅ **有** | ❌ API 无 | **"From 1 credit/min"** ≈ **$0.029/分钟**起 | ✅ |
| 3 | **Topaz Labs** | ✅ 有（自营） | ✅ 有 | $0.08–0.12/credit | ✅ |
| 4 | Luma AI | 🟡 有 | 🔴 未证实 | 🔴 **未证实** | ❌ **被墙** |
| 5 | upscale.media / PixelBin | ⚠️ 网页有 / API 仅图片 | ❌ | **25 credits/次**视频；**CN¥0.31–0.67/credit** | ✅ **人民币计价** |
| 6 | Higgsfield | ❌ API 无（网页有） | ❌ | 生成 $0.042–0.206/s | ✅ |
| 7 | Let's Enhance | ⚠️ 网页有 / API 仅图片 | ❌ | $9–34/月 | ✅ |
| 8 | Cloudinary | ❌ **仅图片** | ❌ | 1cr=1000 变换 | ✅ |
| 9 | Cloudflare | ❌ **仅图片** | ❌ | Stream 投递 $1/1000 分钟 | ✅ |
| 10 | Freepik → **Magnific** | ❌ 仅图片 | ❌ | 图片超分 €0.10–0.50/张 | ⚠️ WAF |
| 11 | Pruna AI | ❌ 仅图片 | ❌ | 图片 $0.005–0.12/张 | ✅ |
| 12 | Shotstack | ❌ | ❌ | $0.20–0.30/分钟 | ✅ |
| 13 | Bitmovin | ❌ 公开 API 无 | ❌ | 🔴 未证实（/pricing 403） | ⚠️ WAF |
| 14 | Wowza | ❌ | ❌ | $195/月 | ✅ |
| 15 | Mux | ❌ | ❌ | 投递 $0.0008/分钟起 | ✅ |
| 16 | Deep-Image.ai | ❌ 仅图片 | ❌ | $0.04–0.09/张 | ✅ |
| 17 | Vimeo | 🔴 未证实 | 🔴 未证实 | 🔴 未证实 | ❌ **被墙** |
| 18 | Cutout.pro | 🔴 未证实 | 🔴 未证实 | 🔴 未证实 | ❌ TCP 超时 |

#### 4.2.2 三个真正可用的候选（除 Topaz 外）

**① VanceAI —— 最便宜的视频超分（但 API 无插帧）** ⭐
- Base `https://vanceai.com/api/v1`，认证 `Bearer sk_live_…`；端点 `POST /v1/jobs`（毫秒返回 job_id）→ `GET /v1/jobs/{id}` → `GET /v1/jobs/{id}/result`（**下载链永不过期**）+ `/cancel`、`/uploads`、`/credits`
- 工具名 **`video_upscale`**：config `scale`（2/4，默认 2）、`fps`，**输出上限 long 3840 / short 2160**；另有 `video_hdr`、`video_face_enhance`
- **官方计价原文：「From 1 credit/min, based on resolution, frame rate, and scale」** → Studio 档 $0.029/credit ≈ **$0.029/分钟起 ≈ ¥0.21/分钟**
- 价格档：Starter $15/月 260cr（$0.058/cr）、Popular $30/650cr（$0.046）、Creator $45/1300cr（$0.035）、**Studio $75/2600cr（$0.029）**
- **计费可信度高**：服务端上传后用 **ffprobe 实测**宽高/时长/帧率（**不信客户端上报**）；job 启动冻结 credits，**失败/取消全额退还**
- **异步仅轮询，v1 无 webhook**（原文 "Polling only in v1 … Webhook callbacks are planned for v1.1"）
- ❌ **API 无插帧**（网页/桌面的 "Smoother With AI" 补帧无对应 API 工具名）
- ✅ 大陆直连正常

**② Runway —— 唯一"超分 + 插帧"双全的境外托管（但贵）**
- 文档站 `docs.dev.runwayml.com` 提供 `llms.txt` + 逐页 `.md`
- **视频超分**：`POST /v1/video_upscale`，`model: magnific_video_upscaler_creative`；参数 `resolution`（720p/1k/2k/4k，默认 2k）、`creativity`、`sharpen`、`smartGrain`、`flavor`（vivid/natural）、`fpsBoost`；原文 **"Maximum duration is 30 seconds"**
- **插帧**：同端点 `model: enhance_frame_rate`，`targetFramerate` 支持 24/25/30/48/50/60/120/23_98/29_97/59_94；原文 **"Maximum duration is 300 seconds"**
- **价格**（原文 "Credits can be purchased for $0.01 per credit"）：超分**按输出帧**计费 —— 720p/1k **$0.007/帧**、2k **$0.009**、4k **$0.012**；官方示例 10s@30fps = 210/270/360 credits（**$2.10 / $2.70 / $3.60**）。插帧 **1 credit per 2 seconds = $0.005/秒**
- 异步：task id + 轮询 `GET /v1/tasks/{id}`；必带 `X-Runway-Version` 头
- ✅ `api.dev.runwayml.com` 返 401（网络通）
- ⚠️ **Bing 中国有大量 `runwaychina.com` / `runwaycn.com` / `runwayzh.com` 仿冒站，切勿采信**

**③ upscale.media / PixelBin —— 唯一人民币计价**
- 网页端确有 `/video-upscale`（"Upscale Video to 4k"），**上限 1 分钟 / 1280×720**
- **关键数字**：官方内嵌映射 **`"VideoUpscalerPlugin": 25` = 25 credits/次**视频超分（图像 `SuperResolution` = 1）；另有口径不一致的 `"creditsUsedOnVideo":"3 credits"`（**未证实**）
- 价格（**本机显示 CN¥，中文地域化定价**）：免费 3 credits/月；订阅 **CN¥0.06/credit**（CN¥469.28/年）；一次性 60cr **CN¥0.67/cr**、500cr **CN¥0.34**、1200cr **CN¥0.31**
- 母公司 **Shopsense Retail Technologies Limited**（印度）
- ❌ **但已文档化 API 是纯图像**（`sr.upscale()`，"Image enhancement up to 8x"）；视频 API **只有网页一句格式说明、未公开端点** → **只适合小批量试水 / 网页人工，不适合生产 API 集成**

#### 4.2.3 明确不可用（勿踩坑，全部有官方反证）

| 平台 | 反证（官方原文） |
|---|---|
| **Cloudinary** | `e_upscale` 页原文 **"Applies to: images"**；全 effect 索引中 `enhance`/`improve`/`upscale`/`sharpen`/`unsharp_mask` **全部标注 [images]**；视频专属只有 accelerate/boomerang/deshake/noise/reverse/transition → **视频侧零超分**。**不存在 "Video enhancement" add-on**（video add-ons 仅 Google/AWS/Azure 的打标/审核/转录五项）。**`fps_` 不是插帧**（原文 "Controls the FPS… to ensure the asset is delivered with an expected FPS level"） |
| **Cloudflare** | Media Transformations 视频选项**完整清单**（mode/time/duration/fit/height/width/audio/format/filename）**没有 upscale**；`fit=scale-down` 原文 **"Do not upscale"**。**Images 确有** `upscale=generate`（原文 "Uses AI upscaling (**ESRGAN**)"，2x/4x，有 GPU inference）但**仅图片** |
| **Bitmovin** | `llms-full.txt` 确列 "Super Resolution"，**但官方 PyPI SDK 1.282.0 的 `filter_type.py` 17 项枚举无 `SUPER_RESOLUTION`**，全 SDK grep 0 命中，`super-resolution.md` → **404** → **非公开自助 API**。**Per-Title / Per-Shot 是码率优化，不是超分** |
| **Mux** | 最强反证：`docs/api-reference/video.txt`（**251,712 bytes**）全文检索 `upscale`/`super resolution`/`interpolat`/`enhanc`/`sharpen` = **0 命中** |
| **Shotstack** | 原文 **"…using a third party provider. Currently only **Dolby.io audio enhancement** is available."** → **纯音频**。⚠️ 产品页写 "along with upscaling" 是营销措辞，API 无对应参数 |
| **Pruna AI** | 官方 `openapi.yaml` 只有 `Image Upscaling: p-image-upscale`；唯一 "interpolate" 原文是 **"Interpolate the generated video to 30 FPS using **ffmpeg**"** → **非 AI 光流** |
| **Wowza** | VIF 原文 "takes **frames from live video streams, routes them to AI models for inference**" → CV 检测，非画质增强 |
| **Freepik → Magnific** | ⚠️ **Freepik 已于 2026 年 4 月更名 Magnific**（`docs.freepik.com` 现直接返回 Magnific 文档）。只有图片超分（€0.10–0.50/张，按输出面积分档）；视频侧只有 VFX 滤镜 $0.017/秒，其 "Output FPS 1–60" 是**输出帧率设定，不是插帧** |
| **Let's Enhance** | `/upscaler-api` 原文 "Explore API on **Claid.ai**" → 对外 API 承载于 Claid.ai，而 Claid 只有图片超分 + 图片转视频生成，**无视频超分 API** |
| **Higgsfield** | API 确实公开（`api.higgsfield.ai`，非 waitlist），但官方 `models.md` 原文 "82 entries…as of September 22, 2026"，`grep -ic upscal` = **0** → **API 目录无超分端点**（仅网页端有） |
| **Deep-Image.ai** | 官方 sitemap 37 条 URL 中 "video" **0 次**；supported-formats 无 mp4 |
| **Luma AI** | 🟡 有超分（`POST /generations/{id}/upscale`，`upscale_video`，540p–4k，webhook + 轮询）**但 `api.lumalabs.ai` 在大陆 TCP 被阻断**；**价格未证实**；官方 PyPI 包 v1.21.0 模型枚举只有 `ray-2`/`ray-flash-2` → **ray-3 未证实**。插帧未证实（"interpolate between two generations" 是两段生成间的过渡视频，非补帧） |
| **Vimeo / Cutout.pro** | **网络不可达**（Vimeo 四域名 TCP 443 全超时、DNS 污染到 Meta 网段；Cutout.pro 80/443 全超时）→ **不对 endpoint 与价格做任何断言** |

> ⚠️ **`luma.ai` 不是 Luma Labs**！该站页脚原文：**"Please note that Luma AI is not related to Dream Machine by LumaLabs."** 其 $9.99/周等价格均属**第三方**，不得当作 Luma Labs 官方价格。
> ⚠️ **三个最易踩的坑**：① "**per-title encoding**"（Bitmovin、Mux）**不增加分辨率**，常被误当超分；② **Cloudinary `fps_` 与插帧无关**；③ 公开 API 里最明确的图片 AI 超分是 **Cloudflare Images `upscale=generate`** 与 **Cloudinary `e_upscale`**，**两者都只管图**。

### 4.3 开源方案与商用许可证（自建路线的法律前提）★

**结论：四个核心模型都可商用，但 Real-ESRGAN 有一个必须避开的坑。**

| 项目 | 官方 repo | License | 可否商用 |
|---|---|---|---|
| **SeedVR2** | `github.com/IceClear/SeedVR2` ⚠️（`ByteDance-Seed/SeedVR2` **不存在，404**） | **Apache-2.0** | ✅ |
| **FlashVSR** | `github.com/OpenImagingLab/FlashVSR` | **Apache-2.0** | ✅ |
| **Real-ESRGAN** | `github.com/xinntao/Real-ESRGAN` | **BSD-3-Clause** | ✅（**有坑，见下**） |
| **RIFE** | `hzwer/ECCV2022-RIFE` / `hzwer/Practical-RIFE` | **MIT**（版权 Megvii Inc.） | ✅ |
| **FILM** | `google-research/frame-interpolation` | **Apache-2.0** | ✅ |
| **IFRNet** | `IFRNet/IFRNet` | **MIT** | ✅ |
| **EMA-VFI** | — | **Apache-2.0** | ✅ |
| GIMM-VFI | — | 🔴 未证实 | 🔴 未证实 |

**澄清一：「Real-ESRGAN 预训练模型禁商用」是传言，未获证实。**
已核对 `LICENSE`（**BSD-3-Clause**）以及 README、README_CN 和 v0.2.2.4 / v0.2.3.0 / v0.2.4.0 / v0.2.5.0 / v0.3.0 **五个 tag 的 README**，**全部无 "commercial" 字样**；`LICENSE` 中非商业条款命中数 = **0**。

**⚠️ 澄清二：真正的坑在 `--face_enhance` —— 它会调用 GFPGAN，而 GFPGAN 捆绑的 NVIDIA StyleGAN2 衍生代码是非商业许可。**
本报告已**独立复核** `TencentARC/GFPGAN` 的 `LICENSE` 原文（**HTTP 200，7,284 字节**），第 82–84 行与第 137–147 行确认：

> `StyleGAN2`
> The codes are modified from the repository stylegan2-pytorch… The official repository is https://github.com/NVlabs/stylegan2, and here is the NVIDIA license.
> …
> **3.3 Use Limitation.** The Work and any derivative works thereof **only may be used or intended for use non-commercially.** … "non-commercially" means **for research or evaluation purposes only.**

（GFPGAN 自身头部为 "Apache License Version 2.0 **except for the third-party components listed below**"。）

> **→ 商用结论：如果自建管线用 Real-ESRGAN，必须关闭 `--face_enhance`。**
> 对本项目尤其关键：**漫剧/短剧正是人脸最密集的场景**，"人脸增强"是最想要的功能之一——但它恰好踩在非商业许可上。
> **替×代方案**：① 用 Real-ESRGAN 的非人脸路径 + 单独的人脸恢复模型（注意 **CodeFormer 是 S-Lab License 1.0，同样非商业**——Replicate 上的 `pollinations/codeformer-video` 页面也直接写明 **"Replicate API of CodeFormer cannot be used commercially"**，两处独立印证）；② 用 **SeedVR2 / FlashVSR**（均 Apache-2.0，无此限制）；③ 用**腾讯云 MPS 的「人脸增强」计费项**（FHD ≤60 帧 **3.0 元/分钟**）——**云服务把许可风险转移给厂商，这可能是最省心的选择**。

### 4.4 「能买到视频超分 + 插帧」的最终短名单

| 排序 | 平台 | 超分 | 插帧 | 我们场景成本 | 大陆 | 评级 |
|---|---|---|---|---|---|---|
| 1 | **腾讯云 MPS** | ✅ | ✅ | **¥3.36/分钟** | ✅ 不出境 | 🥇 生产首选 |
| 2 | **Topaz 官方 API** | ✅ | ✅ | ¥6.7–13.2/分钟 | ✅ | 🥈 效果优先 |
| 3 | **VanceAI** | ✅ | ❌ | **¥0.21/分钟起**（仅超分） | ✅ | 🥉 **最便宜的超分** |
| 4 | Replicate `bytedance/video-upscaler` | ✅ | ✅(≤60fps) | **≈¥5.9/分钟** | ⚠️ | 境外一站式 |
| 5 | fal `bytedance-upscaler` | ✅ | ✅(target_fps≤120) | ¥6.1/分钟 | ⚠️ | 境外一站式 |
| 6 | **Runway** | ✅ | ✅ | 超分 10s@2k=$2.70 → **≈¥19/分钟** | ✅ | 贵 7–10 倍 |
| — | upscale.media | ⚠️ | ❌ | 25 credits/次（**CN¥8.4–16.8/次**） | ✅ 人民币 | 仅试水 |
| ❌ | Cloudinary / Cloudflare / Mux / Wowza / Shotstack / Pruna / Deep-Image / Magnific / Let's Enhance / Higgsfield / Bitmovin | ❌ | ❌ | — | — | **明确不可用** |

---

## 5. 大厂云 AI API 与云 GPU 自部署成本

### 5.1 AWS Elemental MediaConvert：**没有超分能力**（负面结论，但有价值）【由并行子任务实证】

用 **botocore 官方 API 模型逐条核对**，`VideoPreprocessor` 的全部字段仅为：

`ColorCorrector` / `Deinterlacer` / `DolbyVision` / `DurationControl` / `Hdr10Plus` / `ImageInserter` / **`NoiseReducer`** / `PartnerWatermarking` / `TimecodeBurnin`

→ **不存在任何 `SuperResolution` / `Upscale` 字段。** 即 **AWS 托管转码服务里没有视频超分能力**（只有降噪 `NoiseReducer`、去隔行、色彩校正等传统预处理）。
- 定价（官方定价 JSON，**发布日 2026-09-11**）：Basic **$0.0075**/标准化分钟（首个 10 万分钟）、Professional **$0.012**/标准化分钟（首个 5 万分钟）；AVC ≤30fps 乘数为 SD 1x / HD 2x / 4K 4x。
- **可用于**：若自建 GPU 集群做超分，MediaConvert 仍可作为"打包/转码/降噪"环节，但**超分本身必须自己跑**。
- 另外可佐证：`docs.aws.amazon.com` 的 MediaConvert 页面在本环境 curl 抓取时正文仅 14–42 字符（JS 渲染），故该结论依据的是 **botocore 官方 API 模型**这一更强证据。

### 5.2 云 GPU 自部署成本（★ 结论：自建比托管便宜约 20–30 倍）

**成本公式**：`元/分钟 = 单价(元/卡/时) ÷ 60 × RTF`，其中 **RTF = 单卡 GPU 秒数 ÷ 输入视频秒数**（含超分 + 插帧 + 编码，不含排队与冷启动）。

#### 5.2.1 关键单价表【实证】

**境外：**

| 平台 | GPU | 单价 | 来源 |
|---|---|---|---|
| **RunPod Pods Community** | RTX 4090 24G | **$0.34/h ≈ ¥2.41/h** | runpod.io/pricing（页面标注 **Updated September 27, 2026**） |
| RunPod Pods **Secure** | RTX 4090 | $0.74/h ≈ ¥5.25/h | 同上（价格从页面 JSON-LD 成对提取） |
| RunPod Pods Community | A100 SXM 80G / H100 SXM | $1.39 / $2.69 per h | 同上 |
| **RunPod Serverless** | 4090 PRO | $1.10/h ≈ ¥7.81/h | docs.runpod.io/serverless/pricing（改于 2026-07-20） |
| RunPod Serverless | A100 $2.72 · H100 PRO $4.79 · B200 $8.64 | per h | 同上 |
| **Modal** | L4 $0.000222/s ≈ ¥5.67/h · A10 ≈ ¥7.82/h · L40S ≈ ¥13.85/h · A100 80G ≈ ¥17.74/h | 按秒 | modal.com/pricing |
| **Vast.ai** | 4090 最低 $0.121/h、中位 $0.418/h | 按秒，无最低时长 | 公开市场 API 实抓（n=22） |
| **Lambda** | A6000 $1.09/h（**最便宜**）；无 4090/L40S 档；默认**最小 8 卡** | per GPU/h | lambda.ai/pricing |
| **Together** | H100 $3.99/h，**起租 8 卡**（≈¥226/h） | per GPU/h | together.ai/gpu-clusters |
| **Replicate（Cog 私有模型）** | L40S ¥24.92/h · A100 ¥35.78/h | 按秒 | replicate.com/pricing |

**国内：**

| 平台 | GPU | 单价 | 来源 |
|---|---|---|---|
| **共绩算力 · Job 批处理（抢占式）** | **RTX 4090** | **¥1.19/h**（按量 ¥1.98，**抢占统一 6 折**） | gongjiyun.com/pricing（静态 HTML，全文可抓） |
| **共绩算力 · 弹性/云主机** | RTX 4090 24G | **¥1.98/h**（16核/64G，按秒） | 同上 |
| 共绩算力 | L40S ¥4.98 · L20 ¥4.00 · A800 ¥7.80 · H800 ¥25.00 | 元/h | 同上 |
| **AutoDL 按量** | RTX 4090 24G | **¥1.98/h**（中位 ¥2.19） | 官方市场 API 实抓（n=500 台） |
| **AutoDL 包月** | RTX 4090 | **¥1052/月 ≈ ¥1.44/h**（4090D ¥946） | 同上（`machine_sku_info`） |
| 共绩 裸金属 30 天包 | 4090 | ¥8314.10（8 卡）→ **¥1039/卡/月 ≈ ¥1.44/h** | gongjiyun.com/pricing |
| **腾讯云 SCF GPU 函数** | GN7（1×T4）弹性 **≈¥12.80/h**；PNV4（1×A10）弹性 **≈¥46.40/h** | 推算 | 腾讯云文档 583/68734（改于 **2026-08-20**）+ 计费 583/12281 |
| 腾讯云 SCF GPU **包月** | GN7 **¥2,750/月/卡 ≈ ¥3.77/h**；PNV4 **¥5,644.98 ≈ ¥7.73/h** | 官方原值 | 腾讯云文档 583/124568（改于 2025-10-29） |
| **阿里云 FC GPU 函数** | tesla.1（T4 16G）**≈¥18.42/h**；ada.1（48G）**≈¥37.38/h** | 推算（CU 系数） | 阿里云帮助中心 `.md` 文档 |
| AutoDL / 腾讯 CVM GPU / 阿里 ECS GPU / 火山引擎 | GN7/GN10、gn7、veMLP 按量单价 | **【未证实】**（页面零价格，只指向纯前端价格计算器；火山站点文档 API 返回「未授权访问」） | — |
| **潞晨云** | — | **已退出公众 GPU 租赁**：官网公告原文「**【转型公告】9月21日起潞晨云全面转为私有企业服务**」 | cloud.luchentech.com |

#### 5.2.2 三个决定性的成本结论

1. **国内公有云的「Serverless GPU 函数」比租 4090 贵 19–23 倍**（腾讯 SCF PNV4 A10 **¥46.40/h** vs 共绩 4090 **¥1.98/h**）。原因是它们按「**内存 GB × 秒**」或「显存 GB × 秒」折 CU 计费，**GPU 函数在这个模型下极不经济**。
   → **不要把国产云 Serverless GPU 用作视频超分的批处理底座。**
   → 唯一例外：**阿里云 FC 是本次调研中唯一给"保活"打折的 serverless**——**浅休眠态 vCPU 免费、GPU 只收 1/7~1/4**（CU 系数表实证）。
2. **Replicate 跑自有模型比自租 GPU 贵 3–4 倍**：官方原文写明私有模型「**run on dedicated hardware**…you pay for **all the time instances of the model are online**: setting up; idle; active」→ **冷启动 + 空闲 + 执行三段全收费**。L40S ¥24.92/h vs RunPod Pods L40S（Community ¥5.61 / Secure ¥7.74）。
3. **RTF 是唯一的成本主导变量**：单价差异只影响 2–3 倍，**RTF 差异影响 10–100 倍**。

#### 5.2.3 RTF 假设与敏感性（**本报告最大的不确定性**）

**唯一可引用的公开基准**【实证】：RIFE 官方仓库 README 原文 —— *"Currently, our model can run **30+FPS for 2X 720p interpolation on a 2080Ti GPU**"*。
→ 720p 插一帧 ≈ 0.0333 s/帧；1080p 像素是 720p 的 2.25 倍 → ≈0.075 s/帧（2080Ti）；4090 约 2.5–3× → **≈0.027 s/帧**。本项目需插 **1800 帧** → 4090 上约 **48 GPU 秒** → **仅插帧部分 RTF ≈ 0.8**。

**无公开基准的部分（明确标为假设）**：**Real-ESRGAN**（官方 README、ncnn 版 README 均**无任何 FPS/秒每帧数据**）、**SeedVR2**（HF model card 与 GitHub README **均无吞吐数据**）。

| 情景 | 组合 | 总 RTF 假设 |
|---|---|---|
| A 轻量 | `realesr-animevideov3` + RIFE | **≈2** |
| **B 中等（推荐基准）** | `Real-ESRGAN x2plus`(RRDB) + RIFE | **≈5** |
| C 重量 | **SeedVR2**（扩散式）+ RIFE | **≈8–30+** |

#### 5.2.4 「每处理 1 分钟 480p → 1080p + 60fps」成本区间【推算，RTF 为假设】

| 区域 | 方案 | RTF=2 | **RTF=5** | RTF=10 |
|---|---|---|---|---|
| 🇨🇳 **国内** | **共绩 4090 抢占式 Job** | ¥0.040 | **¥0.099** | ¥0.198 |
| 🇨🇳 国内 | 共绩/AutoDL 4090 按量（¥1.98/h） | ¥0.066 | **¥0.165** | ¥0.330 |
| 🇨🇳 国内 | AutoDL 4090 包月摊薄（¥1.44/h） | ¥0.048 | ¥0.120 | ¥0.240 |
| 🌐 境外 | **RunPod Community 4090（¥2.41/h）** | ¥0.080 | **¥0.201** | ¥0.402 |
| 🌐 境外 | Vast.ai 4090（中位、reliability≥0.98） | ¥0.099 | ¥0.247 | ¥0.495 |
| 🌐 境外 | RunPod Secure 4090（¥5.25/h） | ¥0.175 | ¥0.438 | ¥0.876 |
| 🌐 境外 | RunPod Serverless 4090 PRO（¥7.81/h） | ¥0.260 | ¥0.651 | ¥1.302 |
| 🌐 境外 | Modal A10（¥7.82/h） / L40S（¥13.85/h） | ¥0.261/0.462 | ¥0.652/1.154 | ¥1.304/2.309 |
| 🇨🇳 云原生 serverless | 阿里 FC tesla.1（¥18.42/h） | ¥0.614 | ¥1.535 | ¥3.070 |
| 🇨🇳 云原生 serverless | 腾讯 SCF GN7 T4（¥12.80/h） | ¥0.427 | ¥1.067 | ¥2.133 |
| 🇨🇳 云原生 serverless | 腾讯 SCF PNV4 A10（¥46.40/h） | ¥1.547 | **¥3.867** | ¥7.733 |

> **置信度：单价「高」（官方定价页/官方 API 实证）；RTF「低」（明确假设，非实测）；因此上表金额为「单价×假设」的组合推算。**
> **若 RTF 能压到 2（轻量模型）**：国内 **¥0.04–0.07/分钟**。
> **若用 SeedVR2 级扩散超分（RTF=30）**：国内按量升至 **¥0.99/分钟**——此时必须上多卡并行或模型蒸馏，否则短剧这种量级无法支撑。

#### 5.2.5 包月摊薄与容易被漏掉的成本

- **包月摊薄公式**：`月产能(分钟) = 720h × 3600s × 利用率 ÷ (RTF × 60)`。**注意包月是"租期内无论是否开机都计时"**，利用率必须打折。
  → AutoDL 4090 包月 ¥1052 @RTF=5、利用率 100% → ¥0.122/分钟；利用率 60% → ¥0.203/分钟。
  → **关键洞察：包月边际优势仅约 27%（¥1.44 vs ¥1.98 每小时）。若月处理量 < 4,000 分钟，按量/抢占式一定更划算；只有月处理量稳定超过约 8,000 分钟（RTF=5、利用率 >90%）时包月才有明确优势。**
- **必须计入的附加成本**：
  1. **出流量**：1080p60 ≈8 Mbps → 1 分钟产出 **~60MB**。腾讯云外网出流量 **0.80 元/GB** → **+¥0.048/分钟**；Modal $0.04/GiB → +¥0.020/分钟。**产物量大时，出流量是仅次于算力的第二大成本项**——用对象存储 + CDN 内网回源规避。
  2. **冷启动/保活**：Modal **application load time 也收费** + 默认 **60s** 缩容宽限全额计费，warm pool（`min_containers`）**全价常驻**（官方原文："**will increase costs**"）；RunPod Start time + Idle timeout（默认 **5s**）计费、Active worker **24/7 计费**；**AutoDL / 共绩没有真正的 scale-to-zero**（官方原文："计费时长是以实例开关机时间为准，而不是以是否调用 GPU 计算时长为标准"）。
  3. **存储**：RunPod Container Disk $0.10/GB/月（**空闲 Volume 翻倍到 $0.20**）；共绩镜像仓库 ¥0.25/GB/月。**模型权重建议打进容器镜像而非挂 Volume**（Real-ESRGAN ~64MB、RIFE ~50MB、SeedVR2-7B ~15GB）。
  4. **失败重试**：**Vast.ai 最低价机器 reliability 仅 0.761（≈24% 失败/掉线）**，而中位价段都在 0.98+ → **生产必须按 reliability ≥0.98 过滤**，并至少 2 家平台冗余调度。

#### 5.2.6 与前文托管方案的关键对比

| 方案 | 元/分钟 | 说明 |
|---|---|---|
| **自建：共绩 4090 抢占式（RTF=5）** | **≈¥0.10** | 最便宜；但需自建管线、承担库存与运维 |
| 自建：AutoDL 4090 按量（RTF=5） | ≈¥0.17 | 同上 |
| **腾讯云 MPS 托管** | **≈¥3.36** | 零运维、可开票、不出境 |
| **fal bytedance-upscaler** | ≈¥6.1 | 境外 |
| **Topaz 官方 API** | ≈¥8.8–13.2 | 境外 |

> ⚠️ **这一条会显著改变商业测算**：**自建在单位成本上比腾讯云 MPS 便宜约 20–30 倍**。但要注意三点：① RTF 是**假设**（低置信度），必须先实测校准；② 自建需要工程投入（管线、队列、抢占容错、CDN、监控），且在低量时期固定成本摊不薄；③ 腾讯云 MPS 的 ¥3.36 是"零运维 + 可开票 + 数据不出境"的打包价。
> **推荐路径：先用腾讯云 MPS 快速上线验证付费意愿（零工程投入），同时并行自建一条 4090 管线做效果与 RTF 实测；一旦月处理量稳定超过约 4,000–8,000 分钟，切到自建。**

---

## 6. 可行性与合规

> ⚠️ **本节是全报告的决定性章节。结论：含人脸的成片送境外处理，法律上是硬门槛，不存在"量小就没事"；且跨境大文件传输有 15–30% 的失败/严重劣化率。境外 API 因此不能作为主力通道。**

### 6.1 数据出境合规：人脸视频是「敏感个人信息」，无豁免（硬门槛）

**【实证】已抓到官方全文（gov.cn / 中国网信网）：**

| 法规 | 关键条款 | 含义 |
|---|---|---|
| **《促进和规范数据跨境流动规定》**（网信办令第 16 号，**2024-03-22 公布并施行**） | **第五条第(四)项** | 只有"**不满 10 万人个人信息（不含敏感个人信息）**"才免于申报 / 免标准合同 / 免认证。→ **敏感个人信息被明确排除在豁免之外** |
| 同上 | **第八条** | 非关基运营者向境外提供"**不满 1 万人敏感个人信息**" → **必须订立标准合同或通过认证** |
| 同上 | **第七条第(二)项** | 达"**1 万人以上敏感个人信息**" → **必须申报安全评估** |
| **《个人信息保护法》** | **第 28 条** | 敏感个人信息含"**生物识别**" → 人脸属之 |
| 同上 | **第 38 条** | 三条出境路径：安全评估 / 认证 / 标准合同 |
| 同上 | **第 39 条** | 须**告知并取得单独同意** |
| 同上 | **第 55 条** | 须做事前**个人信息保护影响评估（PIA）** |
| 同上 | **第 73 条(三)(四)** | **去标识化后仍是个人信息**；只有"**匿名化**（无法识别且不能复原）"才脱离个保法 |
| **《人脸识别技术应用安全管理办法》**（网信办、公安部令第 19 号，**2025-06-01 施行**） | **第八条** | 除法律另有规定或单独同意外，人脸信息应**存储于设备内、不得通过互联网对外传输** |

**结论（三条，均为硬约束）：**
1. **只要成片含可识别人脸，出境即触发"敏感个人信息出境"。** 哪怕**一天只送 1 条视频**，也需**标准合同备案（省级网信部门，10 个工作日内）或认证**——**不存在"量小就没事"**。漫剧/短剧成片几乎必然含人脸。
2. **"去标识化"救不了这个场景**：PIPL 第 73 条(三) 明确"去标识化后仍是个人信息"。而**超分/补帧的业务目的本身就是重建人脸细节，与"匿名化（无法复原）"在逻辑上互斥**——你无法既把脸模糊掉又把它超分清楚。
3. **叠加 fal 侧的合同缺口**：fal 的 DPA 只提供 GDPR/SCC/UK IDTA 机制，**无中国 PIPL 对应机制**（§1.1 实证）→ **走 fal 连"签标准合同"这一步都缺少对方可签的对等文本**。

> **这不是法律意见。以上为对官方法规文本的整理，落地前须经执业律师确认。**

### 6.2 网络现实：域名没被墙，但大文件跨境传输会间歇性崩塌

**【实证】本项目实测（杭州，联通 AS4837，2026-10-04）：**

| 观测项 | 结果 |
|---|---|
| 域名可达性 | `fal.ai` / `api.fal.ai` / `queue.fal.run` / `v3.fal.media` / `replicate.com` / `api.replicate.com` / `replicate.delivery` / `topazlabs.com` / `cloudinary.com` **全部 200 或 401（未授权）→ 无被墙迹象** |
| 路由 | Cloudflare anycast 把大陆流量送到 **LAX（洛杉矶）**，`cf-ray` 显示 `-LAX`，**RTT ≈ 193ms**；fal.ai（Vercel）RTT 仅 **76ms**；Cloudinary 走 **HKG** |
| **下载 50MB** | **双峰**：11.7 MB/s、12.9 MB/s，**但第 2 轮掉到 13 KB/s 并超时 180s**；10MB × 6 轮中 **1 轮 0 字节超时** |
| **失败率** | **约 15–30% 的大文件跨境传输失败或严重劣化** |
| 上传（大陆→境外） | 稳定但慢：**1.2 MB/s**（20MB 约 16s） |
| 国内基线 | npmmirror **17.6 MB/s** → **故障是跨境链路问题，不是本地带宽问题** |

**一个容易误判的点**：`fal.media` / `v2.fal.media` 在所有解析器（阿里/腾讯/1.1.1.1/8.8.8.8）**都不解析**，但**这不是 DNS 污染**——该域名本就不存在；真实文件域名是 **`v3.fal.media`（BunnyCDN，可达）**。

**工程含义**：
- 单次成片处理链路若"上传源视频 → 处理 → 下载成片"两次跨境大文件传输，**端到端成功率约 0.7×0.7 ≈ 50%–85%**，必须实现**断点续传 + 分片并行 + 重试 + 秒级失败回退到国内通道**，否则用户体验会崩。
- 上传仅 1.2 MB/s：**1 分钟 1080p 成片（约 50–100MB）上传需 40–80 秒**，这已与 GPU 处理时间同量级。

### 6.3 支付与发票

| 平台 | 支付方式 | 发票 / 对公 | 中国增值税发票 |
|---|---|---|---|
| **fal.ai** | 预充值；**卡种官方全文未列出【未证实】**，条款仅说 card / 美国 ACH / USD | ✅ **有 invoice-based billing**：官方 FAQ 原文 **"Can I switch to invoice-based billing? Yes. Invoice-based billing is available for higher-volume customers. Contact sales"**；且有 FOCUS 合规账单 CSV | ❌ **仍非中国增值税发票** |
| **Replicate** | 官方 ToS 原文：*"an accepted payment method, including but not limited to **credit card, debit card or bank transfer**"*；*"Replicate may use **Stripe, Inc.** as our Payment Processor"* → **未限定必须境外卡，但接受范围未说明** | Enterprise 有 **one contract** + DPA + 后付费按月开票 | ❌ |
| **Topaz Labs** | **仅 Stripe 信用卡**（FAQ 原文 *"We currently support monthly credit card payment processing through Stripe. Please contact us if you would like other payment options."*），**无 PayPal、无自助开票** | Enterprise 档 Contact Sales | ❌ |
| **Cloudinary** | ⭐ **唯一官方公布支持银联的**：*"Visa, MasterCard, American Express, Discover, Diners Club, **UnionPay**, and JCB are accepted. Digital wallet: Google Pay and Apple Pay. **Bank transfer (Enterprise plans)**"* | Enterprise 含 "Custom contracts and invoicing" | ❌（但**它做不了视频超分**，§4.2.3） |
| **腾讯云 MPS** | 人民币、后付费（日结/月结） | — | ✅ **可开中国增值税发票** |

**⚠️ 三个必须注意的实操障碍：**
1. **fal.ai 无法用邮箱/手机号注册**：`fal.ai/dashboard/billing` 未登录仅提供 **GitHub / Google / Microsoft / SSO** 四种登录，**无邮箱/手机号注册通道**。→ **大陆主体要开 fal 账号，先要确认自己有可用的 SSO 账号。**
2. **卡组织支持必须实测**：fal / Replicate / Topaz **均未公布任何中国卡组织信息**（Cloudinary 是唯一公布支持银联的）。→ **必须用真实卡做小额试付验证。**
3. **⚠️ Topaz 计价口径自相矛盾**：开发者文档写 *"**No subscriptions, no minimums, no expiration**"*，而营销页卖 **$50/月、$240/月订阅档**，**两页同指 `topazlabs.com/enhance-api`** → **签约前必须让销售书面确认计价口径**（这也影响 §4.1 的 credits 单价换算）。

### 6.4 ⚠️ AI 标识与深度合成备案：超分/插帧**被明文纳入**（本节有一次重要更正）

**更正**：初稿曾推测"超分/插帧属于对已有内容的加工而非生成合成，只有走生成式档位才需标识"——**这个判断是错的。法规把「图像增强、图像修复」明文列入了深度合成技术，与是否使用扩散模型无关。**

**《互联网信息服务深度合成管理规定》**（网信办、工信部、公安部令第 12 号，2022-12-12 发布，**2023-01-10 施行**）原文：

> **第 23 条** …深度合成技术包括"**(五) 图像生成、图像增强、图像修复等生成或者编辑图像、视频内容中非生物特征的技术**"

→ **"图像增强 / 图像修复"直接覆盖视频超分**。其他关键条款：
- **第 14 条**：训练数据含个人信息的遵守个保规定；**提供人脸、人声等生物识别信息编辑功能的，应当提示使用者依法告知被编辑的个人，并取得其单独同意**
- **第 15 条**：提供"生成或者编辑**人脸、人声等生物识别信息**"的模型/模板等工具的，**应当依法自行或者委托专业机构开展安全评估**
- **第 16 条**：应添加**不影响用户使用的标识**并保存日志
- **第 17 条(三)**：人脸生成/替换/操控等"显著改变个人身份特征的编辑服务"应**显著标识**；**第 17 条末款**：其他深度合成服务应**提供显著标识功能**
- **第 18 条**：不得删除、篡改、隐匿标识
- **第 19 条**：具有舆论属性或社会动员能力的深度合成服务提供者**应履行备案**；**深度合成服务技术支持者参照前款备案**

**《人工智能生成合成内容标识办法》**（国信办通字〔2025〕2 号；国家网信办、工信部、公安部、广电总局；成文日期 **2025-03-07**；**第 14 条：自 2025-09-01 起施行**）原文要点：
- **第 3 条**：生成合成内容 = 利用 AI 技术生成、合成的**文本、图片、音频、视频、虚拟场景**等信息；标识分**显式**与**隐式**
- **第 4 条(四)**：视频须在**起始画面和播放周边适当位置**添加**显著提示标识**，可在末尾和中间添加；**提供下载/复制/导出功能时，应确保文件中含有满足要求的显式标识** ← **对"用户下载成片"是硬要求**
- **第 5 条**：应在**文件元数据**中添加**隐式标识**，包含生成合成内容属性信息、**服务提供者名称或编码、内容编号**等制作要素信息；鼓励数字水印
- **第 9 条**：用户申请无显式标识内容时，可在协议明确其义务责任后提供，但须**依法留存提供对象信息等日志不少于六个月**
- **第 10 条**：**不得恶意删除、篡改、伪造、隐匿**标识，不得为他人提供此类工具或服务
- **第 11 条**：还须符合**强制性国家标准**要求；**第 12 条**：履行**算法备案、安全评估**手续时应提供标识相关材料

**强制性国标 GB 45438-2025**【已核实存在与状态】：标准名称 **《网络安全技术 人工智能生成合成内容标识方法》**，**强制性、现行**，**发布 2025-02-28、实施 2025-09-01**；归口**中央网信办**，委托 **TC260 全国网络安全标准化技术委员会**执行；计划号 20241842-Q-252，ICS 35.030。
⚠️ **未证实**：该标准的**条款级技术要求原文**（在线预览为 JS 渲染，未能取到条号级内容）→ **本报告不描述其具体技术参数**。

> **→ 结论：libtv 的"清晰化"功能产出的成片，应当加显式标识（起始画面 + 播放周边；导出文件内须含）+ 隐式标识（元数据），并遵守 GB 45438-2025。**
> 这也**推翻**了初稿"走非生成式档位（Proteus / Precision）就可以避开标识义务"的想法——**标识义务来自"图像增强"这一技术分类本身，与是否生成式无关。**
> 稳妥做法：**一律加标识**（成本极低，风险规避收益高）。

#### 6.4.1 外包给境外服务对备案链条的影响【解读，非法律意见】

- 法规**没有**"不得使用境外技术支持者"的禁止性条款；**备案义务不因外包而转移**——作为**深度合成服务提供者**，第 10 条内容审核、第 14 条单独同意、第 15 条安全评估、第 16/17 条标识、第 19 条备案义务**仍然全部在自己身上**。
- 但**第 19 条要求"技术支持者参照备案"**，且**标识办法第 12 条**要求在算法备案/安全评估时提交标识材料 → 把视频超分外包给境外服务方，会引入一个**"未备案、且在境外"的技术支持者**，在**备案信息一致性、监管可核查性、境外接收方透明度**三方面构成实质瑕疵。
- **《生成式人工智能服务管理暂行办法》**（七部门令第 15 号，2023-07-13 发布，**2023-08-15 施行**）相关条款：**第 11 条** 对使用者**输入信息和使用记录**"**不得非法留存能够识别使用者身份的输入信息和使用记录，不得非法向他人提供**"（对本项目"把用户成片传给第三方"构成直接约束）；**第 12 条** 应按深度合成规定对生成内容**进行标识**；**第 17 条** 具有舆论属性或社会动员能力的应**开展安全评估**并履行**算法备案**；**第 20 条** 对**来源于境外**向境内提供生成式 AI 服务不合规的，国家网信部门应通知有关机构**采取技术措施和其他必要措施予以处置**。
- **建议**：主动向属地网信部门确认申报口径，**不要默认"外包即无责"**。

> 🆕 **2026 年新增规章（本轮新发现，务必交律师评估）**：**《人工智能拟人化互动服务管理暂行办法》**（网信办、发改委、工信部、公安部、市场监管总局令第 **21** 号，**2026-04-10 公布，自 2026-07-15 施行**）——要求落实安全主体责任、算法机制机理审核、训练数据合法来源。**与漫剧/短剧视频生成业务可能相关。**
> ⚠️ 此前本报告"2025–2026 是否有新规"的疑问，**现确认：确有新增规章**。建议请律师统一复核最新口径。

### 6.5 已从 fal 官方文档实证、直接影响合规判断的事实

| 事实 | 合规含义 |
|---|---|
| fal 服务器在美国及其他国家（[Privacy Policy](https://fal.ai/legal/privacy-policy)，2026-07-22） | 用户视频出境到美国落地 |
| fal 的 DPA 只提供 GDPR/SCC/UK IDTA 机制，**无中国 PIPL 对应机制**（[DPA](https://fal.ai/legal/data-processing-addendum)，2026-07-31） | **无法通过 fal 完成数据出境标准合同闭环** |
| 生成媒体默认在 CDN 保留**至少 7 天**、请求载荷保留 **30 天** | 用户素材在境外留存期可控（可用 header 缩短），但**默认值即已构成出境存储** |
| `X-Fal-Store-IO: 0` 可关闭载荷存储 | 降低留存面，但**不改变"数据已出境"这一事实** |
| fal 只收 USD 卡/美国 ACH | 无中国增值税发票路径 |

### 6.6 风险等级表

| 风险项 | 等级 | 依据 | 缓解措施 |
|---|---|---|---|
| **含人脸成片出境未做标准合同备案** | 🔴 **高** | 网信办令第 16 号第五条(四)/第八条；PIPL 第 28/38/39 条；人脸办法第八条 | **不在境外通道承接含人脸素材**；或完成标准合同备案 + 单独同意 + PIA |
| **跨境大文件传输 15–30% 失败** | 🔴 **高** | 本次实测（50MB 下载掉到 13KB/s、0 字节超时） | 只做兜底；分片续传 + 重试 + 自动回退国内通道 |
| **无法取得中国增值税发票** | 🟡 中 | fal 只收 USD 卡/ACH；Topaz 仅 Stripe | 优先人民币通道；境外仅作效果验证，不做成本入账 |
| **fal 无亚太区域，RTT 193ms + 上传 1.2MB/s** | 🟡 中 | fal 区域列表；本次实测 | 灰度阶段限制素材体积；考虑境外中转（但引入新合规面） |
| **生成式档位可能触发 AIGC 标识义务** | 🟡 中 | 待核实（§6.4） | 优先非生成式档位（Precision / Proteus / FlashVSR） |
| **画质档成本误判（比最低档高 6–15 倍）** | 🟡 **中**（由"低"上调） | 480p→1080p60 的真实区间是 **≈$0.86–36/分钟**：bytedance $0.86 → precision $2.40 → fal Starlight $14.40 → fal Astra 2 **$36.00** | **先锁 precision / bytedance 档**，画质档只用于重点镜头；做预算不得按最低档估 |
| **fal.ai 无法用邮箱/手机号注册** | 🟡 中（新增） | 官方登录页仅 GitHub/Google/Microsoft/SSO | 提前确认可用 SSO；或走 Replicate / Topaz |
| **2026 年新规章适用性未评估** | 🟡 中（新增） | **《人工智能拟人化互动服务管理暂行办法》**（五部门令第 21 号，**2026-04-10 公布，2026-07-15 施行**） | 交律师评估是否适用于漫剧/短剧业务 |
| **fal 计价口径矛盾致成本失控** | 🟢 低 | §1.5 | 小额实测出账；设置用量告警 |
| **DPA 无 PIPL 机制，无对等合同文本** | 🔴 高 | fal DPA 全文 | 见第 1 条 |

---

## 7. 建议（初步，待子任务结论合并后修订）

1. **第 1 步：用腾讯云 MPS 快速上线（零工程投入）**（§3）。理由：**≈¥3.36/分钟**（1080p+60fps 全包，含转码），人民币、后付费、**可开增值税发票**、**素材不出境**（从根上绕开 §6 全部合规问题）、无需跨境带宽。**这是"已复核"方案里的最优解，也是最快能上线的。**
   → **并行立刻做一件事**：人工核实**火山引擎 AI MediaKit 画质增强·极速版（1080P@60 报价 ¥0.8/分钟）**与**百度智能云 MCT（¥1.2–2.4/分钟）**。这两个如果成立，比腾讯云 MPS 便宜 1.4–4 倍，应直接替换。**核实方法**：登录控制台定价页，或直接联系商务询价（火山文档 API 需授权，公开通路拿不到价格，本轮未能复核）。
2. **需要 Topaz 系能力时，直连 Topaz 官方 API，不要走 fal 代理**（§4.1）：同样「precision 超分 + 插帧 30→60fps」，**Topaz 官方 ≈¥8.8–13.2/分钟（Apollo Fast 档 ≈¥6.7–10.0），而 fal 托管版 ≈¥21.3/分钟**（贵约 2 倍），且 fal 版被额外限制 **5 分钟**、官方**无时长上限**。Topaz 官方还提供 webhook、credits/耗时 `estimates`、**按下限计费**、**S3 预签名直传直取**（省掉一次跨境中转）。
3. **境外 API 只能做「无人物素材的效果验证」，不能承接全量用户素材**。两个硬约束（均实证）：
   - **法律**：含可识别人脸的成片出境 = 敏感个人信息出境，**哪怕一天只送 1 条也要标准合同备案或认证**（§6.1），且"去标识化"救不了（超分本身就是在重建人脸）；
   - **网络**：**15–30% 的跨境大文件传输失败或严重劣化**（50MB 下载会掉到 13KB/s 并超时），上传仅 1.2MB/s（§6.2）。
   如果仍要灰度验证效果：
   - 用 `fal-ai/bytedance-upscaler/upscale/video`（≈¥6.1/分钟，一步出 1080p+60fps，有 `short_series`(短剧)/`aigc` 预设）；
   - 补帧单独看，**fal `fal-ai/rife/video` 是全场最便宜的补帧手段（¥0.06–0.6/分钟）**；
   - **Topaz 官方 API 效果最好但须直连官方**（≈¥8.8–13.2/分钟，比 fal 代理便宜一半且无 5 分钟限制）；
   - Replicate 的 **`topazlabs/video-upscale`**（720p/1080p/4K、fps≤60，1.1M runs）值得与 fal 版做 A/B；
   - **灰度素材必须选无人物/景物/已获单独同意的内容，并全程留痕**；实现**分片续传 + 重试 + 自动回退国内通道**。
4. **自建是成本终点，但不是第一步**（§5.2）。**自建 4090 在 RTF=5 下约 ¥0.10/分钟，比腾讯云 MPS 便宜约 30 倍**——这是本报告里最大的成本杠杆。但：
   - **RTF 是假设，不是实测**（Real-ESRGAN / SeedVR2 官方仓库均无吞吐数据）→ **第一步应先花 1–2 天在单卡 4090 上把 `realesr-animevideov3` / `Real-ESRGAN x2plus` × `RIFE` 三种组合各跑 30 秒真实素材，测出"秒/帧"**。RTF 每降一半，成本直接减半。
   - **包月摊薄的边际优势仅约 27%**（¥1.44 vs ¥1.98 每小时），**月处理量 < 4,000 分钟时按量/抢占式一定更划算**；只有月处理量稳定超过约 **8,000 分钟**（RTF=5、利用率 >90%）时包月才有明确优势。
   - **选型**：主力用**共绩算力 4090 抢占式 Job（¥1.19/h）**或 AutoDL 4090 按量（¥1.98/h）；**绝对避开**国产云 Serverless GPU 函数（腾讯 SCF A10 ¥46.40/h、阿里 FC ¥18.42–37.38/h，比租 4090 贵 19–23 倍）与 Replicate 跑自有模型（比自租 GPU 贵 3–4 倍）。
   - **必须把出流量计入**：1080p60 约 8Mbps → 1 分钟产出 ~60MB，腾讯云外网出流量 0.80 元/GB → **+¥0.048/分钟**；用对象存储 + CDN 内网回源规避。
   - **架构用抢占式 + 队列**（超分/插帧是无状态逐帧计算，天然可被抢占并断点续跑）；Vast.ai 类市场必须按 **reliability ≥0.98** 过滤（最低价机器 reliability 可低至 0.761 ≈ 24% 失败率）。
5. **上游聚合网关的既有能力值得先问一遍**：华数 token.wasu.cn、电信 ai.ctaigw.cn 是否已提供或可谈「画质增强/超分/插帧」——如果上游已含，则**零接入成本、零合规增量**，应优先于任何新通道。
6. **MVP 建议先只做「超分 + 去噪」，补帧作为增值项**：纯超分到 720p 只要 **¥0.33/分钟**（腾讯云）或 ¥2.3/分钟（Topaz 官方），成本可忽略；补帧则把分钟成本从 ¥0.33 推到 ¥1.5–3.4。**分开定价能保住毛利。**
7. **工程上必须先落地的约束**：
   - **超长视频切段**：走 **fal 的 Topaz 端点**时硬限 **5 分钟**（Topaz 官方 API 无此限）；腾讯云 MPS 无此声明但按分钟计费。无论走哪条路，**建议都按段（如每 30–60 秒）处理**，以便并发、重试与失败隔离。
   - **音轨处理**：多数超分端点会丢音频。fal 的 FlashVSR 有 `preserve_audio`；腾讯云 MPS 可单独走音频增强/转码。**必须在管线里显式校验输出音轨。**
   - **计费向上取整**：腾讯云按累计秒数换算分钟并**向上取整**，短片段拼接时要按总量而不是按片段数算，避免心智预估偏差。
   - **自动质检**：腾讯云 MPS 的**媒体质检（无参考打分）**可用来对"清晰化"结果做客观评分与回归，建议纳入 CI。
   - **境外不得承接含人脸的素材**（详见 §6 合规），至少在第一阶段如此；灰度阶段建议只处理景物/无人物或已获单独同意的素材。
8. **询价时必须问清「定档口径」**（§3.4.1，官方原文实证）：**阿里云 VIAPI 按输入分辨率定档**（480p 输入 → 落最低档），而**腾讯 MPS/CI、百度 MCT 按输出分辨率定档**（1080p 输出 → 落 FHD 档）。同一个 480p→1080p 需求，两家报价可差近 14 倍。同时警惕**阿里云 MPS/IMS 的"元/帧"报价**——1080p@30fps 标准版换算后是 ¥5.86/分钟，专业版 ¥90/分钟。
9. **实测优先于纸面价格**：fal `topaz/upscale/video/precision` 的两套计价口径互相矛盾（§1.5）；腾讯云各增强项的实际串联计费也需用真实账单验证（例如"超分+插帧"是否两次分别计费）。**投产前各做一次小额真实出账测试。**

---

## 8. 未证实清单（禁止作为决策依据）

| 项 | 状态 |
|---|---|
| fal `topaz/upscale/video/precision` 的真实计费口径（两套数字冲突） | **冲突未解**，须实测出账 |
| fal `fal-ai/creative-upscaler` / `fal-ai/aura-sr` / `fal-ai/seedvr/upscale/image` / `fal-ai/amt-interpolation/frame-interpolation` 的价格 | 未证实（页面无价格） |
| fal `fal-ai/amt-interpolation` 页面显示 "$0 per compute second" 是否为真实定价 | 未证实（疑似未配置） |
| fal `fal-ai/bytedance-upscaler` 的 **720p 档**价格 | 未证实（计价文案只列 1080p/2K/4K） |
| fal 各视频端点（除 fal 托管的 Topaz 系明确 5 分钟外）的输入分辨率/时长硬上限 | 未证实 |
| ~~云 GPU（RunPod/Modal/Vast/AutoDL/共绩 等）具体单价~~ | **已实证**（§5.2.1），全部取自官方定价页或官方市场 API |
| ~~fal.ai / Replicate 在中国大陆的大文件传输表现~~ | **已实测**（§6.2）：域名未被墙，但大文件下载 **15–30% 失败/严重劣化**、上传 1.2MB/s |
| **Real-ESRGAN / SeedVR2 的实测 RTF（秒/帧）** | **未证实——全报告唯一仍是"假设"的关键参数**。两者官方仓库/HF model card **均无吞吐数据**；唯一可引用的公开基准是 RIFE README 的 "30+FPS for 2X 720p on 2080Ti"。**必须先自测校准，否则 §5.2 全部金额不可用于决策。** |
| ~~阿里云是否有「超分/插帧」计费项~~ | **已解决**（§3.4）：阿里云 **VIAPI** 提供视频超分辨/插帧/综合增强公开计费表，**已逐字复核**；阿里云 **MPS/IMS** 有超分（**按"元/帧"**）但**无插帧**；阿里云 **VOD 确实没有**超分/插帧计费项 |
| **火山引擎 AI MediaKit 的全部价格** | ⚠️ **未复核**（我本人未能取得）：定价页与文档站均为纯前端 JS shell（正文 16 字符），文档 API 返回「未授权访问」，无 sitemap/llms.txt。**表格中 ¥1.5/¥0.8/¥2.4 等数字来自并行核查任务，投产前必须人工确认。** |
| **百度智能云 MCT 的智能超分/插帧单价** | ⚠️ **未复核**（子任务产出；MCT 产品页已实证"超分辨率（360p→1080p）"能力存在，但计费页未能抓到数字） |
| 华为云媒体处理（MPC）是否有等价计费项与价格 | 未证实（本轮未查） |
| Replicate `topazlabs/video-upscale` 的 GPU 秒单价、默认硬件、并发限额 | 未证实（需 token）；**模型存在与能力（720p/1080p/4K、fps≤60）已证实** |
| Replicate 上 `zsxkib/*` 等第三方视频增强模型是否上架 | 未证实 |
| **腾讯云 vs 阿里云 VIAPI vs 百度 MCT 的实际出图质量对比** | 未证实——**价格已清楚，但"哪家超分/插帧效果更好"完全没有证据，必须用同一段 480p 素材做盲测** |
| 腾讯云 MPS「超分 + 插帧」叠加时是否分别独立计费（本报告按相加估算） | 未证实，须实测出账 |
| fal 是否支持中国大陆信用卡/银联 | 未证实（条款只说 card / 美国 ACH / USD） |
| ~~§4.2 其他托管平台（18 家）~~ | **已完成**（§4.2）：仅 Runway（双全但贵）、VanceAI（超分最便宜）、upscale.media（人民币）可用；11 家已用官方原文确证**无视频超分能力** |
| **Google Cloud / OpenAI 是否有视频超分 API** | **未证实（网络层不可达，非"查了没有"）**：`cloud.google.com`/`docs.cloud.google.com`/`www.googleapis.com`/`developers.google.com` 全部 http=000；openai.com / platform.openai.com 被 Cloudflare 403。**需在有直连出口的环境复跑** |
| **华为云 MPC 的 SR(4K) 是否可按分钟计价** | 未证实（站点被 EdgeOne 全站拦截；仅有搜索摘要线索"视频超分 SR(4K)"） |
| **「按输入还是按输出定档」在腾讯/百度/火山各家的确切口径** | 仅**阿里云 VIAPI** 有官方原文确认（按输入）；其余各家**按输出**为子任务判断，**须逐家询价确认** |
| ~~§6.4 AI 标识办法施行日期与条款~~ | **已解决**（§6.4）：国信办通字〔2025〕2 号，**2025-09-01 施行**；**深度合成规定第 23 条(五) 明文含"图像增强、图像修复"→ 超分被覆盖**；GB 45438-2025 强制性国标已核实存在 |
| **境外 API 中文"中转站"的合规性** | **已确证为灰产且成规模**（§7 建议第 10 条附近）：GitHub 聚合仓列在线 13 个中转站；可引用罚则《互联网信息服务管理办法》第 19 条**罚 10–100 万元**。**具体某家服务商是否合法无一手证据** |
| **fal / Replicate / Topaz 是否接受银联卡** | 未证实（仅 **Cloudinary 官方公布支持 UnionPay**）→ **必须用真实卡做小额试付验证** |
| **CN2 GIA / 香港中转链路的真实质量与报价** | 未证实（hostloc / bandwagonhost 从本线路不可达；traceroute 被沙箱拒绝） |
| **Topaz credits 计价口径**（开发者文档 "No subscriptions, no minimums" vs 营销页 $50/$240 月费档） | **冲突未解**，签约前须让销售书面确认 |
| **fal `rife/video`、`film/video` 的 `$0.0013/compute-second` 换算** | **未证实**——官方未公布实际 GPU 秒数，**无法换算成元/分钟** |
| **GB 45438-2025 的条款级技术要求原文** | 未证实（在线预览为 JS 渲染）；标准存在性/日期/归口已核实 |
| 各自贸区**数据出境负面清单**的具体内容 | 未证实（第 6 条制度依据已核实，清单本身未证实） |

---

## 附：本报告主要来源 URL

**fal.ai**
- 模型索引接口：`https://fal.ai/api/models?keywords=upscale|upscale%20video|interpolation|topaz|...`（无需 token）
- 队列 OpenAPI（含输入 schema 与文档正文）：`https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=<model_id>`（无需 token）
- 计价页：https://fal.ai/pricing ｜ 文档：https://fal.ai/docs ｜ 全量文档：https://fal.ai/docs/llms-full.txt
- 异步/Webhook：https://fal.ai/docs/documentation/model-apis/inference/queue ｜ https://fal.ai/docs/documentation/model-endpoints/webhooks
- 并发限制：https://fal.ai/docs/documentation/model-apis/concurrency-limits
- 数据保留：https://fal.ai/docs/documentation/model-apis/media-expiration
- 服务条款（2026-09-08）：https://fal.ai/legal/terms-of-service
- 隐私政策（2026-07-22）：https://fal.ai/legal/privacy-policy
- DPA（2026-07-31）：https://fal.ai/legal/data-processing-addendum
- 关键模型页：
  - https://fal.ai/models/fal-ai/bytedance-upscaler/upscale/video
  - https://fal.ai/models/fal-ai/seedvr/upscale/video ｜ https://fal.ai/models/fal-ai/flashvsr/upscale/video
  - https://fal.ai/models/topaz/upscale/video/precision ｜ .../generative ｜ .../creative
  - https://fal.ai/models/topaz/interpolate/video
  - https://fal.ai/models/topaz/denoise/video ｜ .../deblur ｜ .../colorize ｜ .../sdr-to-hdr
  - https://fal.ai/models/fal-ai/topaz/upscale/video （旧统一端点）｜ https://fal.ai/models/fal-ai/topaz/upscale/image
  - https://fal.ai/models/fal-ai/rife/video ｜ https://fal.ai/models/fal-ai/film/video
  - https://fal.ai/models/clarityai/crystal-video-upscaler ｜ https://fal.ai/models/blackforestlabs/flux-video-upscale

**Replicate**
- https://replicate.com/nightmareai/real-esrgan （HTML 可抓）
- `https://api.replicate.com/v1/models?query=<kw>` （需 token，无 token 返回 401）

**腾讯云媒体处理 MPS（本轮最重要的国内实证）**
- 按量计费（含「视频增强 / 插帧 / 超分 / 大模型视频增强」完整价格表，页面更新于 **2026-09-24**）：https://cloud.tencent.com/document/product/862/36180
- 发起媒体处理 API（`ProcessMedia`，`mps.tencentcloudapi.com`，页面更新于 **2026-09-11**）：https://cloud.tencent.com/document/product/862/37578
- 说明：抓取该站需 `curl --compressed`（响应为 gzip），否则会因解码失败而拿不到正文。

**阿里云（已解决，`.md` 直出可直接抓）**
- **视觉智能开放平台 VIAPI 计费（含视频超分辨/插帧/综合增强完整价格表 + 「按输入分辨率定档」原文，已逐字复核）**：https://help.aliyun.com/zh/viapi/product-overview/billing-is-introduced-9
  - 关键原文：「**分辨率按照输入视频的分辨率，帧率按照输出视频的帧率，时长按照输出视频的时长**进行计费」
  - 抓取技巧：阿里云帮助中心支持 **`.md` 直出**（URL 后加 `.md`），或读 `https://help.aliyun.com/zh/<产品>/llms.txt` 取索引。这是抓阿里云最有效的方法。
- 函数计算 FC GPU 实例规格与 CU 计费：`help.aliyun.com/zh/functioncompute/instance-types-and-specifications` ｜ `.../pay-as-you-go-billing-methods`
- ECS GPU 规格族：`help.aliyun.com/zh/ecs/llms.txt`（规格齐全，但**文档零价格**，只指向前端价格计算器）

**腾讯云（补充）**
- 云函数 SCF GPU 函数支持与规格（更新 **2026-08-20**）：https://cloud.tencent.com/document/product/583/68734
- SCF GPU 计费（0.00011108 元/GBs）：https://cloud.tencent.com/document/product/583/12281
- SCF GPU 算力包年包月（官方原值）：https://cloud.tencent.com/document/product/583/124568

**云 GPU（境外）**
- RunPod 定价（页面标注 **Updated September 27, 2026**）：https://www.runpod.io/pricing
- RunPod Serverless 定价（改于 2026-07-20）：https://docs.runpod.io/serverless/pricing
- Modal 定价：https://modal.com/pricing ｜ 扩缩容与 warm pool：https://modal.com/docs/guide/scale
- Vast.ai 公开市场 API（可直抓）：`https://console.vast.ai/api/v0/bundles/` ｜ 定价说明：https://vast.ai/pricing
- Lambda：https://lambda.ai/pricing ｜ Together GPU 集群：https://together.ai/gpu-clusters
- Replicate 定价（含私有模型"三段全计费"原文）：https://replicate.com/pricing

**云 GPU（国内）**
- **共绩算力定价（静态 HTML，全文可抓，本轮最透明的国内平台）**：https://www.gongjiyun.com/pricing
- AutoDL 公开市场 API：`POST https://www.autodl.com/api/v1/machine/list`（`charge_type=payg`）｜ 计费规则：https://www.autodl.com/docs/price/
- 潞晨云转型公告：https://cloud.luchentech.com
- 火山引擎：**公开通路无法取得价格**（定价页与文档站为 JS shell，文档 API 返回「未授权访问」，无 sitemap/llms.txt）——需登录控制台或联系商务

**开源模型（RTF 基准来源）**
- RIFE（唯一有公开吞吐数据的）：https://github.com/hzwer/ECCV2022-RIFE —— README 原文 "Currently, our model can run **30+FPS for 2X 720p interpolation on a 2080Ti GPU**"
- Real-ESRGAN：https://github.com/xinntao/Real-ESRGAN —— **无任何 fps/秒每帧数据**
- SeedVR2：https://github.com/ByteDance-Seed/SeedVR ｜ https://huggingface.co/ByteDance-Seed/SeedVR2-7B —— **无吞吐数据**

**其他平台（§4.2）**
- Runway：`https://docs.dev.runwayml.com`（提供 `llms.txt` + 逐页 `.md`）｜ VanceAI：`https://vanceai.com/api/v1`（文档）
- Topaz 开发者文档（GitBook，`llms.txt` + 逐页 `.md` 可用）：`https://developer.topazlabs.com`
- 开源许可：`https://raw.githubusercontent.com/TencentARC/GFPGAN/master/LICENSE`（**非商业条款原文**）｜ `https://raw.githubusercontent.com/xinntao/Real-ESRGAN/master/LICENSE`（BSD-3-Clause）
- Cloudinary effect 参考（`e_upscale` = "Applies to: images"）｜ Cloudflare Media Transformations（`fit=scale-down` = "Do not upscale"）｜ Mux `docs/api-reference/video.txt`

**合规依据（官方法规原文）**
- 《促进和规范数据跨境流动规定》（网信办令第 16 号，2024-03-22 施行）：gov.cn / 中国网信网
- 《个人信息保护法》第 28 / 38 / 39 / 55 / 73 条
- 《人脸识别技术应用安全管理办法》（网信办、公安部令第 19 号，2025-06-01 施行）第八条、第十五条（人脸信息达 10 万人须备案）
- 《互联网信息服务深度合成管理规定》（网信办、工信部、公安部令第 12 号，2023-01-10 施行）**第二十三条(五)「图像增强、图像修复」**、第 14/15/16/17/19 条：https://www.gov.cn/zhengce/zhengceku/2022-12/12/content_5731431.htm
- 《人工智能生成合成内容标识办法》（国信办通字〔2025〕2 号，**2025-09-01 施行**）第 3/4/5/9/10/11/12 条：https://www.gov.cn/zhengce/zhengceku/202503/content_7014286.htm
- **GB 45438-2025**《网络安全技术 人工智能生成合成内容标识方法》（强制性，发布 2025-02-28 / 实施 2025-09-01）：https://std.samr.gov.cn/
- 《生成式人工智能服务管理暂行办法》（七部门令第 15 号，2023-08-15 施行）第 11/12/17/20 条：https://www.gov.cn/zhengce/zhengceku/202307/content_6891752.htm
- 《网络数据安全管理条例》（国令第 790 号，2025-01-01 施行）第 12/35/37/38 条：https://www.gov.cn/zhengce/zhengceku/202409/content_6977767.htm
- 《个人信息出境标准合同办法》（网信办令第 13 号，2023-06-01 施行）第 4/7 条（10 个工作日内省级网信备案）
- 🆕 **《人工智能拟人化互动服务管理暂行办法》**（五部门令第 21 号，**2026-04-10 公布，2026-07-15 施行**）：https://www.gov.cn/gongbao/2026/issue_12806/202606/content_7072472.html
- 《互联网信息服务管理办法》（国务院令第 292 号）第 4 条、**第 19 条（未取得经营许可罚 10–100 万元）** —— 用于判断"API 中转站"的合规性
- 阿里云视频点播文档站：https://help.aliyun.com/zh/vod/ ｜ 计费总览：https://help.aliyun.com/zh/vod/product-overview/billing-overview （**正文为前端 JS 渲染，curl 抓不到内容；本次未取得价格证据**）