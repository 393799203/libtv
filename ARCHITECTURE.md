# LibTV MVP 架构设计文档

> **版本**：V1.0
> **日期**：2026-06-05
> **目标**：用最小功能集跑通"剧本→分镜→生图→生视频→成片"核心链路

---

## 一、MVP 范围定义

### 1.1 做什么（In Scope）

| 模块 | MVP 功能 | 优先级 |
|------|---------|--------|
| **无限画布** | React Flow 画布，支持拖拽/缩放/平移/连线，因为是无限画布，所以需要格外关注节点很多的时候性能。性能要优化到极致 | P0 |
| **5种基础节点** | 文本/图像/视频/音频/脚本 | P0 |
| **节点连线** | 上游输出→下游输入，数据流可视化 | P0 |
| **脚本→分镜拆解** | LLM 解析剧本，输出结构化分镜表 | P0 |
| **AI生图** | 接入 1-2 个图像模型（SD API / MJ API） | P0 |
| **AI生视频** | 接入 1 个视频模型（可灵/Seedance） | P0 |
| **工作流执行引擎** | DAG 拓扑排序 + 并行调度 + 进度推送 | P0 |
| **画布持久化** | 保存/加载画布 JSON | P0 |
| **用户系统** | 注册/登录/项目列表 | P1 |
| **节点打组** | Ctrl+G 打组，整组执行 | P1 |
| **工作流模板** | 保存/复用工作流组合 | P2 |

### 1.2 不做什么（Out of Scope for MVP）

- 3D 导演台（Phase 2）
- 角色三视图/一致性锁定（Phase 2）
- 多人实时协作 CRDT（Phase 2）
- Agent Skill 接口（Phase 2）
- 9/25 宫格分镜（Phase 2）
- 模板市场/社区（Phase 3）
- 桌面客户端 Electron（Phase 3）

---

## 二、系统架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Client Layer                                  │
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐  │
│   │                    Web App (SPA)                              │  │
│   │                                                              │  │
│   │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐  │  │
│   │  │ 画布引擎  │ │ 节点系统  │ │ 属性面板  │ │ 工作流控制台   │  │  │
│   │  │ Canvas   │ │ Nodes    │ │ Props    │ │ Executor      │  │  │
│   │  └────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬────────┘  │  │
│   │       │            │            │               │            │  │
│   │  ┌────▼────────────▼────────────▼───────────────▼────────┐  │  │
│   │  │              Zustand Store (全局状态)                   │  │  │
│   │  │  · canvasState (节点/边/视口)                          │  │  │
│   │  │  · projectState (项目元信息)                           │  │  │
│   │  │  · executionState (执行状态/进度)                      │  │  │
│   │  └───────────────────────────────────────────────────────┘  │  │
│   │                                                              │  │
│   │  Tech: React 18 + TypeScript + @xyflow/react + Zustand      │  │
│   │        + Ant Design 5 + TailwindCSS                          │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│                     HTTP REST + WebSocket                            │
│                              │                                       │
├──────────────────────────────┼──────────────────────────────────────┤
│                        Server Layer                                  │
│                              │                                       │
│   ┌──────────────────────────▼──────────────────────────────────┐  │
│   │                    API Gateway (Gin)                         │  │
│   │  · JWT 认证 / 限流 / 请求路由                                │  │
│   └──────┬──────────┬──────────┬──────────┬─────────────────────┘  │
│          │          │          │          │                         │
│   ┌──────▼───┐ ┌────▼────┐ ┌──▼───────┐ ┌▼──────────┐            │
│   │ 画布服务  │ │工作流引擎│ │ AI 网关  │ │ 用户服务   │            │
│   │ Canvas   │ │Workflow │ │AI Gateway│ │ User/Auth │            │
│   │ Service  │ │ Engine  │ │ Service  │ │ Service   │            │
│   └──────┬───┘ └────┬────┘ └──┬───────┘ └┬──────────┘            │
│          │          │         │          │                         │
│   ┌──────▼──────────▼─────────▼──────────▼─────────────────────┐  │
│   │                    Data Access Layer                         │  │
│   │  · Repository Pattern (接口抽象)                             │  │
│   │  · GORM (ORM) / Raw SQL (复杂查询)                          │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                              │                                       │
├──────────────────────────────┼──────────────────────────────────────┤
│                        Data Layer                                    │
│                              │                                       │
│   ┌────────────┐  ┌─────────▼──┐  ┌────────────┐  ┌────────────┐  │
│   │ PostgreSQL │  │   Redis    │  │  MinIO/OSS │  │  FFmpeg    │  │
│   │ · 业务数据  │  │ · 缓存     │  │  · 媒体文件 │  │  · 视频处理 │  │
│   │ · 画布JSON │  │ · 会话     │  │  · 图片     │  │  · 合并切片 │  │
│   │ · 执行记录  │  │ · 队列     │  │  · 视频     │  │            │  │
│   └────────────┘  └────────────┘  └────────────┘  └────────────┘  │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                     External AI Services                             │
│                                                                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│   │ LLM API  │  │ 图像模型  │  │ 视频模型  │  │ 语音模型  │          │
│   │GPT/Claude│  │SD API/MJ │  │Kling/SDV │  │TTS/ASR   │          │
│   └──────────┘  └──────────┘  └──────────┘  └──────────┘          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 三、后端分层架构（Go / Gin）

