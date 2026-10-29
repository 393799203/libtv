# AI 助手：「智能问答 + 对话式操作」方案

> v1.1 / 2026-10-29 / 面向 libtv（漫蛙AI）
> **取代** v0.3《新手引导-对话式首作品链路方案》——原「两阶段漏斗 + 付费枢纽 + 引导免单」的设计全部作废。
> v1.1：补 §8 M0 实施记录（含真实渠道实测数据、已知缺口、华数渠道阻塞项）。M0 代码已提交，
> **尚未部署**（等人工过代码）。

---

## 0. 结论先行

1. **定位**：工作台里一个**能用自然语言操作产品的 AI 助手**。用户说「帮我新建一个文本节点」，它就真的在画布上建一个；问「这张图为什么生成失败」，它解释。新手引导**不再是独立系统**，而是这个助手的「首次使用形态」。
2. **成本模型（已确认）**：**对话本身不扣用户积分**（平台承担 LLM 调用成本）；**凡是触发真实生成的操作，照常扣用户自己的积分**。因此原方案里的**引导免单、首充礼包枢纽、两阶段漏斗全部不需要了**——我此前纠结的「新用户 0 积分阻断引导」问题也随之消失：对话免费，生成走原有计费。
3. **⚠️ 一个必须接受的技术后果**：**「纯脚本状态机」在这个定位下不够用了**。要听懂「帮我把这两个节点连起来」这类自由表达，必须做**意图识别**（原方案的 A 档 → C 档）。
4. **但安全边界不变**：LLM 只输出**白名单内的命令**，**执行权始终在前端**。LLM 既不能直接操作画布，也不能直接扣费。
5. **花费分界**：**免费操作直接执行**（建节点、连线、改参数、删除、打组、撤销…）；**花钱操作必须二次确认**（弹 `ConfirmCard` 显示预估积分与当前余额），确认后才执行。

---

## 1. 现状盘点（浓缩版）

> 完整证据（文件:行号）见已作废的 v0.3 文档，此处只留设计必需的部分。

### 1.1 可操作的画布能力（`web/src/stores/canvasStore.ts`，1070 行）

已暴露且支持非 React 调用（`useCanvasStore.getState()`）：`addNode:618` / `addNodesAndEdges:634` / `createMediaNodeAt:609` / `connectNodes:558` / `updateNodeData:780` / `removeNodes:652` / `groupSelectedNodes:681` / `ungroupNode:718` / `undo:1012` / `redo:1040` / `exportCanvas:995`。节点由 `utils/nodeFactory.ts:81 createNode(type, position, overrides?)` 构造。

**这正是「AI 帮你操作」能落地的前提——不是做个假 demo，而是真操作。**

### 1.2 能力积木与真实价格（线上 `model_prices`）

节点类型：`text | image | video | audio | script | previz | enhance | group`

| 能力 | 代表模型 | 积分 |
|---|---|---|
| 文本/故事 | `deepseek-v4-flash` | 15 |
| 剧本分镜 | `doubao-seed-2.0-lite` 等 | 30~100 |
| 文生图 | `wan2.7-image` / `doubao-seedream-4.0` | 26 |
| 图生视频 480p / 720p / 1080p | `wan3.0-video` / `seedance-2.0` | 40~65 / 78~130 / 156~260 |
| 语音 TTS | `qwen3-tts-instruct-flash` | 26 |

### 1.3 可直接复用的基建

| 基建 | 位置 | 用途 |
|---|---|---|
| 触发执行 | `utils/runNodes.ts:41` `startNodeExecutions(projectId, nodeIds)` | **必须用它**（见 §3.7） |
| 空输入自检 | `hooks/useNodeGeneration.ts:54` `checkInputBeforeGenerate` | 防「点了没反应」 |
| 进度订阅 | `useExecutionStore` + `hooks/useExecutionStream.ts` | 助手叙述进度，**无需新建 SSE** |
| 文本流 | 无（现有 SSE 只服务执行流） | 若要打字机效果需新增 |
| LLM 调用范式 | `server/internal/handler/prompt_handler.go:108` + `llm.Client` / `WithUsageRecorder` / `WithChannel` | 照这个模子做，但**不挂 `Billing`** |
| 限流 | `middleware.RateLimit`（`config.yaml` `ratelimit.per_minute: 10`） | 给助手单独配一档 |
| 节点知识源 | `plugins/registry.ts:60 list()` / `:65 validateConnection()` | 喂给 LLM + 纠错 |
| 全局挂载点 | `components/GlobalComponents.tsx:16` | 助手面板挂这里 |
| 层级 / 样式 | `utils/zLayers.ts:26`（新增 `guide: 1100`）/ `dark-theme.css` 的 `--dv-*`、`tech-*` | 外观一致 |

