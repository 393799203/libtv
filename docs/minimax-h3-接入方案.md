# MiniMax H3 接入方案（libtv）

> 调研日期：2026-10-10　渠道：电信 `ai.ctaigw.cn`　模型：`minimax-h3`
> 本文所有接口字段、枚举、限额均来自 **MiniMax 官方 OpenAPI 规格**（`platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json`）
> 与官方可运行脚本（`github.com/MiniMax-AI/MiniMax-H3/scripts/readme/`），并已在**我们自己的网关**上用免真实任务的探针逐条核对（见 §1）。
> 标注约定：**[已实测]** 我打过的真实请求；**[官方规格]** 官方 OpenAPI/脚本原文；**[待实测]** 需要开通后跑一次真实任务才能确认。

---

## 0. 一页结论

**能力规格（官方规格）**

| 项 | 值 |
|---|---|
| 模型 id（我们网关） | `minimax-h3`（上游规范化为 `MiniMax-H3`；网关 `/v1/models` 已收录） |
| 分辨率 | `768P` / `2K`（枚举里还有 `480P`，但 480P 属于 **H3-Max**，H3 不支持；网关未上架 H3-Max） |
| 时长 | **整数 4–15 秒**（必填，无默认值） |
| 比例 | `adaptive`(默认) / `21:9` / `16:9` / `4:3` / `1:1` / `3:4` / `9:16` |
| 输出 | 24 FPS，**原生立体声音频 32kHz**（不可关，没有 `generate_audio` 参数） |
| 输入 | `text`(必填, ≤7000 字) + 图(≤9, 首/尾帧各≤1) + 视频(≤3, 单段 2–15s, 合计≤15s) + 音频(≤3, 单段 2–15s, 合计≤15s)；**全类型文件合计 ≤12**；请求体 ≤64MB |
| 互斥 | 首尾帧（`first_frame`/`last_frame`）与参考（`reference_*`）**不可混用** |
| 计费（CN 刊例） | 生成 768P **0.50 元/秒**、2K **0.80 元/秒**；再生成(768P→2K) **0.30 元/秒**；输入音频免费、图 ≤5 张免费(超出 0.20 元/张)、参考视频按输出档 0.50/0.80 元/秒；Context-IR 输入 5.80 元/M tokens、输出 23.00 元/M tokens |

**三条接口 + 三条管理接口（官方规格，网关路径为 `/v1` 前缀）**

| 用途 | 我们网关路径 | 官方路径 |
|---|---|---|
| 创建视频生成任务 | `POST /v1/video_generation` | `POST /v2/video_generation` |
| 创建 H3-Context-IR 任务 | `POST /v1/h3_context_ir` | `POST /v2/h3_context_ir` |
| 创建视频再生成任务 | `POST /v1/video_regeneration` | `POST /v2/video_regeneration` |
| 查询单个任务 | `GET /v1/query/video_generation/{task_id}` | `GET /v2/query/video_generation/{task_id}` |
| 列出任务（分页/筛选） | 路由存在性未确认 | `GET /v2/query/video_generation` |
| 取消或删除任务 | `DELETE /v1/video_generation/{task_id}` **[已实测]** 路由存在 | `DELETE /v2/video_generation/{task_id}` |

**三条必须先进设计再写代码的结论**

1. **分辨率不能走现有兜底**：`GenerateVideo` 现在把空分辨率兜成 `1080p`，而 H3 的枚举里**没有 1080p**，硬塞会被上游拒单。H3 必须传原始值，且 `resolution`、`duration` 都是**必填**。
2. **再生成拿不到「IR 后的最终 prompt」就做不成**：`video_regeneration` 的 `text` 项明确要求「*生成 768P 源视频时实际送给模型的最终 prompt，而不是 IR 之前的原始提示词*」。我们如果只调一条龙的 `video_generation`，是看不到这份 prompt 的 → 要么走**需要白名单**的 `source_task_id` 形态，要么**先自己跑 `h3_context_ir` 并把 `content.prompt` 落库**。
3. **静音开关没有对应参数**：H3 音频是生成出来的原生立体声，请求里没有 `generate_audio`。我们视频节点的「静音」选项对 H3 只能靠**转码阶段静音**（复用 `service/transcode_service.go`），或在 H3 模型上隐藏该开关。