### 3.1 目录结构

```
server/
├── cmd/
│   └── server/
│       └── main.go                 # 入口
├── internal/
│   ├── config/                     # 配置管理
│   │   └── config.go
│   ├── middleware/                  # 中间件
│   │   ├── auth.go                 # JWT 认证
│   │   ├── cors.go                 # 跨域
│   │   └── ratelimit.go            # 限流
│   ├── handler/                    # HTTP Handler (Controller 层)
│   │   ├── user_handler.go
│   │   ├── project_handler.go
│   │   ├── canvas_handler.go
│   │   ├── workflow_handler.go
│   │   └── ai_handler.go
│   ├── service/                    # 业务逻辑层
│   │   ├── user_service.go
│   │   ├── project_service.go
│   │   ├── canvas_service.go
│   │   ├── workflow_service.go     # 工作流编排
│   │   └── ai_gateway_service.go   # AI 模型网关
│   ├── engine/                     # 工作流执行引擎（核心）
│   │   ├── parser.go               # Canvas JSON → DAG 解析
│   │   ├── validator.go            # 图合法性校验
│   │   ├── scheduler.go            # 任务调度器
│   │   ├── executor.go             # 节点执行器接口
│   │   ├── executors/              # 各类型节点执行器
│   │   │   ├── text_executor.go
│   │   │   ├── script_executor.go  # 脚本→分镜拆解
│   │   │   ├── image_executor.go   # AI 生图
│   │   │   ├── video_executor.go   # AI 生视频
│   │   │   └── audio_executor.go   # TTS/ASR
│   │   ├── context.go              # 执行上下文（节点间数据传递）
│   │   └── event.go                # 事件系统（进度推送）
│   ├── model/                      # 数据模型 (Entity)
│   │   ├── user.go
│   │   ├── project.go
│   │   ├── canvas.go
│   │   ├── workflow_execution.go
│   │   └── ai_task.go
│   ├── repository/                 # 数据访问层
│   │   ├── user_repo.go
│   │   ├── project_repo.go
│   │   ├── canvas_repo.go
│   │   └── execution_repo.go
│   ├── dto/                        # 数据传输对象
│   │   ├── request/
│   │   └── response/
│   └── pkg/                        # 公共工具包
│       ├── llm/                    # LLM 调用封装
│       ├── storage/                # 对象存储封装
│       ├── ffmpeg/                 # FFmpeg 封装
│       └── ws/                     # WebSocket 封装
├── migrations/                     # 数据库迁移
├── configs/
│   └── config.yaml
├── go.mod
└── go.sum
```