### 1.4 约束

| # | 约束 | 影响 |
|---|---|---|
| 1 | **执行只能单节点**（`workflowApi.ts:26-41`：`startNodeId` 必填，全图执行已下线） | 多节点要逐次触发 |
| 2 | LLM 网关**无流式、无 function calling** | 用「结构化 JSON 输出 + 白名单校验」替代 |
| 3 | 前端**没有**消息气泡/打字机组件 | 对话 UI 要新写 |
| 4 | 前端 `strict:false`、`build` 不含 `tsc` | 新模块建议自带单测 |
| 5 | 线上执行失败率 11%（894 成功 / 98 失败） | 助手要能解释失败并给重试 |

### 1.5 与已有两份 skill 文档的关系（术语澄清 + 定位依据）

`docs/` 下已有两份 2026-10-22 的设计文档，**不要与本方案混淆**：

| 文档 | 它说的 "skill" 是什么 | 与本方案的关系 |
|---|---|---|
| [skill-integration-design.md](./skill-integration-design.md) | 新增一种 **`skill` 节点类型**（manifest 驱动的黑盒漫剧生成器）——**尚未实现** | 那是**能力层**（画布能做什么）；本方案是**操作层**（用对话去驱动画布）。两者正交；将来 `skill` 节点落地后，助手可以直接创建它 |
| [canvas-skill-research.md](./canvas-skill-research.md) | 同上，并对比了小云雀 | 本方案的**定位依据**（见下） |

> ⚠️ **术语约定**：本方案的「**命令 / command**」= 助手能执行的一个操作（`create_node` 等），与 `skill` 节点**不是一回事**。代码里新包请用 `assistant` / `command`，**不要用 `skill`**。

**定位依据**：`canvas-skill-research.md` 的结论是——libtv 是「**确定性工作流画布**」（节点显式、执行可预测），小云雀是「**Agent 对话驱动的创作画布**」，并建议「把『**节点执行**』与『**Agent 编排**』两层结合」。本方案正是这层 **Agent 编排**：底层保留确定的执行引擎，上层加一个能理解自然语言、**直接操作真实画布**的助手。

该文档把 Agent 编排列为 Phase 2，理由是「依赖 LLM 编排稳定性，建议放在确定性节点跑通之后」——**现在 8 类节点 + 执行引擎 + SSE 已经跑通，时机到了**。

> 另注：`skill-integration-design.md:19` 描述的引擎流程（`TopologicalSort` → 全图调度）**已经过时**。当前实现是**单节点执行**（`startNodeId` 必填，全图执行已下线，见 §1.4）。引用那份文档时留意这一点。

---

## 2. 产品设计

### 2.1 定位与能力边界

**是**：一个能**问答 + 代操作**的工作台助手（人设沿用「蛙导」）。

**不是**：
- 不是独立的新手引导系统（引导是它的首次使用形态）；
- 不是 Agent——**不能自主规划多步任务**，只执行用户明确说出的、白名单内的操作；
- 不能替用户花钱（花钱必须确认）。

### 2.2 能力清单（v1 白名单，15 项）