---

## 1. 今天的实测记录（免真实任务的探针）

所有探针都刻意让请求**在参数校验阶段失败**，因此没有创建任何真实任务、没有产生费用。

| # | 探针 | 结果 | 结论 |
|---|---|---|---|
| 1 | `GET /v1/models` | 列表中出现 `minimax-h3` | 开通已生效；网关模型清单已补录 |
| 2 | `POST /v1/video_generation {"model":"minimax-h3"}` | 400 `binding: expr_path=content, cause=missing required parameter` | `content` 必填 |
| 3 | 同上 `content` 传对象而非数组 | 400 `Mismatch type []*open_platform.VideoGenContentItem` | **网关即 MiniMax 官方协议**（Go 结构体名直出），字段与官方规格一致 |
| 4 | `content: []` | 400 `missing required parameter` 指向 `duration` | `duration` 必填；空 content 视同缺失 |
| 5 | `duration` 传字符串 / `resolution` 传数字 / `ratio` 传数字 | 400 `Mismatch type string with value number` | 类型为 `duration:int64`、`resolution:string`、`ratio:string` |
| 6 | 错误回显里的模型名 | 回显 `"MiniMax-H3"`（我们发的是 `minimax-h3`） | 网关会规范化模型名后转发，大小写不影响调用 |
| 7 | `model` 写 `MiniMax-H3` / `minimax_h3` | 404 `model_not_found` | **只认 `minimax-h3`**（与 H3 严格区分） |
| 8 | `POST /v1/video_regeneration {"model":"minimax-h3"}` | 400 `binding: expr_path=resolution` | `resolution` 必填 |
| 9 | `POST /v1/video_regeneration {model, resolution:"2K"}` | 400 `either source_task_id or exactly one base_video (type=video_url, role=base_video) content item is required` | **再生成有两种互斥形态**（官方规格里正好是两个 schema） |
| 10 | 再生成 + 不存在的 `source_task_id` | 400 `source task not found` | 网关会校验源任务存在性 |
| 11 | `GET /v1/query/video_generation|h3_context_ir/{任意id}` | 404 `task_not_found` | 三条任务共用 `video_generation` 查询路径（与官方脚本一致），另有 `h3_context_ir` 查询别名 |
| 12 | `DELETE /v1/video_generation/999` | 404 `task_not_found` | 取消/删除路由存在 |
| 13 | 用 `cdance2.0-0807` 打这三条新路径 | 上游 `Invalid URL (POST /api/v3/video_generation)` | 三条路径是 **MiniMax 原生协议专属**，与 cdance/wan 协议不互通 |

---

## 2. 接口契约（官方规格原文整理）

### 2.1 创建视频生成任务 `POST /v1/video_generation`

`ContentItem`：`{type, text?, image_url?{url}, video_url?{url}, audio_url?{url}, role?}`

- `type` ∈ `text | image_url | video_url | audio_url`
- `role` ∈ `first_frame | last_frame | reference_image | reference_video | reference_audio`
  - 单图且不写 `role` → 默认 `first_frame`
- `url` 支持 **公网 URL** 或 **Base64 data URI**（`data:image/jpeg;base64,...`）
- 必填：`model` / `content` / `resolution` / `duration`；可选：`ratio`(默认 `adaptive`) / `callback_url` / `extra`(仅 H3-Max)

```json
{
  "model": "minimax-h3",
  "content": [{ "type": "text", "text": "史诗级太空歌剧院线预告：…" }],
  "resolution": "2K",
  "duration": 5,
  "ratio": "16:9"
}
```
→ 响应：`{ "task_id": "424010985738629" }`

**参考模式（Ref2VA）示例**（对应我们画布的「全能参考」）：