### 3.2 核心分层职责

```
┌─────────────────────────────────────────────────────────┐
│  Handler 层 (HTTP 入口)                                  │
│  · 参数校验 (ShouldBindJSON)                             │
│  · 调用 Service                                          │
│  · 统一响应格式 {code, msg, data}                        │
│  · 不包含任何业务逻辑                                     │
├─────────────────────────────────────────────────────────┤
│  Service 层 (业务逻辑)                                    │
│  · 编排多个 Repository                                    │
│  · 事务管理                                               │
│  · 业务规则校验                                           │
│  · 调用 Engine / External API                             │
├─────────────────────────────────────────────────────────┤
│  Engine 层 (工作流引擎 - 核心独立模块)                     │
│  · 与 HTTP 无耦合，可独立测试                              │
│  · Parser: JSON → DAG                                    │
│  · Validator: 图合法性                                    │
│  · Scheduler: 拓扑排序 + 并行调度                         │
│  · Executor: 节点执行策略                                 │
│  · Context: 节点间数据传递                                │
│  · Event: 状态变更事件流                                  │
├─────────────────────────────────────────────────────────┤
│  Repository 层 (数据访问)                                 │
│  · 纯 CRUD，不含业务逻辑                                  │
│  · 接口定义 + 实现分离（方便 mock 测试）                   │
│  · GORM / Raw SQL                                        │
└─────────────────────────────────────────────────────────┘
```

---

## 四、前端分层架构

### 4.1 目录结构

```
web/
├── public/
├── src/
│   ├── main.tsx                        # 入口
│   ├── App.tsx
│   ├── stores/                         # Zustand 状态管理
│   │   ├── canvasStore.ts              # 画布状态（节点/边/视口）
│   │   ├── projectStore.ts             # 项目状态
│   │   ├── executionStore.ts           # 执行状态/进度
│   │   └── authStore.ts               # 用户认证
│   ├── components/
│   │   ├── canvas/                     # 画布相关组件
│   │   │   ├── Canvas.tsx              # 画布主组件
│   │   │   ├── CanvasToolbar.tsx       # 工具栏
│   │   │   └── MiniMap.tsx             # 小地图
│   │   ├── nodes/                      # 节点组件
│   │   │   ├── TextNode.tsx            # 文本节点
│   │   │   ├── ImageNode.tsx           # 图像节点
│   │   │   ├── VideoNode.tsx           # 视频节点
│   │   │   ├── AudioNode.tsx           # 音频节点
│   │   │   ├── ScriptNode.tsx          # 脚本节点
│   │   │   └── BaseNode.tsx            # 节点公共基类
│   │   ├── edges/                      # 连线组件
│   │   │   └── DataFlowEdge.tsx        # 数据流连线
│   │   ├── panels/                     # 侧边面板
│   │   │   ├── NodePropsPanel.tsx      # 节点属性面板
│   │   │   ├── NodeLibrary.tsx         # 节点库
│   │   │   └── ExecutionPanel.tsx      # 执行控制台
│   │   └── layout/                     # 布局组件
│   │       ├── Header.tsx
│   │       ├── Sidebar.tsx
│   │       └── MainLayout.tsx
│   ├── hooks/                          # 自定义 Hooks
│   │   ├── useCanvas.ts               # 画布操作
│   │   ├── useWorkflow.ts             # 工作流执行
│   │   └── useWebSocket.ts            # WebSocket 连接
│   ├── services/                       # API 调用层
│   │   ├── api.ts                      # Axios 实例
│   │   ├── projectApi.ts
│   │   ├── canvasApi.ts
│   │   ├── workflowApi.ts
│   │   └── authApi.ts
│   ├── types/                          # TypeScript 类型定义
│   │   ├── canvas.ts                   # 画布/节点/边类型
│   │   ├── workflow.ts                 # 工作流/执行类型
│   │   ├── project.ts                  # 项目类型
│   │   └── api.ts                      # API 响应类型
│   └── utils/                          # 工具函数
│       ├── nodeFactory.ts              # 节点工厂
│       ├── dagValidator.ts             # 前端 DAG 校验
│       └── exportCanvas.ts            # 画布导出
├── package.json
├── vite.config.ts
└── tsconfig.json
```

