# 画布集成开源漫剧 Skill 设计方案

> 版本：v0.2（设计稿）
> 目标：把开源"漫剧"（动态漫画短剧）生成类 skill 集成进 libtv 无限画布，
> 让用户通过拖拽节点、连线、填参数的方式调用开源工具完成
> "剧本 → 分镜 → 生图 → 配音 → 合成" 的漫剧制作全流程。
> v0.2 增补：§7 资产库联动、§8 连线语义双模式（调研自小云雀，见 docs/canvas-skill-research.md）。

---

## 1. 背景与现状

libtv 画布目前支持 6 类节点：`text / image / video / audio / script / previz`。
执行链路为：

```
Canvas JSON → engine.Parse → engine.Validate → engine.TopologicalSort
    → ExecutorRegistry 按 node.type 分发到各 NodeExecutor
    → SSE 事件（node_started / node_progress / node_completed / node_failed）
    → 前端 useExecutionStream 回写节点 data → persistNodeOutputs 持久化
```

关键扩展点（已存在，可直接复用）：

| 扩展点 | 位置 | 说明 |
|--------|------|------|
| 节点类型枚举/配置 | `web/src/types/canvas.ts`（`NodeType`、`NODE_TYPE_CONFIG`） | 新增类型入口 |
| 前端节点插件 | `web/src/plugins/registry.ts` + `types.ts` | 前后端各维护一份 NodeTypePlugin 的惯例 |
| 提示词面板配置 | `web/src/configs/promptConfig.ts`（`PROMPT_PANEL_CONFIGS`） | 每个类型的面板配置 |
| 节点默认数据 | `web/src/utils/nodeFactory.ts` | `createDefaultNodeData` |
| 节点组件注册 | `web/src/components/nodes/index.ts`（`nodeTypes`） | 新增组件挂载点 |
| 节点添加入口 | `web/src/components/canvas/Canvas.tsx`（`EMPTY_GUIDE_TYPES`）+ `NodeSelectPopup.tsx` | 引导卡/FAB/右键 |
| 单节点生成 | `web/src/hooks/useNodeGeneration.ts`（`mode='single'`） | 复用它触发 skill 执行 |
| SSE 回写 | `web/src/hooks/useExecutionStream.ts` | 已支持 `content/imageUrl/videoUrl/audioUrl` 等字段回写 |
| 后端执行器注册 | `server/internal/engine/executor.go`（`NewDefaultRegistry`） | 注册新 executor |
| 后端执行上下文 | `server/internal/engine/executor.go`（`ExecutionContext`） | 读取上游输出/节点 data |
| 产物存储 | `server/internal/service/`（`FileUploadService`） | 上传到 MinIO/本地存储 |
| 计费 | `server/internal/service/`（`BillingService`） | 积分扣费 |

---

## 2. 开源漫剧 skill 的三种形态与适配策略

先明确"开源漫剧 skill"的形态，不同形态对应不同集成深度：

### 形态 A：黑盒生成器（推荐优先支持）
开源项目以 **CLI 可执行文件 / Docker 镜像 / HTTP 服务** 形式提供端到端漫剧生成能力
（输入剧本/参数 → 内部自动完成分镜、生图、配音、合成 → 输出成片文件）。
典型：MoneyPrinterTurbo 风格工具、各种"漫剧生成器"。

> **适配：通用 Skill 节点**（黑盒封装）。新增 `skill` 节点类型，manifest 驱动参数表单，
> 后端 SkillExecutor 调起 runner 执行，产物上传存储后回写 URL。

### 形态 B：可分解流程模板
开源项目以"步骤说明 + 脚本"形式开源（如"剧本→分镜表→逐格生图→图生视频→TTS→ffmpeg 合成"）。

> **适配：子图模板**。把流程一键展开为画布上的一组现有节点（text → script → image → video → audio），
> 用户可自由编辑每一步。对 libtv 来说这是"白盒"形态，复用全部现有 executor。

### 形态 C：Agent Skill（SKILL.md 格式）
开源 skill 以 `SKILL.md` + 配套脚本形式存在，需 LLM agent 循环驱动执行
（ARCHITECTURE.md 已把 "Agent Skill 接口" 列为 Phase 2）。

> **适配：Agent 节点**（Phase 2）。节点内跑一个 agent 循环，把 skill 描述 + 上游素材交给 LLM 编排执行。