```json
{
  "model": "minimax-h3",
  "content": [
    { "type": "text", "text": "角色说：… 音色参考音频 1。" },
    { "type": "image_url", "image_url": { "url": "https://…/a.png" }, "role": "reference_image" },
    { "type": "video_url", "video_url": { "url": "https://…/v.mp4" }, "role": "reference_video" },
    { "type": "audio_url", "audio_url": { "url": "https://…/a.mp3" }, "role": "reference_audio" }
  ],
  "resolution": "2K",
  "duration": 5,
  "ratio": "adaptive"
}
```

### 2.2 创建 H3-Context-IR 任务 `POST /v1/h3_context_ir`

只做「多模态输入 → 结构化上下文表示」这一步，**产出的是一段结构化 prompt（文本），不是视频**。

- 必填：`model`(仅 `MiniMax-H3`) / `content` / `duration`；可选：`ratio` / `callback_url`
- 与生成接口的区别：**没有 `resolution`**（IR 与分辨率无关）
- 成功后的查询响应：

```json
{ "task": { "id": "…", "model": "MiniMax-H3", "status": "succeeded",
  "content": { "prompt": "integrated_multimodal_description: [Shot 1] …\noverall_soundscape: …\nnon_diegetic_music: …" },
  "duration": 10, "usage": { "total_tokens": 8565, "prompt_tokens": 5650, "completion_tokens": 2915 },
  "ratio": "16:9", "task_type": "h3_context_ir", "modality": "text" } }
```

官方定位（README）：*「H3-Context-IR 对最终画质至关重要，强烈建议纳入生成流水线」*，它把自由形态的文/图/视频/音频及其相互关系序列化成 H3-Base 能吃的表示，并会在不偏离用户意图的前提下补齐欠描述的语义细节。

### 2.3 创建视频再生成任务 `POST /v1/video_regeneration`（**两种互斥形态**）

**形态 A：按源任务号**（官方：`source_task_id` 必须是**已成功**的 `/v2/video_generation` 任务，**需要白名单权限**，且源任务必须属于同一账号）

```json
{ "model": "minimax-h3", "source_task_id": "424010985738629", "resolution": "2K" }
```

**形态 B：按 base_video**（自己提供 768P 成片；`content` 里必须**恰好一个** `role=base_video` 的 `video_url` 项，并**必须带上当初生成它的最终 prompt**）

```json
{
  "model": "minimax-h3",
  "content": [
    { "type": "text", "text": "<IR 处理后的最终 prompt，而非用户原始输入>" },
    { "type": "video_url", "video_url": { "url": "https://…/768p.mp4" }, "role": "base_video" }
  ],
  "resolution": "2K",
  "aigc_watermark": false
}
```
（官方脚本还把本地 mp4 编码成 `data:video/mp4;base64,…` 直接塞进 `url`；官方建议生产环境用公网 URL）

- `resolution` 枚举只有 `2K`；`aigc_watermark` 默认 `false`
- 计费：**按再生成的输出秒数** 0.30 元/秒；**原始 768P 任务的输入素材会被再计一次**（音频免费、图 ≤5 张免费、参考视频 0.30 元/秒）
- 官方定性：*「把符合 H3 768P 输出规格的源视频重生成为 2K」* —— 是 **in-context 重生成**，不是通用超分

### 2.4 查询 / 列表 / 取消

`GET /v1/query/video_generation/{task_id}`（**三类任务共用**）：

```json
{ "task": {
  "id": "…", "model": "MiniMax-H3",
  "status": "queued | running | succeeded | failed | cancelled",
  "error": { "code": "…", "message": "…" },
  "created_at": 1785229015, "updated_at": 1785229015,
  "content": { "url": "<限时可下载地址>", "prompt": "<仅 h3_context_ir 成功时返回>" },
  "resolution": "2K", "duration": 5,
  "usage": { "total_seconds": 10, "input_seconds": 0, "output_seconds": 10,
             "input_image_count": 1, "input_audio_seconds": 0,
             "total_tokens": 0, "prompt_tokens": 0, "completion_tokens": 0 },
  "ratio": "16:9", "task_type": "generation | h3_context_ir | regeneration",
  "modality": "video | text" } }
```