| # | 命令 | 用户会怎么说 | 真实调用 | 花钱 |
|---|---|---|---|---|
| 1 | `create_node` | 「帮我新建一个文本节点」 | `createNode` + `addNode` | 否 |
| 2 | `connect_nodes` | 「把这张图和视频连起来」 | `connectNodes` | 否 |
| 3 | `update_node` | 「提示词改成黄昏」 | `updateNodeData` | 否 |
| 4 | `remove_nodes` | 「把没用那个删了」 | `removeNodes` | 否 |
| 5 | `group_nodes` | 「这三个打个组」 | `groupSelectedNodes:681` | 否 |
| 6 | `ungroup_nodes` | 「解开这个组」 | `ungroupNode:718` | 否 |
| 7 | `select_nodes` | 「选中第一个镜头」 | `onNodesChange(select)` | 否 |
| 8 | `focus_node` | 「带我去看那个视频节点」 | `setCenter`（经 Bridge，§3.1） | 否 |
| 9 | `undo` / `redo` | 「撤销」 | `undo:1012` / `redo:1040` | 否 |
| 10 | `save_canvas` | 「保存一下」 | `persistCanvasBeforeRun` | 否 |
| 11 | `run_nodes` | 「把这张图生成视频」 | `startNodeExecutions` | **是** |
| 12 | `split_image` | 「切成九宫格」 | `imageops` splitPreset | **是** |
| 13 | `upscale_image` | 「高清一点」 | `imageops` quality | **是** |
| 14 | `generate_view` | 「生成三视图」 | `imageops` view（`VIEW_PRESETS`） | **是** |
| 15 | `open_points_mall` | 「积分不够了怎么办」 | `PointsMallModal` | 否 |

**纯答疑（无命令）**：解释节点/参数含义、说明失败原因、查余额与生成历史、讲清楚「做一条片子要几步」。

### 2.3 三种用法

**① 新手指引（首次使用形态）**
首次进工作台时，助手主动打招呼 + 给 4 个**可点的建议问法**（点一下等于发消息）：

> 「我能帮你直接操作画布。试试这样说：」
> · 帮我新建一个文本节点 · 这些节点该怎么连 · 做一条 5 秒短片要几步 · 这张图为什么失败了

用户点第一条 → 画布上**真的出现**一个文本节点 → 他立刻理解了这个助手能干什么。**这就是引导，不需要另做一套流程**，也不需要用户花一分钱。

**② 日常操作提效**（主力场景）
老用户直接使唤：「帮我把这个节点提示词改成赛博朋克」「把这两个连起来」「跑一下」。

**③ 答疑**
「视频节点和图片节点有什么区别」「积分怎么扣的」「为什么这张图没过审」。

### 2.4 免费 vs 花钱的分界（核心交互规则）

| 类型 | 例子 | 行为 |
|---|---|---|
| **免费操作** | 建节点、连线、改参数、删除、打组、选中、聚焦、撤销、保存 | **直接执行**，执行后给一句结果 + 可撤销提示 |
| **花钱操作** | 触发执行、切宫格、高清化、生成三视图 | **先弹 `ConfirmCard`**：说明要做什么、预估多少积分、当前余额，确认后才执行 |
| **纯答疑** | 解释、查状态 | 只回话，不动画布 |

规则理由：免费操作零风险且**可撤销**（走 `canvasStore`，天然进撤销栈）；花钱操作**不可撤销**且动用户余额，必须让用户点头。

**余额不足**（线上 `Billing` 中间件返回 `402 / code 4002`）：助手把它翻译成人话——「这一步要 52 积分，你现在有 0。要看看积分超市吗？」并给出 `open_points_mall` 按钮。这就是**自然转化点**，不需要为它设计免单或礼包枢纽。

### 2.5 交互细则

- **可撤销**：免费操作执行后，气泡里带「撤销」按钮（复用 `undo`）。
- **可接管**：用户手动改过的节点标记 `managedBy:'user'`，助手之后只读不写。
- **不猜**：指代不明（「把那个连起来」但有多个候选）时**反问一句**，不要赌。
- **不打扰**：老用户不自动弹；只在首次进入时问候一次，之后靠常驻入口。
- **移动端**：对话栏变全屏抽屉。
- **面板位置**：右下角气泡 → 展开为右侧 360px 对话栏（左侧边缘已被资产库把手占用，右侧是随节点锚定的 PromptPanel，只有右下角空闲）。

---

## 3. 技术方案

### 3.1 架构