### MVP 建议
- **Phase 1 做形态 A**（Skill 节点）+ **形态 B**（子图模板）。
- 形态 C 留作 Phase 2，与既有 Phase 2 规划对齐。
- A 与 B 共用同一份 **Skill Manifest** 描述（见 §4），只是 runner 不同。

---

## 3. 总体架构

```
┌────────────────────────────── 前端（web/src） ──────────────────────────────┐
│                                                                            │
│  NodeSelectPopup / FAB / 引导卡                                             │
│        │ 新增 skill 节点                                                    │
│        ▼                                                                   │
│  SkillNode.tsx（BaseNode 外壳）                                             │
│   ├─ skill 下拉选择（GET /api/skills → manifest 列表）                      │
│   ├─ 动态参数表单（由 manifest.inputs schema 渲染）                          │
│   ├─ 产物预览（video / image / audio）                                      │
│   └─ 生成按钮 → useNodeGeneration(mode='single')                            │
│        │                                                                   │
│        ▼                                                                   │
│  workflowApi.execute → POST /api/projects/:id/workflows/execute             │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────── 后端（server/internal） ──────────────────────┐
│                                                                            │
│  workflow_handler.Execute（现有，不改）                                      │
│   → Parse / Validate / TopologicalSort / FilterSingle                       │
│   → WorkflowEngine.Execute 分发到 SkillExecutor                             │
│                                                                            │
│  SkillExecutor（新增，engine/executor.go 注册 "skill"）                      │
│   ├─ 解析 node.data → skillId + params                                      │
│   ├─ SkillRegistry.Get(skillId) → manifest                                  │
│   ├─ 从 ExecutionContext 读上游输出，填充 source='upstream' 的输入           │
│   ├─ 组装 payload（JSON：参数 + 上游素材 URL 列表）                          │
│   ├─ Runner 执行：                                                          │
│   │    ├─ ExecRunner    exec.Command（本地 CLI / 脚本）                     │
│   │    ├─ HTTPRunner    POST 本地/远端服务                                  │
│   │    └─ DockerRunner  docker run（依赖隔离，推荐）                        │
│   ├─ 进度上报：解析 stdout 进度行 → node_progress；无进度时退化为 10s 心跳    │
│   ├─ 产物处理：本地文件 → FileUploadService 上传 → URL                      │
│   ├─ 计费：BillingService 扣费/退费                                        │
│   └─ 输出回写：NodeOutput.Data{ videoUrl / imageUrl / audioUrl / ... }      │
│                                                                            │
│  skill 包（新增 server/internal/skill/）                                    │
│   ├─ manifest.go   SkillManifest / SkillInput 结构 + JSON Schema 校验        │
│   ├─ registry.go   SkillRegistry（注册 / 查询 / 列表）                      │
│   └─ runner.go     Runner 接口 + ExecRunner / HTTPRunner / DockerRunner      │
│                                                                            │
│  handler：GET /api/skills（manifest 列表，鉴权）                             │
└────────────────────────────────────────────────────────────────────────────┘
```

数据流与时序：

```
用户点生成
  → useNodeGeneration.saveCanvas（持久化画布）
  → workflowApi.execute(projectId, { startNodeId, mode: 'single' })
  → 后端：FilterSingle 只跑 skill 节点 → SkillExecutor.Execute
  → runner 调起开源工具（可长任务，几分钟）
  → SSE: node_started → node_progress(若干) → node_completed{ videoUrl }
  → 前端 useExecutionStream 把 videoUrl 写回节点 data → 节点内视频预览
  → persistNodeOutputs 把产物 URL 持久化进画布 JSON
```

---

## 4. Skill Manifest 设计（前后端共用）

每个开源 skill 用一份 manifest 描述"是什么、要什么参数、怎么执行、产出什么"。
前端用它渲染表单与连线约束，后端用它校验与执行。