- **任务只保留最近 7 天**；`content.url` 是**限时**地址，必须尽快转存到我们自己的存储（我们现有流程已经是「上游 URL → 转存 → 交付」，天然契合）
- `usage` 是成本侧对账的金标准：视频任务给**秒**口径（`total_seconds = input_seconds + output_seconds`、`input_image_count`、`input_audio_seconds`），IR 任务给 **token** 口径
- `task_type` 三个值正好可以映射成我们对账行的任务类型（见 §3.5）

错误码（官方 errorcode 文档）：`1002` 限流 / `1026` 输入违规 / `1027` 输出违规 / `2013` 参数错误；HTTP 语义为 `400/401/402/422/429/500/529`。

---

## 3. 我们平台怎么接入

### 3.1 模型清单：`server/configs/models.yaml`

在 `models.dianxin.video` 下新增（与 `wan3.0-video` 同级）：

```yaml
      - id: minimax-h3
        name: "MiniMax H3"
        provider: dianxin
        model_id: "minimax-h3"
        usage: [video]
        temperature: 0
        description: "MiniMax H3 全模态视频模型（原生立体声、768P/2K、4-15 秒；支持首尾帧与图/视频/音频全参考）"
        resolutions: ["768P", "2K"]
        duration_range: [4, 15]
        ref_video_billing: true   # 参考视频按「输入时长 + 输出时长」计费（上游即如此计费）
```

要点：
- `resolutions` 用**新档位字面值** `768P` / `2K`（上游枚举就是大写 P，别写成 `768p`）。
- `duration_range: [4,15]` 与上游枚举完全一致（不需要改时长兜底表，但 `videoDurationRangeByModel()` 里可按需加一条 H3 分支保证绕过 executor 时的兜底一致）。
- `ref_video_billing: true` —— 上游对参考视频**按输出分辨率的秒价再算一遍输入时长**，与现有「输入+输出」口径天然一致。
- 计费层面 `resolution` 是 H3 的一等维度，`2K` 与图片档同名但 `node_type` 不同，价格分行互不干扰。

### 3.2 协议实现：`server/internal/llm/video.go`

`GenerateVideo` 现有分派是「电信渠道 → wan3.0 走 DashScope / 其余走 cdance」。H3 是**第三条协议**，必须显式分支，且要用**原始分辨率**：

```go
if ChannelFrom(ctx) == ChannelDianxin {
    if strings.Contains(model, "minimax-h3") || strings.Contains(model, "MiniMax-H3") {
        return c.generateH3Video(ctx, model, prompt, duration, requestedResolution, ratio, …)
    }
    …
}
```

新增实现（建议直接照抄官方 payload，字段一律 snake_case）：

1. **续跑复用**：进函数先查 `AsyncTaskHolder(ctx)`，有 `TaskID` 就直接 `pollH3Task`（与 cdance/wan 完全一致，避免重启重复下发）。
2. **content 组装**：复用 `collectMedia(ctx, …, "reference_image")`，把现有 role 词汇映射到上游：
   - 首尾帧模式 → `first_frame` / `last_frame`（现有 role 就是这两个词，直接可用）
   - 通用参考 → `reference_image` / `reference_video` / `reference_audio`
   - 上游规定**首尾帧与参考互斥**；我们代码里「首尾帧模式忽略参考视频/音频」的既有行为**正好符合**，但要补一条：H3 下**参考图也不能与首尾帧同时出现**。