### 4.2 前端核心数据流

```
用户操作 (拖拽/连线/改参数)
       ↓
  React Flow 内部状态更新
       ↓
  Zustand canvasStore 同步
       ↓  (自动序列化)
  Canvas JSON (nodes + edges + viewport)
       ↓  (用户点"保存" / 自动保存)
  API → 后端持久化
       ↓  (用户点"执行")
  API → 后端工作流引擎
       ↓  (WebSocket 推送)
  executionStore 更新 → 节点状态 UI 刷新
```

---

## 五、核心数据模型

### 5.1 数据库 ER 图

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│    users     │     │   projects   │     │    canvases      │
├──────────────┤     ├──────────────┤     ├──────────────────┤
│ id           │←────│ user_id      │     │ id               │
│ email        │     │ id           │←────│ project_id       │
│ password_hash│     │ name         │     │ content (JSONB)  │
│ nickname     │     │ description  │     │ version          │
│ avatar_url   │     │ cover_url    │     │ created_at       │
│ created_at   │     │ created_at   │     │ updated_at       │
│ updated_at   │     │ updated_at   │     └──────────────────┘
└──────────────┘     └──────────────┘
                            │
                            │ 1:N
                            ↓
                     ┌──────────────────┐     ┌──────────────────┐
                     │ workflow_execs   │     │   ai_tasks       │
                     ├──────────────────┤     ├──────────────────┤
                     │ id               │←────│ execution_id     │
                     │ project_id       │     │ id               │
                     │ canvas_snapshot  │     │ node_id          │
                     │   (JSONB)        │     │ node_type        │
                     │ status           │     │ model_name       │
                     │   pending/running│     │ status           │
                     │   /done/failed   │     │   pending/running│
                     │ started_at       │     │   /done/failed   │
                     │ finished_at      │     │ input (JSONB)    │
                     │ error_msg        │     │ output (JSONB)   │
                     └──────────────────┘     │ cost_credits     │
                                              │ started_at       │
                                              │ finished_at      │
                                              │ error_msg        │
                                              └──────────────────┘
```

### 5.2 Canvas JSON 结构（核心 DSL）

```typescript
// 前后端共享的类型定义

interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  viewport: { x: number; y: number; zoom: number };
}

interface CanvasNode {
  id: string;                    // 唯一标识
  type: NodeType;                // text | image | video | audio | script
  position: { x: number; y: number };
  data: NodeData;                // 各类型节点各自的数据结构
}

interface CanvasEdge {
  id: string;
  source: string;                // 上游节点 ID
  target: string;                // 下游节点 ID
  sourceHandle: string;          // 上游输出端口
  targetHandle: string;          // 下游输入端口
}

// ---- 各节点类型的数据结构 ----

type NodeData =
  | TextNodeData
  | ImageNodeData
  | VideoNodeData
  | AudioNodeData
  | ScriptNodeData;

interface TextNodeData {
  title: string;
  content: string;               // 文本内容 / prompt
}

interface ImageNodeData {
  title: string;
  mode: 'upload' | 'generate';   // 上传 or AI 生成
  // 生成模式
  model?: string;                 // sd-xl / midjourney-v7 / flux
  prompt?: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  styleRef?: string;              // 风格参考图 URL
  // 上传模式
  fileUrl?: string;
  // 通用
  selectedOutput?: string;        // 用户选中的输出图 URL
  outputs?: string[];             // 生成的多张图 URL
}