```ts
// web/src/plugins/skillTypes.ts（前端） / server/internal/skill/manifest.go（后端，字段对齐）
export interface SkillManifest {
  id: string;                 // 唯一标识，如 'comic-drama-v1'
  name: string;               // 显示名，如 '漫剧生成'
  description: string;        // 用途说明
  icon?: string;              // AntD icon 名
  color?: string;             // 节点主色（缺省用默认）
  version: string;

  /** 输入参数 schema：驱动前端表单 + 后端校验 */
  inputs: SkillInput[];

  /** 允许连接的上游节点类型（连线约束，替代 produces 校验） */
  acceptsUpstream: NodeType[];

  /** 输出声明：产物写回节点 data 的哪些字段 */
  outputs: {
    kind: 'video' | 'image' | 'audio' | 'json';
    fields: string[];         // 如 ['videoUrl'] 或 ['videoUrl','resultJson']
  };

  /** 执行方式 */
  runner: {
    type: 'exec' | 'http' | 'docker';
    command?: string;         // exec: 可执行文件 / 脚本路径
    args?: string[];          // exec: 固定附加参数
    url?: string;             // http: 服务地址
    image?: string;           // docker: 镜像名
    timeoutSec?: number;      // 超时（默认取引擎 10min 上限内）
    /** stdout 进度协议：true 表示输出 JSON 行 {"progress":0..1,"message":"..."} */
    progressProtocol?: boolean;
  };

  /** 计费（可选）：一次执行的积分价格 */
  billing?: { credits: number; model?: string };
}

export interface SkillInput {
  key: string;                // 参数名（payload 里的 key）
  label: string;              // 表单标签
  type: 'text' | 'textarea' | 'number' | 'select' | 'boolean'
       | 'imageRef' | 'videoRef' | 'audioRef';   // Ref 型从上游节点取 URL
  required?: boolean;
  default?: unknown;
  placeholder?: string;
  options?: { label: string; value: string }[];   // select 用
  /** 取值来源：user=用户在表单里填；upstream=自动从上游节点 data 取（dataFlow 边）；
      reference=从 reference 引用边的上游节点取（见 §8）；assetLibrary=从资产库取（见 §7，Phase 2） */
  source?: 'user' | 'upstream' | 'reference' | 'assetLibrary';
  /** source='upstream' 时：从上游节点 data 的哪个字段取（如 content / imageUrl） */
  upstreamField?: string;
}
```

### 漫剧 skill 示例 manifest

```ts
const comicDramaManifest: SkillManifest = {
  id: 'comic-drama-v1',
  name: '漫剧生成',
  description: '输入剧本与风格，一键生成带配音、运镜、字幕的漫画短剧成片',
  icon: 'VideoCameraOutlined',
  color: '#f97316',
  version: '1.0.0',
  inputs: [
    { key: 'script',    label: '剧本/故事梗概', type: 'textarea', required: true,
      placeholder: '主角穿越回古代…', maxLength: 8000 },
    { key: 'style',     label: '画风', type: 'select', default: '国漫',
      options: [ {label:'国漫',value:'guoman'}, {label:'日漫',value:'anime'},
                 {label:'写实',value:'realistic'} ] },
    { key: 'episodes',  label: '集数', type: 'number', default: 1, min: 1, max: 20 },
    { key: 'duration',  label: '单集时长(秒)', type: 'number', default: 60 },
    { key: 'voice',     label: '配音音色', type: 'select',
      options: [ {label:'男声-磁性',value:'male-deep'}, {label:'女声-甜美',value:'female-sweet'} ] },
    { key: 'charRef',   label: '主角形象参考图', type: 'imageRef',
      source: 'upstream', upstreamField: 'imageUrl' },
    { key: 'bgm',       label: '背景音乐', type: 'audioRef',
      source: 'upstream', upstreamField: 'audioUrl' },
  ],
  acceptsUpstream: ['text', 'image', 'audio', 'script'],
  outputs: { kind: 'video', fields: ['videoUrl', 'resultJson'] },
  runner: { type: 'docker', image: 'registry.example.com/comic-drama:v1',
            progressProtocol: true, timeoutSec: 480 },
  billing: { credits: 30 },
};
```

> 说明：`source='upstream'` 的 Ref 型输入不必连线也能用——SkillExecutor 会从
> `ExecutionContext.GetUpstreamSources(nodeID)` 拿上游节点，再读其 data 对应字段。
> 但建议引导用户连线（前端可在表单里显示"@ 引用上游节点"），与现有 mentions 机制保持一致。

---

## 5. 前端改动清单

### 5.1 类型与配置
- `web/src/types/canvas.ts`
  - `NodeType` 增加 `'skill'`
  - 新增 `SkillNodeData`（`extends BaseNodeFields`）：
    ```ts
    export interface SkillNodeData extends BaseNodeFields {
      type: 'skill';
      skillId: string;
      params: Record<string, unknown>;   // 用户填写的 skill 参数
      // 产物（执行后由 SSE 回写）
      videoUrl?: string;
      imageUrl?: string;
      audioUrl?: string;
      resultJson?: Record<string, unknown>;
      // 资产库联动（§7）：已沉淀到资产库的产物 ID 列表（溯源用，可空）
      assetIds?: string[];
    }
    ```
  - `LibTVNodeData` 联合类型增加 `SkillNodeData`
  - `NODE_TYPE_CONFIG` 增加 `skill: { label: 'Skill', color: '#f97316', icon: 'RocketOutlined' }`