3. **必填项兜底**：`resolution` 为空 → 按 `models.yaml` 的默认档（建议 768P），**绝不能兜成 1080p**；`duration` 一定传（已由 executor 钳制到 4–15）。
4. **静音/水印**：H3 生成接口**没有** `generate_audio` 与 `watermark` 字段 —— 静音需求走转码静音；水印只有再生成接口有 `aigc_watermark`。
5. **轮询**：复用现有轮询骨架（5s 间隔、25 分钟预算），响应解析按 §2.4：`task.status` 三态映射
   - `succeeded` → 取 `task.content.url`，同时 `recordUpstreamUsage(ctx, task.usage)`（现有 `usage.go` 已能把 `total_tokens` 记进 `provider_tokens`、其余键摊进 `provider_usage`，H3 的秒口径字段会**原样落到对账页**，零改造）
   - `failed` / `cancelled` → 取 `task.error.message`；**归 `ErrUpstreamRejected` 只在「上游自己报错」时**（`failed` 且带 error 文案 = 上游明确失败，可自动退费；`cancelled` 若是我们主动取消则不退，见下）
   - `queued` / `running` → `reportProgress(ctx, "上游生成中", 0)`
6. **错误映射表**（对齐现有 `ShouldAutoRefund` 口径：只有上游明确拒绝才自动退）

| 上游 | 归属 | 处理 |
|---|---|---|
| HTTP 400 `2013` / `1026` 输入违规 | `ErrUpstreamRejected` | 自动退费（用户改提示词重试） |
| HTTP 402 余额不足 | `ErrUpstreamRejected`（**但不应退用户**，是渠道侧没钱） | 记 `pending_review`，同时告警运维 |
| HTTP 429 `1002` | 可重试 | 创建阶段走现有 `doCreateWithRetry` |
| HTTP 500/529 | 不自动退 | `pending_review`（上游可能已计费） |
| 排队中 → `failed`（输出违规 1027） | `ErrUpstreamRejected` | 自动退费 |

7. **取消/超时**：`DELETE /v1/video_generation/{task_id}` 已实测存在。用户点「停止生成」时，我们现在只是本地取消（`context.Canceled`，不自动退费，因为上游可能已生成），**接 H3 后可以真的联上下游取消**：排队/运行中的任务取消掉，就有依据不退费或按上游实际用量结算 —— 这是接入 H3 顺带能补上的一个老问题。

### 3.3 计费与定价（运营后台「价格管理」）

- `model_prices` 配两行：`(channel=dianxin, node_type=video, model_id=minimax-h3, resolution=768P)` 与 `(…, resolution=2K)`，单位为**积分/秒**。
- 成本锚点（CN 刊例）：768P 0.50 元/秒、2K 0.80 元/秒；我们渠道的实际结算价需向网关方确认后再定售价。
- 参考视频：上游对**输入视频秒数按输出档单价再算一遍** → 与现有 `ChargeVideoByDuration(输出秒数, refVideoSeconds)` 完全同构，开启 `ref_video_billing` 即可。
- 输入图片超 5 张要另计（0.20 元/张）：**我们的计费模型目前只有「秒 × 分辨率」，没有图片张数维度** → 建议 P0 阶段在业务上限制参考图 ≤5 张（或把超量成本计入售价系数），避免出现「用户传 9 张、我们按 5 张的成本定价」的隐性亏损。
- Context-IR 是 **token 计费**（输入 5.80 / 输出 23.00 元每 M tokens）：若单独上架 IR（P2），需要新的计费维度（`node_type=context_ir`，按 `usage.total_tokens` 折算），不能套视频秒价。

### 3.4 前端改动

| 文件 | 改什么 |
|---|---|
| `web/src/configs/promptConfig.ts` | `VIDEO_RESOLUTION_OPTIONS` 增加 `'768P'`、`'2K'`（或改为按模型 `resolutions` 动态取，避免枚举散落） |
| `web/src/types/prompt.ts` | `ResolutionOption` 增加 `'768P'`；比例类型补 `21:9` |
| `web/src/components/panels/prompt/PromptToolbar.tsx` | 档位中文文案（`768P`→「标准」、`2K`→「2K 超清」）；现有「480p 偏软、建议升级」引导逻辑要**限定为真支持 480p 的模型**，否则 H3 上会出现「建议切到 480p」这类不存在的档位 |
| `web/src/components/auth/PointsMallModal.tsx` | 参考价取「第一个 480p 已配价模型」→ H3 没有 480p 档；需改成「第一个已配价视频模型」，否则积分超市的预估单价会失真 |
| 视频节点 / 分辨率面板 | **H3 必须显著标注「MiniMax H3」**（开源社区许可的硬性要求，见 §3.6） |
| 静音开关 | H3 模型下隐藏或改为「生成后静音」（转码处理） |