interface VideoNodeData {
  title: string;
  mode: 'upload' | 'text2video' | 'image2video';
  model?: string;                 // kling-3.0 / seedance-2.0 / happyhorse
  prompt?: string;
  imageUrl?: string;              // 图生视频的参考图
  duration?: number;              // 秒
  fps?: number;
  fileUrl?: string;
  outputUrl?: string;
}

interface AudioNodeData {
  title: string;
  mode: 'upload' | 'tts' | 'generate';
  model?: string;
  text?: string;                  // TTS 输入文本
  voice?: string;                 // 音色
  fileUrl?: string;
  outputUrl?: string;
}

interface ScriptNodeData {
  title: string;
  mode: 'parse_script';           // MVP 只做一种模式
  scriptContent: string;          // 原始剧本
  // 解析输出（LLM 生成后回填）
  characters?: CharacterDef[];
  shots?: ShotDef[];
}

interface CharacterDef {
  name: string;
  description: string;
  refImageUrl?: string;           // 角色参考图
}

interface ShotDef {
  shotNumber: number;
  duration: string;               // "0-5s"
  sceneDescription: string;       // 场景描述（→ 给生图 prompt）
  cameraAngle: string;            // wide / medium / closeup / extreme_closeup
  movementType?: string;          // 推/拉/摇/移/跟
  lightingMood?: string;          // 自然光/逆光/侧光
  characterAction?: string;       // 角色动作
  dialogue?: string;              // 台词（→ 给 TTS）
  emotionTag?: string;            // 情绪标签
}
```

---

## 六、工作流执行引擎（核心模块详细设计）

### 6.1 执行流程

```
用户点击"执行工作流"
       ↓
前端发送 Canvas JSON → POST /api/workflow/execute
       ↓
后端 Handler → Service → Engine
       ↓
┌─── Engine 执行流程 ────────────────────────────────────────┐
│                                                             │
│  Step 1: Parse (解析)                                       │
│  Canvas JSON → 剥离可视化字段 → WorkflowSchema              │
│                                                             │
│  Step 2: Validate (校验)                                    │
│  · 环路检测 (DFS)                                           │
│  · 孤立节点检测                                             │
│  · 变量引用校验（下游输入是否匹配上游输出）                   │
│                                                             │
│  Step 3: Topological Sort (拓扑排序)                        │
│  WorkflowSchema → ExecutionPlan                             │
│  输出: [[Level0_nodes], [Level1_nodes], ...]                │
│  同一 Level 内的节点可并行执行                               │
│                                                             │
│  Step 4: Schedule & Execute (调度执行)                      │
│  for each level:                                            │
│    启动 goroutine 并行执行该 level 的所有节点                │
│    每个节点:                                                │
│      1. 从 ExecutionContext 取上游输出                       │
│      2. 根据 node.type 路由到对应 Executor                  │
│      3. Executor 调用 AI API / 本地处理                     │
│      4. 将结果写入 ExecutionContext                          │
│      5. 通过 WebSocket 推送节点状态变更事件                   │
│    等待该 level 所有节点完成                                 │
│                                                             │
│  Step 5: Complete                                           │
│  汇总结果，推送完成事件                                      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Executor 接口设计

```go
// 节点执行器接口
type NodeExecutor interface {
    // Execute 执行节点任务
    // ctx: 上下文（含上游输出、配置等）
    // node: 节点定义
    // 返回: 节点输出 + 错误
    Execute(ctx context.Context, node *WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error)
}

// 节点输出
type NodeOutput struct {
    NodeID  string
    Status  TaskStatus  // success / failed
    Data    map[string]interface{}
    // text节点:   { "content": "..." }
    // image节点:  { "images": ["url1", "url2"], "selected": "url1" }
    // video节点:  { "video_url": "..." }
    // audio节点:  { "audio_url": "..." }
    // script节点: { "characters": [...], "shots": [...] }
    Error   string
}

// 执行上下文（节点间数据传递）
type ExecutionContext struct {
    mu     sync.RWMutex
    outputs map[string]*NodeOutput  // nodeID → output
}

func (ec *ExecutionContext) SetOutput(nodeID string, output *NodeOutput) {
    ec.mu.Lock()
    defer ec.mu.Unlock()
    ec.outputs[nodeID] = output
}

func (ec *ExecutionContext) GetOutput(nodeID string) (*NodeOutput, bool) {
    ec.mu.RLock()
    defer ec.mu.RUnlock()
    out, ok := ec.outputs[nodeID]
    return out, ok
}
```