- `web/src/utils/nodeFactory.ts`：`createDefaultNodeData` 增加 `case 'skill'`，
  默认 `{ skillId: '', params: {}, status: 'idle' }`；`DEFAULT_STYLE` 加 `skill: { width: 340 }`
- `web/src/configs/promptConfig.ts`：`PROMPT_PANEL_CONFIGS` 增加 `skill` 项
  （`acceptedInputs` 以空数组占位——skill 节点的连线约束由所选 manifest 决定，见 5.3）

### 5.2 新增 skill 插件与 API
- 新增 `web/src/plugins/skillTypes.ts`：`SkillManifest` / `SkillInput` 类型（同 §4）
- 新增 `web/src/plugins/skillRegistry.ts`：
  - `class SkillRegistry { get(id): SkillManifest; list(): SkillManifest[] }`
  - 从 `GET /api/skills` 拉取 manifest 列表（后端为唯一事实来源，前端缓存）
- 新增 `web/src/services/skillApi.ts`：`skillApi.listSkills()`

### 5.3 节点组件
- 新增 `web/src/components/nodes/SkillNode.tsx`：
  - 用 `BaseNode` 外壳（自带 loading/error 状态点、重命名、Handle）
  - 内容区三段：
    1. **skill 选择**：下拉（`skillRegistry.list()`），选中后记录 `data.skillId`
    2. **参数表单**：按 `manifest.inputs` 动态渲染（AntD `Form` + 受控组件）；
       `source='upstream'` 的 Ref 型输入显示"自动取上游"徽标，不再渲染上传框
    3. **产物预览**：`videoUrl` → `<video>` 播放；`imageUrl` → 缩略图；`audioUrl` → 播放条；
       无产物时显示占位
  - 生成按钮：复用 `useNodeGeneration({ nodeId })` 的 `generate()`
  - 选中节点后，右上角也可用现有 PromptCompose 体系扩展（Phase 2 再做）
- `web/src/components/nodes/index.ts`：`nodeTypes` 增加 `skill: SkillNode`

### 5.4 节点添加入口
- `web/src/components/canvas/NodeSelectPopup.tsx`：`nodeTypeList` 增加 `'skill'`，
  `iconMap` 增加对应图标
- `web/src/components/canvas/Canvas.tsx`：`EMPTY_GUIDE_TYPES` 增加
  `{ type: 'skill', label: 'Skill', desc: '调用开源漫剧/工具', icon: <RocketOutlined /> }`

### 5.5 SSE 回写（基本零改动）
`useExecutionStream.ts` 已处理 `videoUrl / imageUrl / audioUrl / error` 字段回写，
SkillExecutor 输出沿用这些字段名即可。`resultJson` 需在 `node_completed` 分支补一行
`if (data.resultJson !== undefined) updates.resultJson = data.resultJson;`；
`assetIds`（§7 资产沉淀溯源）同样补一行
`if (data.assetIds !== undefined) updates.assetIds = data.assetIds;`。

---

## 6. 后端改动清单

### 6.1 新增 skill 包 `server/internal/skill/`
- `manifest.go`：`SkillManifest` / `SkillInput` / `RunnerConfig` / `OutputSpec` 结构
  （json tag 与前端字段对齐），`Validate(manifest) error` 基础校验
- `registry.go`：
  - `SkillRegistry`：`map[string]*SkillManifest`，提供 `Register / Get / List`
  - 启动时从配置目录（如 `server/skills/*.json`）自动加载所有 manifest，
    支持热更新（`fsnotify` 监听，Phase 2）
- `runner.go`：
  - `type Runner interface { Run(ctx, *RunRequest) (*RunResult, error) }`
  - `RunRequest{ Manifest, Params, UpstreamAssets, ProgressFn func(progress, message) }`
  - `RunResult{ Files []string /* 本地产物路径 */, Extra map[string]any }`
  - 三个实现：
    - `ExecRunner`：`exec.CommandContext`，payload 以 JSON 写 stdin（避免命令注入），
      按 `progressProtocol` 解析 stdout 的 JSON 进度行
    - `HTTPRunner`：POST `runner.url`，body 为 JSON payload，支持轮询或 SSE 进度（Phase 2）
    - `DockerRunner`：`docker run --rm -v 工作目录 ...`，推荐用于依赖重的开源工具

