# libtv 与 小云雀 的 Skill 集成画布机制调研

> 版本：v0.1
> 调研对象：
> - **libtv**（本仓库）：本地代码级调研（web/ + server/）
> - **小云雀**（https://www.xiaoyunque.com / xyq.jianying.com）：字节跳动旗下 AI 内容创作 Agent 平台，
>   基于官网产品手册调研（无公开 API 文档，结论来自产品手册与页面结构）

---

## 0. 结论摘要

| 维度 | libtv | 小云雀 |
|------|-------|--------|
| 产品定位 | 剧本→分镜→生图→生视频→成片的 **工作流画布** | 剧本/短剧/漫剧→视频的 **内容创作 Agent 平台** |
| "skill" 的含义 | 尚未实现；设计为**可编排的黑盒节点**（manifest 驱动） | **Agent 内建技能**（如营销 Skill：一键出海/批量生成；短剧 Agent：剧本助手/重制转绘/3D 导演台/智能预演） |
| 画布中 skill 的形态 | 计划新增 `skill` 节点类型（拖拽、连线、参数表单、执行、SSE 回写） | 技能是 Agent 的入口卡片/下拉选项；**产物自动落画布**，画布只做资产组织 |
| 画布与执行的关系 | 画布即工作流（节点=执行单元，连线=数据流 DAG，后端拓扑调度执行） | 画布是**资产组织层 + 引用上下文层**；执行由 Agent 对话驱动 |
| 连线语义 | 数据流（上游输出→下游输入） | **引用/参考上下文**（左侧=参考输入，右侧=参考输出） |
| 资产沉淀 | 节点产物写回节点 data + 画布 JSON 持久化 | 资产库（角色/场景/道具/素材）与画布全链路同步 |
| 开放程度 | 自研，可完全按需改造 | 闭源 SaaS，只能借鉴产品设计 |

**核心差异**：libtv 是"**确定性工作流画布**"（节点显式、执行可预测、适合工程化编排）；
小云雀是"**Agent 对话驱动的创作画布**"（生成靠 Agent 理解指令，画布负责可视化组织与引用）。
两者不是同一代产品模型——libtv 的 skill 集成若想做到小云雀的体验，需要把"节点执行"与"Agent 编排"两层结合。

---

## 1. libtv 的 Skill 集成画布（代码级）

### 1.1 现状：无 skill，但有完整扩展机制

节点类型枚举 `web/src/types/canvas.ts`：

```ts
export type NodeType = 'text' | 'image' | 'video' | 'audio' | 'script' | 'previz';
```

执行链路（已跑通，skill 可直接挂入）：

```
Canvas JSON → engine.Parse → engine.Validate → engine.TopologicalSort
  → ExecutorRegistry 按 node.type 分发（executor.go 的 NodeExecutor 接口）
  → 分层并行执行 + SSE 事件（node_started/progress/completed/failed）
  → 前端 useExecutionStream 回写节点 data
  → persistNodeOutputs 持久化到画布 JSON
```

### 1.2 设计方案（docs/skill-integration-design.md）

新增通用 `skill` 节点类型，manifest 驱动：

- **Skill Manifest**（前后端共用，JSON）：`id/name/inputs(参数schema)/acceptsUpstream(连线约束)/outputs(产物字段)/runner(exec|http|docker)/billing`
- **前端**：`SkillNode.tsx`（BaseNode 外壳 + 技能下拉 + 动态表单 + 产物预览）；
  注册进 `NodeSelectPopup` / `EMPTY_GUIDE_TYPES` / `nodeTypes`
- **后端**：新增 `server/internal/skill/`（manifest/registry/runner）；
  `SkillExecutor` 注册进 `NewDefaultRegistry`，产物经 `FileUploadService` 上传、`BillingService` 计费
- **数据流**：`ExecutionContext.GetUpstreamSources/GetNodeData` 读上游 → payload（stdin JSON，防注入）→ runner → 产物 URL → `node_completed` 回写

### 1.3 关键取舍（对比小云雀后补充）

libtv 的 skill 是**黑盒节点**：连上线、填参数、执行、拿产物。这解决了"接入开源漫剧工具"的工程问题，
但和小云雀相比缺少三层能力：

1. **无对话驱动**——用户必须显式连线+填参，无法"一句话让 Agent 决定用什么技能"
2. **无资产库**——产物只落在节点上，没有"角色/场景/道具"这类跨节点、跨项目的资产沉淀
3. **无引用语义的"@ "机制**——libtv 有 mentions（`@` 引用上游），但连线即数据流，没有小云雀那种"引用某节点图作为参考图"的灵活上下文