```
┌──────────────────────── 前端（执行主体）─────────────────────────┐
│  AssistantPanel（挂 GlobalComponents，跨路由常驻）                │
│      │                                                            │
│      ├── assistantStore（zustand：messages / open / pending）     │
│      ├── CommandExecutor（白名单校验 → 调 store action）          │
│      │      ├── nodeFactory.createNode + canvasStore.*            │
│      │      ├── utils/runNodes.startNodeExecutions（花钱）        │
│      │      └── imageops / AddShowDialog / PointsMallModal        │
│      ├── CanvasBridge（挂 WorkspacePage 的 ReactFlowProvider 内） │
│      │      └── 注册 useReactFlow() → setCenter / fitView         │
│      └── assistantApi ──POST /api/assistant/chat──┐               │
└───────────────────────────────────────────────────┼───────────────┘
                                                    │
┌──────────────── 后端（只做意图解析）───────────────▼───────────────┐
│  /api/assistant/chat → LLM 意图识别 → { reply, commands[] }       │
│  复用 llm.Client；**不挂 Billing**（对话不扣费）；单独限流        │
└───────────────────────────────────────────────────────────────────┘
```

**为什么执行放前端**：画布状态就在前端 store，操作路径已经被验证过（`useNodeGeneration` / `runNodes` / `useExecutionStream` 都是非 React 调用 `getState()` 的模式）；后端要执行就得把每个操作 API 化，重复且脆弱。后端只保留**必须保密的部分**（LLM API key + 提示词）。

### 3.2 意图识别协议（**本方案最关键的一环**）

现有 LLM 网关不支持 function calling，因此用**结构化 JSON 输出**替代——项目里已有先例（`GenerateScript` 就是这么拿结构化分镜的，且有 `cleanJSONMarkdown`（`script.go:196`）做容错）。

**请求**

```jsonc
POST /api/assistant/chat
{
  "message": "帮我新建一个文本节点",
  "context": {
    "selectedIds": ["n_a1b2"],
    "credits": 3000,
    "nodes": [                                   // 精简摘要，不是完整画布！
      { "id": "n_a1b2", "type": "image", "label": "首帧图", "status": "success" }
    ]
  },
  "recent": [                                    // 最近 N 轮，裁剪过的
    { "role": "user", "content": "我想做一只猫" },
    { "role": "assistant", "content": "好，我先写个故事" }
  ]
}
```

**响应**

```jsonc
{
  "reply": "好，我在画布上放了一个文本节点。",
  "commands": [
    { "command": "create_node", "args": { "nodeType": "text", "label": "文本" } }
  ],
  "needConfirm": false
}
```

花钱时：

```jsonc
{
  "reply": "这一步会把这张图生成 5 秒视频，预计 52 积分，你现在有 3000。要开始吗？",
  "commands": [
    { "command": "run_nodes", "args": { "nodeIds": ["n_a1b2"], "estimateCredits": 52 } }
  ],
  "needConfirm": true
}
```

**前端必须做的校验（不可省）**

1. `command` 必须在白名单里，否则丢弃并回一句「这个我还不会」；
2. `args` 按每个命令的 schema 校验类型与取值（`nodeType` 必须属于那 8 种等）；
3. `nodeIds` 必须**真实存在于当前画布**（防止 LLM 编 id）；
4. `needConfirm` 或该命令被标记为花钱 → **强制走确认**，不信 LLM 的判断。

### 3.3 上下文构造（容易踩坑）

- **只发摘要**：节点 id / 类型 / 标签 / 状态。**绝不把完整画布 JSON 发给 LLM**——里面有大量 URL 甚至 base64，既贵又没必要，还有隐私问题。
- **指代解析靠 id**：把 `selectedIds` 和节点摘要一起给，让模型把「这个/那个」映射成 id；映射不了就反问。
- **历史裁剪**：只带最近 6~8 轮，且截断超长内容。
- **知识注入**：用 `plugins/registry.ts:60 list()` 生成「节点类型 / 能接什么上游 / 产出什么」的系统提示词，用 `:65 validateConnection()` 在用户乱连时给纠错话术。

### 3.4 接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/assistant/chat` | 意图识别。**不挂 `Billing`**，挂独立限流 |
| GET | `/api/assistant/hint` | 可选：返回建议问法（也可前端写死） |

实现照 `prompt_handler.go:108` 的模子：注入 `llm.Client`、用 `llm.WithUsageRecorder(ctx)` / `llm.WithChannel(ctx, channel)`，只是**不加计费**。新增包建议放 `server/internal/assistant/`（**不要叫 `skill`**，那个名字已被 §1.5 提到的节点类型占用）。