### 6.2 SkillExecutor（`server/internal/engine/executor.go`）
实现 `NodeExecutor` 接口，注册 `"skill"`：

```
Execute(ctx, node, execCtx):
  1. 解析 node.Data → { skillId, params }
  2. manifest := skillRegistry.Get(skillId)；不存在 → 报错
  3. 校验 params（required / 类型）
  4. 填充引用/上游输入：
       a. source == 'reference'（§8）：refSources := execCtx.GetReferenceSources(node.ID)
       b. source == 'upstream'：sources := execCtx.GetUpstreamSources(node.ID)
       对每个 input，从对应来源节点 data 取其 data[input.upstreamField] 加入 payload[input.key]
      （source == 'assetLibrary' 留 Phase 2：由前端把 [[a:ASSET_ID]] 解析成 URL 传入 params）
  5. payload := { 参数..., upstreamAssets: [...], projectId, userId, canvasDir }
  6. biller 预扣费（manifest.billing.credits）；失败则退费（复用 refundWithFreshCtx）
  7. runner.Run(ctx, req)，ProgressFn 里 emit WorkflowEvent{EventNodeProgress}
  8. 产物：对 RunResult.Files 逐个 FileUploadService 上传 → URL
  9. 资产沉淀（§7）：manifest.assetSinks 中 auto=true 的条目 → UserAssetService.Create，
     返回的 assetId 记入 output.Data.assetIds
  10. 组装 NodeOutput.Data：
       outputs.kind == 'video'  → { videoUrl }
       'image' → { imageUrl }；'audio' → { audioUrl }
       fields 含 resultJson → { resultJson: RunResult.Extra }
     status: success
  11. 任何错误：退费 + status failed + Error 描述
```

### 6.3 注册与配置
- `server/cmd/server/main.go`：构造 `SkillRegistry`（加载 `server/skills/*.json`），
  `registry.Register("skill", NewSkillExecutor(skillReg, fileUploadService, biller, ...))`
- 新增 `server/internal/handler/skill_handler.go`：
  - `GET /api/skills`（鉴权）→ `{ code:0, data: { skills: [...] } }`
  - 路由注册在 `main.go` / 现有 router 文件
- `server/skills/` 目录放 manifest 文件（`comic-drama-v1.json`），README 说明格式

### 6.4 计费与安全
- 复用 `BillingService`（与 Image/Video executor 同款扣费/退费逻辑）
- 参数校验白名单：runner 不接收任意参数名，只透传 manifest.inputs 声明的 key
- 本地文件产物先写入隔离工作目录（`storage/tmp/skills/<executionID>/`），
  上传后清理，防止越权读写
- Docker runner 用 `--network none`（若开源工具无网络需求）或受控网络，避免逃逸

---

## 7. 资产库联动：skill 产物沉淀与 @ 引用

> 背景（调研结论）：libtv 已有个人资产库基础（`model.UserAsset` + `GET/POST/DELETE /api/user-assets`，
> 前端 `web/src/services/assetApi.ts`），但目前只支持 image/video 的 URL 引用、与画布节点无联动。
> 小云雀的资产库做到"画布 - 资产库 - 对话窗口"全链路同步、一处更新全局生效。
> 本节让 skill 产物可一键沉淀进资产库，并被其他节点通过 `@` 引用，复刻这一能力。

### 7.1 目标

1. skill 节点执行后，产物（成片视频 / 角色图 / 场景图 / 音频）可一键存入个人资产库
2. 任何节点（含 skill 节点）可在参数/提示词中通过 `@` 引用资产库素材作为输入
3. 资产库素材可被多个项目/画布复用，删除画布节点不影响已沉淀资产

### 7.2 manifest 扩展

```ts
export interface SkillManifest {
  // ……（其余字段同 §4）

  /**
   * 产物可沉淀进资产库的声明。
   * 执行成功后，前端在产物预览区渲染"存入资产库"按钮（或 manifest 声明 auto 自动入库）。
   */
  assetSinks?: Array<{
    /** 产物字段路径：如 'videoUrl' / 'imageUrl' / 'audioUrl' / 'resultJson.covers[0].url' */
    field: string;
    /** 资产类型（UserAsset.type 现支持 image | video；audio 需后端扩展） */
    type: 'image' | 'video' | 'audio';
    /** 资产名称模板（支持 {{label}} / {{skillName}} 占位），缺省用节点 label */
    nameTemplate?: string;
    /** true 时执行完成自动入库（需用户已在设置中允许），默认 false = 手动按钮入库 */
    auto?: boolean;
  }>;
}
```