---

## 2. 小云雀的 Skill 集成画布（产品手册级）

### 2.1 产品定位

> "小云雀 Web，你的网页版内容创作 Agent。只需一句指令，小云雀主动思考、智能执行，快速生成爆款视频与图片。"
> "行业首个搭载 Seedance 2.5 的 **短剧 & 漫剧 Agent**，输入剧本即可输出完整剧集。"

- 主体：字节跳动旗下创意 Agent 平台（深圳市脸萌科技有限公司）
- 模型生态：视频 Seedance 2.5/2.0、图片 Seedream 5.0 Pro 等 10+、音频 Seed Audio
- Agent 类型：
  - **短剧 & 漫剧 Agent**（剧本助手、重制转绘、故事场景专属无限画布、3D 导演台、智能预演）
  - **创作 Agent**（对话式创作，Agent 模式/沉浸式短片/图片创作/画布模式）
  - **营销 Agent**（Showcase、创意库、Hook 库、风格库、画布、营销 Skill：一键出海/批量生成）

### 2.2 画布机制（两类画布 + 营销画布）

#### A. 短剧 Agent 画布 =「资产创作画布」
- **用途**：集中整理和生成**角色、场景**及相关参考素材；剧本解析后自动建好角色/场景节点关系
- **节点**：基础节点（文本/图片/视频/音频）+ **角色节点 / 场景节点**（富含字段：文本音色、参考音频、三视图、打光、镜头控制、全景图）
- **连线 = 引用上下文关系**："引用角色/场景节点，则将其节点图作为参考图"
- **资产库联动**：画布节点可存为道具/素材进资产库；资产库内容全局联动修改，"一处更新全链路自动生效"；故事板分镜页可调用
- **批量**：列表视图全选批量生成 / 画布整组执行
- **创建节点**：左侧菜单栏 / 画布空白右键 / 已有节点左右侧新建（引用关系不同）
- **左下角菜单栏**：重置 / 整理画布 / 只展示角色场景 / 小地图 / 网格吸附 / 缩放
- **快捷键**：cmd/ctrl 系列、整理画布 shift+option+F

#### B. 创作 Agent 画布 =「对话 + 画布协作」
- **核心亮点**："对话：支持 `@` 引用全画布的资产作为参考，也可通过对话直接创作视频图片，支持多个会话并行；画布：自由发挥建立自己的创作工作流，支持精细编辑"
- **进入方式**：Agent 模式输入框开画布开关 / 沉浸式短片模式 / 「自由画布」入口
- **初次进入**：左侧画布 + 右侧 Agent 对话；对话生成结果**自动添加到画布**（创意设计→关键参考图→分镜视频→合成成片）
- **节点编辑工具**：全景图、提示词反解析、智能打光、镜头调节、涂鸦画笔、智能运镜库（33 种预设运镜）、拼图/拼视频、抽卡记录（同提示词多次生成折叠成组）、打组批量管理
- **连线**："文本节点向右连接至视频/图片节点 = 引用文本作为提示词生成；图片向右连接视频节点 = 引用图片作为参考生成"
- **分享**：画布和对话历史分别生成分享链接

#### C. 营销 Agent 画布
- 生成的图片/视频**直接进入已有画布**，在画布中"管理、引用、编辑、组合与导出"
- **营销 Skill**（重点！）：技能是**下拉框/推荐技能入口**，例如：
  - **一键出海**：上传视频 → 选地区/语言 → 解析画面/口播/人物形象 → 本地化生成
  - **批量生成**：上传商品图 → 定素材数量/投放目标/测试思路（hook × 场景）→ 批量出脚本与视频

### 2.3 "Skill" 在小云雀中的真实形态

从产品手册观察，小云雀的"Skill"是 **Agent 内建的、面向特定任务的生成能力包**：

1. **入口形态**：Agent 首页推荐技能卡片 / 输入框技能下拉框，用户"点一下"即进入
2. **执行形态**：Skill 内部是**多步骤 Agent 流水线**（如一键出海：解析→人物形象生成→视频编辑→地区适配），
   由 Agent 编排，用户看到的是"上传 → 等待 → 出结果"
3. **与画布的关系**：Skill 的**产物（图片/视频）自动落画布**；画布不执行 skill，画布**组织和管理 skill 的产物**，
   并允许在画布中继续引用/编辑/组合/导出