### 3.5 数据模型

**新增一张轻量日志表**（强烈建议，这是持续改进意图识别的唯一依据）：

```go
// AssistantLog 助手交互日志（用于评估意图识别质量，非业务依赖）
type AssistantLog struct {
    ID         int64          `gorm:"primaryKey"`
    UserID     string         `gorm:"size:36;index"`
    Message    string         `gorm:"type:text"`      // 用户原话
    Reply      string         `gorm:"type:text"`      // 助手回复
    Commands   datatypes.JSON `gorm:"type:jsonb"`     // 解析出的命令
    Executed   bool           // 是否真的执行了
    UndoneSoon bool           // 执行后 30s 内被撤销（**最强负反馈信号**）
    CreatedAt  time.Time
}
```

`UndoneSoon` 尤其值钱：**用户让 AI 做完立刻撤销 = AI 做错了**，这是最直接的坏例样本。

### 3.6 安全边界（五道）

1. **白名单**：命令集合固定 15 项，模型无法扩展；
2. **参数校验**：每个命令有 schema，非法参数丢弃；
3. **ID 存在性校验**：`nodeIds` 必须在当前画布快照里；
4. **扣费不经模型**：花钱动作永远由**前端确认后**调用真实的 `startNodeExecutions`，走原有 `Billing`（`402` 照样会拦）；
5. **可撤销**：免费操作全走 `canvasStore`，天然进撤销栈（上限 50 条）。

### 3.7 与执行引擎对接（**原踩坑点全部保留**）

1. **执行是单节点的**：`workflowApi.execute(projectId, startNodeId)` 的 `startNodeId` 必填，全图执行已下线。多节点要**逐次触发**。
2. **必须用 `utils/runNodes.ts:41 startNodeExecutions()`**，它封装了「存画布 → 本地置 running → 调 execute → `addActiveStream`」四步。**漏掉第 4 步的后果**：节点永远停在「正在生成中」，没有进度也没有收口（`runNodes.ts` 注释里写得很清楚）。
3. **补空输入自检**：`useNodeGeneration.ts:54 checkInputBeforeGenerate` 目前只在 hook 路径，建议抽成导出复用，避免助手造出「点了没反应」的空转。
4. **进度不用新建 SSE**：订阅已常驻在 `WorkspacePage.tsx:225-227`，直接读 `useExecutionStore` 的 `activeStreams` / `nodeErrors`。
5. **一个作品是多次执行**：图一次、视频一次、音频一次，助手要能串起来叙述。
6. **失败与退费**：`failed` 时给「重试 / 换模型」，并说明积分已退回（线上失败率 11%，这是高频场景）。

### 3.8 成本控制（对话免费，但平台不是零成本）

「对话不扣用户积分」意味着 **LLM token 成本由平台承担**，必须设围栏：

| 措施 | 具体做法 |
|---|---|
| 用小模型 | 意图识别用 `deepseek-v4-flash` 级，别用 pro/max |
| 控上下文 | 历史 ≤ 8 轮 + 节点摘要，**绝不发完整画布** |
| 控输出 | `max_tokens` 收紧（回复本来就该 ≤ 2 句） |
| 限频率 | 新增 `assistant` 限流档（如 20 条/分钟），复用 `middleware.RateLimit` |
| 省调用 | 纯前端能答的（如「怎么保存」）不必调 LLM；建议问法点击可走预置话术 |

### 3.9 前端落地清单

| 新增 | 位置 | 说明 |
|---|---|---|
| `assistantStore.ts` | `src/stores/` | `messages / open / pending / rfInstance` |
| `AssistantPanel.tsx` | `src/components/assistant/` | 挂到 `GlobalComponents.tsx:16` |
| `CanvasBridge.tsx` | `src/components/assistant/` | 渲染在 `WorkspacePage` 的 `ReactFlowProvider` 内，注册 `useReactFlow()` |
| `commands/*.ts` | `src/components/assistant/commands/` | 15 个命令各一个纯函数，便于测试 |
| `assistantApi` | `src/services/` | 注意 `api.ts` 响应拦截器**已解包 `data`**，别照抄 `ApiResponse<T>` 的写法 |
| z-index | `utils/zLayers.ts:26` | 新增 `guide: 1100` |
| 外观 | — | `var(--dv-surface-2/--dv-text-2/--dv-border-1)` + `.tech-skeleton`；消息气泡/打字机需新写 |