### 3.5 对账与运维

- 现有 `provider_tasks` 无需加列：`task_kind` 已存在，`provider_tokens` / `provider_usage` 直接吃 H3 的 `usage`；`charge_resolution` 存 `768P`/`2K`（列宽 32，够）。
- **`task_type` 三个值要映射进 `task_kind`**：`generation` → `ai.video`；`regeneration` → 新的计费动作（建议 `ai.video_regenerate`），这样对账页能把「2K 重制」单独筛出来、单独统计单价与成功率，不会污染视频生成的口径。
- 上游任务只保留 7 天 + `content.url` 限时 → 我们的对账行与转存必须**自持**（现有设计已经如此）。
- 可选增强：用 `GET /v2/query/video_generation`（列表/筛选）做**自动对账**，把上游侧的任务与我们对账行定期比对（现在只能人工翻）。

### 3.6 合规（开源社区许可的硬性条款，不能漏）

来自官方 FAQ 与 LICENSE 要点：
1. **使用 H3 的商业产品必须在界面显著标注「MiniMax H3」** → 模型名、节点、生成结果处都要能看见。
2. 商业产品/服务**年收入超过 2000 万美元**需另行书面授权（`api@minimax.io`）。
3 **产出与权重不得用于训练或改进非 H3 系的 AI 模型**。
4. 若把 H3 托管给第三方使用，须落实**合理的内容安全措施** → 我们的输入/输出侧应有基本审核（上游本身有自动审核，`1026/1027` 就是它拦下来的）。
5. 权重下载地区限制（EU/UK/US/KR）不适用于 API 调用，与我们无关。

---

## 4. 三个问题的直接回答

**① 我们平台怎么接入** → §3：`models.yaml` 加一条（768P/2K、4–15s）→ `video.go` 加第三条协议分支（content 组装 + 25 分钟轮询 + 错误映射 + usage 落库）→ 前端补档位与品牌标注 → 后台配两档秒价。改动集中在 **1 个 yaml + 1 个 go 文件 + 4 个前端文件 + 后台价格配置**，不需要动 executor/计费/对账的主干。

**② IR 任务是什么** → H3 = 三件套：**H3-Context-IR**（托管的多模态预处理与编排，把文/图/视频/音频及其关系序列化成结构化表示，官方称对最终画质至关重要，原始素材约 100K tokens 蒸馏到约 4K）+ **H3-Base**（768P 生成、≤15s、原生立体声）+ **H3-Regenerate-2K**（把 768P 结果连同原始上下文送回模型，以原生 2K 重生成，不是传统超分）。`/h3_context_ir` 就是只跑第一步，**只出文本 prompt + token 用量**，没有 `resolution`。对我们：一条龙 `video_generation` 内部已经跑了 IR，**除非要做「再生成」或「一次上下文多次生成」，否则不必单独接** —— 但 §2.3 的 prompt 约束让它从「可选」变成「再生成功能的前置条件」。

**③ 怎么区分再生成** → 三层都能区分：
- **协议层**：再生成没有 `resolution` 以外的自由度（只有 `2K`），入参是 `source_task_id` **或** `content` 里唯一的 `role=base_video`；它不接受「从零创造」，只接受「把一个 768P 成片重生成成 2K」。`task_type` 字段把它标成 `regeneration`。
- **成本层**：再生成 0.30 元/秒（输出）+ 输入素材重算；生成 0.50–0.80 元/秒。两者定价必须分档。
- **平台层**（我们要做的）：独立计费动作/节点维度（`ai.video_regenerate`）、`provider_tasks.task_kind` 单独一类、必须绑定源产物血缘（源任务/源视频 + **当初的最终 prompt**）、幂等走 `AsyncTaskRef` + `charge_key`、UI 上「重新生成（换一版）」与「再生成 2K（同片高清重制）」文案分离。