4. **技能库清单**（官网可见）：剧本助手、重制转绘、3D 导演台、智能预演、无限画布（短剧/漫剧 Agent）；
   一键出海、批量生成（营销 Agent）；创意库/Hook 库/风格库（营销灵感库，非生成技能）

### 2.4 关键页面结构证据

- 首页"查看工作流"链接指向：`/novel/detail/canvas?thread_id=...&canvasId=...` —— **工作流=画布**，
  且画布有 `thread_id`（会话）+ `canvasId`（画布）两级
- 教程中心含《短剧 Agent 画布使用手册》《创作 Agent 画布使用手册》《营销 Agent 产品使用手册》
  《短剧 Agent 3D 导演台使用手册》《智能预演体验指南》——画布是 Agent 工作流的核心 UI
- 页脚明确分类"**Agent 工具：短剧/漫剧 Agent、创意 Agent、更多创意工具**"

---

## 3. 两相对比

| 维度 | libtv | 小云雀 |
|------|-------|--------|
| 画布语义 | 数据流 DAG（节点=执行单元） | 资产/引用画布（节点=内容单元，连线=引用上下文） |
| skill 集成方式 | 设计为可编排黑盒节点（manifest + runner） | Agent 内建技能，产物自动落画布 |
| 用户触发 | 拖节点→连线→填参→点生成 | 对话一句话 / 技能卡片一键进入 |
| 编排能力 | 强（拓扑排序、single/downstream 裁剪、并行执行） | 弱（画布只组织资产，编排在 Agent 内部黑盒） |
| 可预测性 | 高（执行可复现、可单节点重跑） | 低（Agent 自主决定，靠抽卡记录管理） |
| 资产沉淀 | 节点 data 持久化（无跨节点资产库） | 资产库（角色/场景/道具/素材）全链路同步 |
| 参考引用 | @ mentions 引用上游节点 | @ 引用资产库/画布任意素材 |
| 扩展开放 | 自研可改 | 闭源 SaaS |
| 工程成熟度 | 执行引擎成熟，UI 尚简 | UI/产品成熟，无公开引擎 |

**互补结论**：小云雀把"**创作体验**"做到了极致（对话+引用+资产库），
libtv 把"**工程化执行**"做到了极致（DAG+可预测+可重跑）。
libtv 集成开源漫剧 skill 的正确姿势，是**先做 libtv 式确定性节点**（保底可用），
再逐步吸收小云雀式能力：`@` 资产引用 → 资产库 → Agent 对话编排（Phase 2）。

---

## 4. 对 libtv 集成的建议（吸收小云雀经验）

在 docs/skill-integration-design.md 基础上，增补四点：

1. **Skill 节点产物进"资产库"**（新增 `user_asset` 联动）：
   skill 输出的角色图/场景图/成片，自动可存为资产，后续其他节点通过 `@` 引用——复刻小云雀"全链路资产同步"。
2. **连线语义扩展为"引用/参考"双模式**：
   保留数据流连线（确定性），同时允许 skill 节点把上游节点当"参考图/参考文本"（对齐小云雀引用语义），
   前端沿用现有 mentions 机制即可，后端 manifest 增加 `inputs[].source='upstream'`（设计文档已含）。
3. **技能市场与"技能卡片"入口**：
   画布节点选择弹窗增加"技能"分类展示 manifest 列表（小云雀式推荐卡片），而非只放一个通用 skill 节点。
4. **Agent 对话编排（Phase 2，与 ARCHITECTURE.md 对齐）**：
   加一个 `agent` 节点，内部跑 LLM 循环，让它决定调用哪个 skill、怎么传参——这是小云雀体验的核心，
   但依赖 LLM 编排稳定性，建议放在确定性节点跑通之后。

---

## 附：参考来源

- 小云雀官网首页：https://www.xiaoyunque.com/
- 教程中心：https://www.xiaoyunque.com/tutorials
- 短剧 Agent 画布使用手册：https://www.xiaoyunque.com/tutorials/short-drama-agent-canvas
- 创作 Agent 画布使用手册：https://www.xiaoyunque.com/tutorials/creation-agent-canvas
- Web 产品手册（短剧/漫剧 Agent、画布模式、营销 Skill）：https://www.xiaoyunque.com/tutorials/web-manual
- 营销 Agent 产品使用手册（画布 + 营销 Skill：一键出海/批量生成）：https://www.xiaoyunque.com/tutorials/marketing-agent
- 模型生态：https://www.xiaoyunque.com/model-ecosystem
- libtv 侧：本仓库 web/src + server/internal（代码级），设计文档 docs/skill-integration-design.md