---

## 4. 路线图

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 打通一格** | `/api/assistant/chat` 意图识别 + 白名单执行框架，**只做 3 个命令**：`create_node` / `connect_nodes` / `update_node` | 说「帮我新建一个文本节点」，画布上真的出现节点 |
| **M1 花钱类 + 确认** | `run_nodes` + `ConfirmCard` + `402` 友好文案 | 说「把这张图生成视频」→ 确认 → 真的跑起来并扣费 |
| **M2 答疑** | 解释节点/参数、失败原因、余额、生成历史 | 「这张图为什么失败」能给出真实原因 |
| **M3 指代与上下文** | 「这个」「刚才那个」映射到 id；反问消歧 | 多节点场景下指代准确率达标 |
| **M4 引导形态 + 打磨** | 首次问候 + 建议问法 + 移动端 + 埋点 | 新用户点第一条建议后能理解助手能干什么 |

---

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| **LLM 乱调工具 / 编 id** | 白名单 + schema 校验 + id 存在性校验（§3.6） |
| **意图识别不准**（最大体验风险） | `UndoneSoon` 埋点做坏例回流；M0 只做 3 个命令，把准确率打磨好再扩 |
| **误扣费** | 花钱必确认；免费操作可撤销；`402` 由后端兜底 |
| 平台 LLM 成本失控 | §3.8 五条围栏 |
| 上下文过大导致慢/贵 | 只发节点摘要，绝不发完整画布 |
| 用户以为 AI 能自主干活 | 定位写清楚是「代操作」不是 Agent；多说一句「我只会做这些」 |
| 执行卡住（漏订阅 SSE） | 强制走 `startNodeExecutions`，code review 盯 `addActiveStream` |

---

## 6. 度量

**北极星**：助手命令的**采纳率**（解析出的命令被真正执行的比例）与**日活使用率**。

| 类型 | 指标 |
|---|---|
| 质量 | 命令采纳率、意图识别准确率、**执行后 30s 内撤销率（反指标，越高说明 AI 越蠢）**、反问率 |
| 使用 | 会话数/日、人均对话轮数、命令分布（哪几个命令最常用） |
| 商业 | **助手触发执行带来的生成次数与积分消耗**（这是它除了答疑之外的真实价值）、生成转化率 |
| 成本 | 平台 LLM 成本/人、平均 token/次 |

---

## 7. 决策记录

### 7.1 已确认

| # | 决策 | 结论 |
|---|---|---|
| 1 | **功能定位** | 智能问答 + **对话式操作产品**（如「帮我新建一个文本节点」） |
| 2 | **成本模型** | **对话不扣用户积分**（平台承担 LLM 调用）；**触发生成照常扣用户积分**；**不做免单、不做首充礼包枢纽、不做两阶段漏斗** |
| 3 | **引导形态** | 不作为独立系统；由助手的「首次问候 + 建议问法」承担 |
| 4 | **对话能力档位** | ⚠️ 由「纯脚本状态机」**改为「LLM 意图识别 + 白名单命令 + 前端执行」**（原 A 档 → C 档）——这是新定位的必然要求 |
| 5 | **引导位置** | 工作台内常驻悬浮（右下角气泡 → 右侧对话栏） |
| 6 | **存量用户** | 开放入口供主动提问，不自动弹出打扰 |

### 7.2 原待确认项（2026-10-29 已全部决定）

1. **M0 只做 3 个命令** —— 采纳。先窄后宽，把意图识别准确率打磨出来再扩白名单。
2. **是否做流式** —— M0 不做。用「思考中…」占位（实测响应 0.8–3.3s，占位足够）。
3. **交互日志是否落库** —— 落库。建 `assistant_logs` 表（§3.5）。

---

## 8. M0 实施记录（2026-10-29）

### 8.1 交付物