---

## 5. 分期实施计划

### 开工前必测（约 10 分钟，跑一次 768P/5s 即可全部覆盖）

> 今天所有结论都来自「参数校验阶段的免费用探针」+ 官方规格，**没有跑过真实任务**。
> 下面 5 项是只有真实调用才能确认的，建议明天写代码前先跑一遍（预计 2.5 元左右）：

| # | 要确认的事 | 怎么测 | 影响 |
|---|---|---|---|
| 1 | 网关 `/v1/query/video_generation/{id}` 的返回体是否就是官方 `{"task":{…}}` 形状 | 创建后立刻轮询，打印原始 JSON | 决定 `pollH3Task` 的解析结构，猜错会一直轮询到超时 |
| 2 | `status` 实际取值与流转（`queued`→`running`→`succeeded`？） | 同上，记录每次轮询的 status | 决定状态机分支与进度文案 |
| 3 | `usage` 字段是否回带、能否落进 `provider_tokens`/`provider_usage` | 成功响应里看 `task.usage` | 决定对账页成本侧是否有数 |
| 4 | `content.url` 我们的服务器能不能下载（域名可达性/是否需要 UA） | 在服务器上 `curl -I` 该地址 | 决定转存是否会失败、要不要兜底 |
| 5 | 768P / 2K 的实际耗时 | 记录创建→成功的时长 | 决定 25 分钟轮询预算与 30 分钟执行超时是否要抬 |

### P0：一条龙生成（最小可用，1 天量级）
1. `models.yaml` 增加 `minimax-h3`；后台配 768P / 2K 两档秒价。
2. `video.go` 新增 `generateH3Video` + `pollH3Task` + 分派分支（含 §3.2 的 7 条要点）。
3. 前端档位/文案/参考价修正 + 「MiniMax H3」标注。
4. **验收**：画布视频节点选 H3 → 768P/5s 文生视频出片；选 2K 出片；上游 `usage` 出现在对账页；重启后端后能续跑同一任务；上游明确拒绝时自动退费。

### P1：参考与首尾帧完整打通
1. 参考图/视频/音频 → `reference_*` 的角色映射与数量/时长/体积校验（≤9 图、≤3+≤3、合计 ≤12、单文件体积、比例范围）。
2. 首尾帧与参考互斥的前后端一致性（H3 下参考图也不能与首尾帧混用）。
3. 参考视频的计费口径（输入+输出秒）与 `ref_video_billing` 校验。
4. **验收**：9 图 + 2 视频 + 2 音频的「全能参考」任务能下发并在预算内出片；超限时给中文可读报错，不把上游英文原文直给用户。

### P2：Context-IR 与 2K 再生成
1. 新增 `generateH3ContextIR`：把用户原始提示词 → 结构化 prompt，落库（推断/节点数据 + 对账备注），供再生成复用。
2. 再生成两种形态二选一（优先 **base_video 形态**，不依赖白名单）：
   - 新增节点/入口「再生成 2K」，读取源视频血缘（源视频我们的存储 URL + 当初的 IR 最终 prompt）
   - 新计费动作 `ai.video_regenerate`（0.30 元/秒档）；`aigc_watermark` 是否开启按合规需要
3. 可选：IR 单独上架（token 计费维度）。
4. **验收**：对一个已交付的 H3 768P 产物，一键出 2K 版本；对账页能区分两类任务；非 H3 产物走该入口被明确拒绝并给出理由。

---

## 6. 风险与待确认