示例（漫剧 skill）：

```ts
assetSinks: [
  { field: 'videoUrl', type: 'video', nameTemplate: '漫剧成片-{{label}}' },
  { field: 'resultJson.covers[0].url', type: 'image', nameTemplate: '漫剧封面-{{label}}' },
],
```

### 7.3 前端改动

- `SkillNode.tsx` 产物预览区：根据 `manifest.assetSinks` 渲染"存入资产库"按钮，
  点击调用 `assetApi.create({ type, url, name })`（复用现有 `/user-assets` API）；
  `auto: true` 时在 `node_completed` 后自动调用
- `PromptEditor` / PromptCompose 的 `@` 引用面板：**增加"资产库"来源 tab**
  （当前 mentions 只引用画布节点），列出 `assetApi.list(type)` 结果，选中后生成
  `[[a:ASSET_ID]]` 占位符 + `MentionMarker`（需给 `web/src/types/prompt.ts` 的
  `MentionMarker` 增加可选 `assetId?: string` 字段，`nodeId` 保持空串，
  占位符前缀 `[[a:` 与现有 `[[m:` 区分，见 §8.4 的解析关系）
- 节点右键菜单增加"加入资产库"（与现有"存到个人资产库"入口合并/复用 `NodeContextMenu`）

### 7.4 后端改动

- `model.UserAsset` 增加 `kind` 字段（`canvas_node` / `skill_output` / `upload`）与
  `sourceNodeId`，便于溯源与去重；audio 类型同步放开（`Type` 现为字符串，无需迁移）
- 新增 `repository.UserAssetRepo.FindByIDs` / `FindByTypeAndOwner`，供 mentions 解析用
- `SkillExecutor` 产物处理阶段（§6.2 步骤 8 之后）：
  ```go
  // manifest.assetSinks 里 auto=true 的条目：把产物 URL 写入 UserAssetService
  for _, sink := range manifest.AssetSinks {
      if sink.Auto {
          _ = userAssetService.Create(ctx, &model.UserAsset{
              UserID: execCtx.GetUserID(),
              Type:   sink.Type,
              URL:    resolveField(output.Data, sink.Field),
              Name:   renderName(sink.NameTemplate, node),
          })
      }
  }
  ```
- 新增 `GET /api/user-assets/:id`（按 ID 取资产 URL），供 mentions 解析从 ID 还原 URL；
  `resolveField` 支持 `a.b.c` 路径取值（简单反射/递归 map 查找）

### 7.5 数据流

```
skill 执行成功 → output.Data{ videoUrl, resultJson.covers[] }
  → （auto）UserAssetService.Create → 资产库
  → （手动）前端产物预览"存入资产库"按钮 → assetApi.create
  → 其他节点 PromptEditor 输入 @ → 资产库 tab → [[a:ASSET_ID]]
  → 执行时 executor 解析 mentions → 取资产 URL 作为参考/输入
```

---

## 8. 连线语义双模式：数据流 + 引用/参考

> 背景（调研结论）：libtv 当前连线是**纯数据流**语义——上游输出作为下游输入，参与拓扑排序与执行依赖。
> 小云雀的连线是**引用上下文**——左侧是"参考输入"（文本作提示词、图片作参考图），右侧是"参考输出"，
> 引用关系不构成强执行依赖。本节给 skill 节点（及全画布）增加"引用/参考"连线模式。

### 8.1 两种连线语义

| 模式 | 类型 | 语义 | 是否参与拓扑执行 | 用途 |
|------|------|------|-----------------|------|
| 数据流 | `dataFlow`（现有） | 上游产物作为下游输入/素材，下游依赖上游先执行 | ✅ | 剧本→分镜→生图→合成等确定性链路 |
| 引用/参考 | `reference`（新增） | 上游节点作为下游的**参考上下文**（参考图/参考文本/风格），下游不依赖上游执行 | ❌（下游可独立跑，参考缺失时告警） | skill 节点取角色参考图、风格参考；@ 引用的可视化等价物 |

### 8.2 前端改动