| 位置 | 内容 |
|---|---|
| `server/internal/assistant/` | 提示词生成、意图解析、白名单与参数校验、日志落库（`assistant.go` / `commands.go` / `prompt.go`） |
| `server/internal/handler/assistant_handler.go` | `POST /api/assistant/chat` |
| `server/internal/model/assistant_log.go` | `assistant_logs` 表（含 `undone_soon`） |
| `server/internal/llm/model_manager.go` | 新增 `DefaultLLMModelID(channel)`（读 models.yaml 的 `default: true`） |
| `server/internal/middleware/ratelimit.go` | 新增 `RateLimitScoped`，助手用独立 scope `assistant` |
| `web/src/components/assistant/` | `AssistantPanel` / `CanvasBridge` / `commands/*`（3 条命令） |
| `web/src/stores/assistantStore.ts` | 面板状态 + 命令编排 + 上下文组装 |
| `web/src/services/assistantApi.ts` | 接口封装 |

### 8.2 与方案的两处偏差（都是实现中发现后改的）

1. **限流必须分 scope**。`middleware.RateLimit` 的 Redis 键里只有 `userID`，全站共用一份额度 ——
   直接复用会让「连着问 10 句话」把每分钟的**生成**配额吃光。故新增 `RateLimitScoped`。
2. **命令执行后必须回读校验**。`canvasStore` 的 `addNode` / `connectNodes` / `updateNodeData`
   在 `projectId` 为空或 `isLoading` 时都是**静默早退**。不回读就会出现
   「助手说建好了，画布上什么都没有」——比直接报错严重得多。三条命令都加了回读断言。

### 8.3 实测验证（真实渠道 + 真实模型）

- **离线单测**：7 个测试函数 / 25 个子用例（`assistant_test.go`）。本仓库首份 Go 测试。
  覆盖围栏解析、参数越界、`group` 不开放、自连、`update_node` 空改动、提示词清单完整性。
- **联网集成测试**（`ASSISTANT_LIVE=1`，走真实 `Service.Chat` → 真实渠道默认模型）：
  7 个中文口语用例**全部通过**，含 2 个关键负例（问天气、问积分）确认**不编造命令**。
- 实测数据（dianxin / `deepseek-v4.1-flash`）：**延迟 0.8–3.3s / 约 700–870 tokens 每次**。
  据此可估算平台成本：按每次约 800 tokens、日均若 1000 次对话，量级很小，但要进 §6 的成本口径。

### 8.4 已知缺口（明确未做，不是遗漏）

1. **`UndoneSoon` 目前采集不到**。表结构、`logId` 回传都已就绪，但前端还没有上报
   「用户撤销了助手的操作」的回执接口 —— 也就是说 §6 里最有价值的那个反指标现在还是空的。
   这是 M1 的第一件事（代价很小：一个回执接口）。
2. **助手答不出具体价格**。它手里没有价目表，提示词里明确要求**不许编数字**，
   只会说明「对话和建节点不花钱，让 AI 生成才按模型收费，价格看界面」。
   要报出真实数字需要把 `model_prices` 注入上下文（M2，注意别让价格缓存过期后说错账）。
3. **华数渠道的文本模型当前不可用**（见 §8.5）。
4. 无流式输出；无移动端专门适配（面板宽度已用 `min(360px, 100vw-32px)` 兜住小屏）。

### 8.5 ⚠️ 阻塞项：华数渠道 LLM token 已耗尽

核查线上 `/opt/libtv/server/configs/config.yaml`（与本地 **md5 一致**），
华数渠道的 token 已被上游拒绝：

```
该令牌额度已用尽 TokenStatusExhausted[sk-jHY***pC4]
```

助手按**用户所属渠道**解析模型，因此华数渠道的用户会看到「助手暂时不可用」。

影响面：线上 44 个用户里 **42 个在 dianxin（正常）**、**2 个在 wasu（受影响）**。
这 2 个用户的**文本生成 / 剧本功能本来就已在报错**，不是助手引入的问题。

**未做处理**（2026-10-29 决定：先记录，不动配置）。可选方案：
① 给华数 token 续费；② 把这 2 个用户的渠道切到 dianxin；
③ 让助手在华数失败时回退到电信 —— **不建议**：跨渠道用电信的 key 处理华数用户的请求，
涉及渠道约定与结算口径，不属于技术问题。