| # | 事项 | 影响 | 处理 |
|---|---|---|---|
| 1 | 再生成形态 A（`source_task_id`）**需要白名单权限**，且源任务须属同一账号 | 若没有白名单，「按任务号重制」做不了 | 向网关方确认；优先用 base_video 形态 |
| 2 | 再生成要求「**IR 之后的最终 prompt**」 | 只走一条龙生成就拿不到它 | P2 落地前必须先做 IR 前置并落库（P2.1） |
| 3 | 上游任务**只保留 7 天**、`content.url` 限时 | 过期即无法回溯 | 我们自持对账行与转存（现有设计已满足） |
| 4 | 输入图片 >5 张要另计成本，我们无「张数」计费维度 | 隐形成本 | P0 限制 ≤5 张，或售价系数覆盖 |
| 5 | 2K 出片耗时未知（现有 25 分钟轮询预算 vs 30 分钟执行超时） | 超时会走 deadline 收尾路径 | 首次实测后决定是否抬高预算 |
| 6 | `content.url` 域名是否被我们服务器可达（转存依赖） | 转存失败会把片子留在上游 | 首次实测验证；失败已有明显日志与人工兜底 |
| 7 | H3 生成接口**无 `watermark` / `generate_audio`** | 静音与水印需求无参数可依 | 静音走转码；水印仅再生成支持 |
| 8 | 网关是否暴露「列表任务」接口未确认 | 只影响自动对账（P2+） | 实测一次即可 |
| 9 | `MiniMax-H3-Max` 未在网关上架（480P/768P、便宜档） | 少一个低价档 | 需要时找网关方上架 |
| 10 | 上游英文报错直出给用户（如 `binding: expr_path=content…`） | 用户读不懂 | 新增一层 H3 中文错误文案映射 |

---

## 附录 A：可复制的探针/调用片段

```bash
BASE=https://ai.ctaigw.cn/v1
TOKEN=${MINIMAX_TOKEN:?需要从网关方获取，勿写进仓库}

# 创建（768P / 5 秒）
curl -sS -X POST "$BASE/video_generation" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"minimax-h3","content":[{"type":"text","text":"史诗级太空歌剧院线预告：女舰长独自站在巨大观景窗前…"}],"resolution":"768P","duration":5,"ratio":"16:9"}'

# 查询（三类任务共用同一路径）
curl -sS "$BASE/query/video_generation/<task_id>" -H "Authorization: Bearer $TOKEN"

# 取消 / 删除
curl -sS -X DELETE "$BASE/video_generation/<task_id>" -H "Authorization: Bearer $TOKEN"

# Context-IR（拿结构化 prompt）
curl -sS -X POST "$BASE/h3_context_ir" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"minimax-h3","content":[{"type":"text","text":"…"}],"duration":5,"ratio":"16:9"}'

# 再生成（base_video 形态；text 必须是当初 IR 之后的最终 prompt）
curl -sS -X POST "$BASE/video_regeneration" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"minimax-h3","content":[{"type":"text","text":"<IR 最终 prompt>"},{"type":"video_url","video_url":{"url":"https://…/768p.mp4"},"role":"base_video"}],"resolution":"2K"}'
```

## 附录 B：资料出处

- 官方 OpenAPI 规格：`https://platform.minimax.io/docs/api-reference/video/generation/api/v2-video-generation.json`
- 创建视频生成：`https://platform.minimax.io/docs/api-reference/video-generation-v2-create.md`
- H3-Context-IR：`https://platform.minimax.io/docs/api-reference/video-generation-v2-h3-context-ir.md`
- 视频再生成：`https://platform.minimax.io/docs/api-reference/video-generation-v2-regeneration.md`
- 查询/列表/取消：`video-generation-v2-query.md` / `-list.md` / `-delete.md`
- 定价（CN 刊例）：`https://platform.minimaxi.com/docs/guides/pricing-paygo.md`
- 模型系统说明与三件套定义：`https://github.com/MiniMax-AI/MiniMax-H3`（README）+ `https://www.minimax.io/blog/minimax-h3`
- 开源生态与许可 FAQ：`https://design.minimaxi.com/h3`
- 可运行官方脚本：`https://github.com/MiniMax-AI/MiniMax-H3/tree/main/scripts/readme`