### 6.3 事件系统（WebSocket 推送）

```go
type EventType string

const (
    EventExecutionStart  EventType = "execution.start"
    EventNodeStart       EventType = "node.start"
    EventNodeProgress    EventType = "node.progress"   // 进度百分比
    EventNodeComplete    EventType = "node.complete"
    EventNodeFailed      EventType = "node.failed"
    EventExecutionDone   EventType = "execution.done"
    EventExecutionFailed EventType = "execution.failed"
)

type WorkflowEvent struct {
    ExecutionID string      `json:"executionId"`
    EventType   EventType   `json:"eventType"`
    NodeID      string      `json:"nodeId,omitempty"`
    NodeName    string      `json:"nodeName,omitempty"`
    Data        interface{} `json:"data,omitempty"`
    Timestamp   int64       `json:"timestamp"`
}
```

---

## 七、AI 网关设计

### 7.1 统一抽象层

```
┌──────────────────────────────────────────────────────────┐
│                    AI Gateway                             │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ ImageProvider│ │ VideoProvider│ │ LLMProvider │        │
│  │  Interface  │  │  Interface  │  │  Interface  │        │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘        │
│         │               │               │                │
│  ┌──────▼─────┐  ┌──────▼─────┐  ┌──────▼─────┐        │
│  │ SDXLAdapter │  │KlingAdapter │  │ GPTAdapter  │        │
│  │ MJAdapter   │  │SeedanceAdptr│  │ ClaudeAdptr │        │
│  │ FluxAdapter │  │HappyHorseAd │  │ QwenAdapter │        │
│  └────────────┘  └────────────┘  └────────────┘        │
│                                                          │
│  公共能力:                                                │
│  · 统一请求/响应格式                                      │
│  · 重试策略 (指数退避)                                    │
│  · 超时控制                                               │
│  · 配额/计费                                              │
│  · 结果缓存                                               │
│  · 异步轮询 (视频生成通常需等待)                           │
└──────────────────────────────────────────────────────────┘
```

### 7.2 MVP 阶段接入的模型

| 类型 | 模型 | 接入方式 | 用途 |
|------|------|---------|------|
| LLM | GPT-4o / 通义千问 | OpenAI 兼容 API | 脚本解析、分镜拆解 |
| 图像 | Stable Diffusion XL | ComfyUI / SD WebUI API | AI 生图 |
| 视频 | 可灵 3.0 / Seedance | 官方 API | AI 生视频 |
| 语音 | Edge TTS / Fish Speech | API | TTS 配音 |

---

## 八、API 设计（核心接口）

### 8.1 项目 & 画布

```
POST   /api/projects                    创建项目
GET    /api/projects                    项目列表
GET    /api/projects/:id                项目详情
DELETE /api/projects/:id                删除项目

GET    /api/projects/:id/canvas         获取画布
PUT    /api/projects/:id/canvas         保存画布
```

### 8.2 工作流执行

```
POST   /api/workflow/execute            执行工作流
  Body: { projectId, canvasData }
  Resp: { executionId }

GET    /api/workflow/executions/:id     执行详情
POST   /api/workflow/executions/:id/cancel  取消执行

WS     /api/ws/execution/:id            执行进度 WebSocket
```

### 8.3 AI 任务

```
POST   /api/ai/image/generate           生图
POST   /api/ai/video/generate           生视频
POST   /api/ai/audio/tts                TTS
POST   /api/ai/script/parse             脚本解析
```