- `types/canvas.ts`：`LibTVEdge` 增加 `data.mode?: 'dataFlow' | 'reference'`（缺省 dataFlow）
- `Canvas.tsx`：连线交互时按住 `Alt`（或连线后右键切换）创建 `reference` 边；
  `edgeTypes` 增加 `ReferenceEdge`（虚线 + 不同颜色，基于 `DataFlowEdge` 改样式）
- 连线校验（`plugins/registry.ts validateConnection`）：`reference` 边放宽——
  任意 source 类型都可作为参考（是否被接受由目标节点提示词/参数决定），
  而 `dataFlow` 边仍走 `acceptsUpstream` 白名单
- `SkillNode.tsx`：`source='reference'` 的 Ref 型输入，从 `reference` 边的上游节点取素材
  （回退：无 reference 边时，退回从 `dataFlow` 上游取——向后兼容）

### 8.3 后端改动

- `engine/parser.go`：`CanvasEdge` 增加 `Data json.RawMessage`，解析出 `mode`；
  仅 `dataFlow` 边进入 `Connections`（拓扑排序），`reference` 边单独存 `References []Connection`
- `engine/executor.go`：`ExecutionContext` 增加
  ```go
  referencesByTarget map[string][]string // target -> reference 上游 source 列表
  func (ec *ExecutionContext) GetReferenceSources(targetNodeID string) []string
  ```
  `WorkflowEngine.Execute` 里从 plan 的 reference 边构建该映射（与 `upstreamByTarget` 并列）
- `SkillExecutor`（§6.2 步骤 4 改造）：
  ```go
  // source == 'reference' 的输入：
  refSources := execCtx.GetReferenceSources(node.ID)
  从 refSources 的 data 取 input.upstreamField → payload[input.key]
  // source == 'upstream' 的输入维持从 dataFlow 上游取（向后兼容）
  ```
- 其他 executor（Image/Video）暂不消费 reference 边，只靠现有 `@ mentions` 机制取参考素材
  （mentions 已是引用语义的文本化形式，见 §8.4）

### 8.4 与现有 @ mentions 机制的关系

libtv 已有一套**文本化引用**：提示词里的 `[[m:ID]]` 占位符 + `MentionMarker`（`nodeId` 指向画布节点），
Image/Video executor 已能从中提取参考图/参考视频/参考音频 URL（`executor.go` 的 mentions 解析逻辑）。

资产库引用沿用同一机制：`MentionMarker` 增加 `assetId` 字段、占位符用 `[[a:ASSET_ID]]`，
executor 解析 mentions 时对 `assetId` 非空的标记调用 `GET /api/user-assets/:id` 还原 URL（§7.4）。

因此**最小实现路径**：Phase 1 不引入 `reference` 边类型，skill 节点的参考输入全部走
mentions（用户在提示词里 @ 上游节点，或从资产库 @ 资产——§7.3）。`reference` 边是
"引用的可视化"增强（Phase 2），让用户不用打字也能建立引用关系。

| 阶段 | 引用方式 | 说明 |
|------|---------|------|
| Phase 1 | 仅 `@ mentions`（文本化） | 零连线改动；Ref 型输入 source='upstream' 从 dataFlow 上游兜底 |
| Phase 2 | 新增 `reference` 边 | 可视化引用；数据流与引用分离，语义更清晰 |

---

## 9. 子图模板（形态 B）设计要点

复用现有节点做"白盒漫剧流程"，价值在于用户可编辑中间步骤：

1. **模板定义**：`SkillManifest` 增加可选字段
   ```ts
   template?: {
     nodes: Array<{ type: NodeType; label: string; data: Partial<LibTVNodeData> }>;
     edges: Array<{ source: number; target: number }>;  // 按 nodes 下标
   };
   ```
2. **前端**：Skill 节点下拉里出现"展开为子图"按钮；点击后 `createNode` 批量生成节点并连线
   （复用 `useCanvasStore.addNode/addEdge`，一次入 undo 历史）
3. **后端**：不需要新 executor；展开后的子图直接走现有执行链路
4. 适用场景：开源项目给出"分镜表 + 提示词 + ffmpeg 命令"式的流程说明时，人工把它翻译成模板

> 漫剧的典型白盒模板：`text(剧本) → script(分镜) → image(逐格生图) → video(图生视频) → audio(TTS) → 合成`。
> 合成步骤（ffmpeg 拼接/加字幕）可做成另一个 skill 节点（`runner.type='exec'`，command=ffmpeg 脚本）。

---

## 10. 使用流程（用户视角）