### 8.4 用户

```
POST   /api/auth/register               注册
POST   /api/auth/login                  登录
GET    /api/auth/me                     当前用户
```

---

## 九、开发路线图（分阶段交付）

### Phase 1: 画布骨架（第 1-2 周）

```
目标: 画布能拖节点、连线、保存/加载

前端:
  ☐ Vite + React + TS 项目初始化
  ☐ React Flow 画布集成
  ☐ 5种基础节点组件 (简化版，先能拖拽显示)
  ☐ 节点连线功能
  ☐ Zustand Store (canvasState)
  ☐ 画布保存/加载 API 对接

后端:
  ☐ Go + Gin 项目初始化
  ☐ PostgreSQL 连接 + 迁移
  ☐ 用户注册/登录 (JWT)
  ☐ 项目 CRUD
  ☐ 画布保存/加载 (JSONB)
```

### Phase 2: 工作流引擎（第 3-4 周）

```
目标: 点"执行"后能按 DAG 顺序跑通

后端:
  ☐ Canvas JSON → DAG 解析器
  ☐ 拓扑排序 + 并行调度
  ☐ ExecutionContext (节点间数据传递)
  ☐ WebSocket 事件推送
  ☐ 文本节点 Executor (简单透传)
  ☐ 执行记录持久化

前端:
  ☐ 执行控制台 UI
  ☐ WebSocket 连接 + 事件处理
  ☐ 节点状态实时更新 (idle/running/done/failed)
  ☐ 执行进度条
```

### Phase 3: AI 能力接入（第 5-7 周）

```
目标: 跑通 "剧本→分镜→生图→生视频" 完整链路

后端:
  ☐ AI Gateway 统一抽象层
  ☐ LLM Executor (脚本→分镜拆解)
  ☐ Image Executor (SD API 生图)
  ☐ Video Executor (可灵/Seedance 生视频)
  ☐ Audio Executor (TTS)
  ☐ 异步任务轮询机制 (视频生成需等待)
  ☐ 媒体文件存储 (MinIO/OSS)

前端:
  ☐ 脚本节点: 剧本输入 → 分镜表展示
  ☐ 图像节点: prompt输入 → 多图展示 → 选图
  ☐ 视频节点: 参考图 → 视频预览
  ☐ 音频节点: 文本 → 音频播放
  ☐ 节点属性面板 (各类型参数配置)
```

### Phase 4: 打磨体验（第 8-10 周）

```
目标: 可用的产品级体验

  ☐ 节点打组 (Ctrl+G)
  ☐ 工作流模板保存/复用
  ☐ 画布自动保存
  ☐ 节点搜索/快速添加 (/)
  ☐ 快捷键体系
  ☐ 错误处理 & 重试 UI
  ☐ 移动端适配 (基础)
```

---

## 十、技术选型汇总

| 层级 | 选型 | 理由 |
|------|------|------|
| **前端框架** | React 18 + TypeScript | 生态成熟，React Flow 原生支持 |
| **画布引擎** | @xyflow/react | 业界最成熟的节点编辑器库 |
| **状态管理** | Zustand + Immer | 轻量，适合大型画布状态 |
| **UI 组件** | Ant Design 5 | 企业级，开箱即用 |
| **CSS** | TailwindCSS | 快速布局 |
| **构建工具** | Vite | 极速 HMR |
| **后端语言** | Go | 高并发、适合工作流引擎 |
| **后端框架** | Gin | 最流行的 Go Web 框架 |
| **ORM** | GORM | Go 生态最成熟 |
| **数据库** | PostgreSQL 15+ | JSONB 存画布，查询能力强 |
| **缓存** | Redis 7+ | 会话/缓存/轻量队列 |
| **对象存储** | MinIO (自建) / 阿里云 OSS | 媒体文件存储 |
| **实时通信** | WebSocket (gorilla/websocket) | 执行进度推送 |
| **容器化** | Docker Compose | MVP 阶段足够 |