```
1. 添加节点：右键画布 / 右下角 + / 空画布引导卡 → 选 "Skill"
2. 选择 skill：节点内下拉 → "漫剧生成"
3. 填参数：剧本、画风、集数、时长、音色……（表单由 manifest 自动渲染）
4. （可选）建立引用：
   - 数据流连线：把上游 text(剧本) / audio(配乐) 连到 skill 节点，作为输入素材
   - 引用连线（Phase 2，Alt+连线）：把 image(角色参考) 节点连到 skill 节点作为参考图
   - 或直接在提示词里 @ 上游节点 / @ 资产库素材（见 §7、§8）
5. 点"生成"：节点变 running → 节点内显示进度（"正在生成第 3/12 张分镜…"）
6. 完成后：节点内直接预览成片视频；可下载、**存入资产库**、继续接下游节点
7. 重新生成：改参数再点生成（mode='single' 只重跑本节点，不碰上游）
```

---

## 11. 落地步骤

| 阶段 | 内容 | 验收标准 |
|------|------|----------|
| **P1 骨架打通** | skill 节点类型 + manifest 表单 + ExecRunner + mock skill（如 `echo` 返回占位 URL） | 画布能加 skill 节点、填参数、点生成、SSE 回写产物 |
| **P2 真实漫剧 skill** | 接入第一个开源漫剧生成器（选依赖轻、产物可直接上传的），DockerRunner 或 ExecRunner；产物"存入资产库"按钮（手动） | 从剧本一键出漫剧成片视频；成片可存资产库 |
| **P3 增强** | 子图模板展开、进度协议完善、计费接入、资产库 `@` 引用（mentions 增加资产库 tab）、`reference` 引用边（可视化） | 用户可编辑白盒流程；资产可被其他节点 @ 引用；扣费正确 |
| **P4（可选）** | Agent Skill 节点（SKILL.md 驱动，LLM agent 循环） | 与 ARCHITECTURE.md Phase 2 对齐 |

---

## 12. 风险与权衡

| 风险 | 缓解 |
|------|------|
| 开源工具依赖重（Python 环境/模型权重/ffmpeg） | 优先 Docker runner 隔离；Exec runner 限定白名单路径 |
| 漫剧生成是长任务（数分钟） | `progressProtocol` 进度行 + 10s 心跳退化；引擎 10min 超时上限内可调 |
| 命令注入 | payload 走 stdin JSON，参数白名单，不拼接 shell 字符串 |
| 产物体积大/类型杂 | 复用 FileUploadService 的缓存与存储策略；上传后清理临时目录 |
| skill 清单膨胀 | manifest 外置为配置文件，服务端热加载；前端只展示已注册项 |
| 上游素材 URL 失效 | Ref 型输入取节点 data 中已持久化的 URL；失败时给出明确错误 |
| 资产库引用悬挂（资产被删后 @ 失效） | `UserAssetRepo` 查询时校验存在性；解析 mentions 时对缺失资产降级为提示而非报错 |
| `reference` 边语义被误用（绕开拓扑依赖） | 前端区分颜色/样式并加 tooltip 说明；后端仅 dataFlow 边进拓扑，reference 边缺失时只告警不阻塞 |
| 资产库内容越权 | 复用现有 middleware 鉴权（GetUserID），所有资产读写按 userID 隔离 |

---

## 附：与现有代码的对应关系速查

- 新增节点类型：`web/src/types/canvas.ts` → `NodeType` / `NODE_TYPE_CONFIG` / `LibTVNodeData`
- 新增前端插件：`web/src/plugins/registry.ts`（沿用 NodeTypePlugin 惯例，skill 走独立 registry）
- 新增后端 executor：`server/internal/engine/executor.go` → `NewDefaultRegistry` 注册 `"skill"`
- 新增后端包：`server/internal/skill/`（manifest/registry/runner）
- 新增 API：`GET /api/skills`（`server/internal/handler/skill_handler.go`）
- 执行触发与回写：`web/src/hooks/useNodeGeneration.ts` + `useExecutionStream.ts`（复用，几乎零改动）
- 资产库（§7）：复用 `model.UserAsset` + `server/internal/handler/user_asset_handler.go` +
  `web/src/services/assetApi.ts`；扩展 `kind/sourceNodeId`、`GET /api/user-assets/:id`、mentions 资产库 tab
- 引用边（§8）：`web/src/components/edges/DataFlowEdge.tsx` 派生 `ReferenceEdge`；
  `server/internal/engine/parser.go` 解析 `data.mode`；`ExecutionContext` 增加 `referencesByTarget`
