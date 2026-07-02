package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"libtv/internal/llm"
	"libtv/internal/service"
)

// NodeOutput 节点执行输出
type NodeOutput struct {
	NodeID string                 `json:"nodeId"`
	Status string                 `json:"status"` // success / failed
	Data   map[string]interface{} `json:"data"`
	Error  string                 `json:"error,omitempty"`
}

// ExecutionContext 执行上下文（节点间数据传递）
type ExecutionContext struct {
	mu      sync.RWMutex
	outputs map[string]*NodeOutput
	// upstreamByTarget target 节点 ID -> 上游 source 节点 ID 列表
	// 节点执行器可借此从 execCtx.GetUpstreamSources(n.ID) 拿到所有上游节点 ID，
	// 再配合 execCtx.GetNodeData(...) 拿到上游节点的原始 data。
	upstreamByTarget map[string][]string
	// nodeDataByID 全图所有节点的原始 data（来自 plan.Schema.Nodes），
	// 即便是 single / downstream 模式被裁掉的节点，data 也保留在此供执行器参考。
	nodeDataByID map[string]json.RawMessage
	// projectID 项目ID，用于确定存储路径
	projectID string
}

func NewExecutionContext() *ExecutionContext {
	return &ExecutionContext{
		outputs:          make(map[string]*NodeOutput),
		upstreamByTarget: make(map[string][]string),
		nodeDataByID:     make(map[string]json.RawMessage),
		projectID:        "",
	}
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

// SetUpstreamMap 设置全图的上游关系（target -> [source, ...]）。
// 由调度器在执行前一次性写入，节点执行器通过 GetUpstreamSources 查自己节点的上游。
func (ec *ExecutionContext) SetUpstreamMap(m map[string][]string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.upstreamByTarget = m
}

// GetUpstreamSources 拿指定节点的所有上游 source 节点 ID（按 connections 顺序）。
func (ec *ExecutionContext) GetUpstreamSources(targetNodeID string) []string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	src := ec.upstreamByTarget[targetNodeID]
	out := make([]string, len(src))
	copy(out, src)
	return out
}

// SetNodeDataMap 一次性写入全图所有节点的原始 data，让执行器可以读到上游节点 data。
func (ec *ExecutionContext) SetNodeDataMap(m map[string]json.RawMessage) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.nodeDataByID = m
}

// GetNodeData 拿指定节点的原始 data（json.RawMessage）。single / downstream 模式下，
// 节点本身不一定被执行，但其 data 已保存在此，可供其他节点作为输入参考。
func (ec *ExecutionContext) GetNodeData(nodeID string) (json.RawMessage, bool) {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	data, ok := ec.nodeDataByID[nodeID]
	return data, ok
}

// SetProjectID 设置项目ID
func (ec *ExecutionContext) SetProjectID(projectID string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.projectID = projectID
}

// GetProjectID 获取项目ID
func (ec *ExecutionContext) GetProjectID() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.projectID
}

// NodeExecutor 节点执行器接口
type NodeExecutor interface {
	Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error)
}

// ExecutorRegistry 执行器注册表
type ExecutorRegistry struct {
	executors map[string]NodeExecutor
}

func NewExecutorRegistry() *ExecutorRegistry {
	return &ExecutorRegistry{
		executors: make(map[string]NodeExecutor),
	}
}

func (r *ExecutorRegistry) Register(nodeType string, executor NodeExecutor) {
	r.executors[nodeType] = executor
}

func (r *ExecutorRegistry) Get(nodeType string) (NodeExecutor, bool) {
	exec, ok := r.executors[nodeType]
	return exec, ok
}

// WorkflowEngine 工作流执行引擎
type WorkflowEngine struct {
	registry *ExecutorRegistry
	// lastOutputs 保留给 sync writer 同步使用
	lastOutputs map[string]*NodeOutput
	// subscribers 多播：每个 SSE 连接订阅一份
	mu          sync.Mutex
	subscribers map[int64]map[chan WorkflowEvent]struct{} // executionID -> set of chans
}

func NewWorkflowEngine(registry *ExecutorRegistry) *WorkflowEngine {
	return &WorkflowEngine{
		registry:    registry,
		subscribers: make(map[int64]map[chan WorkflowEvent]struct{}),
	}
}

// Subscribe 订阅某个 execution 的事件。返回只读 channel；调用方在断开时调 Unsubscribe。
func (e *WorkflowEngine) Subscribe(executionID int64) <-chan WorkflowEvent {
	ch := make(chan WorkflowEvent, 64)
	e.mu.Lock()
	if e.subscribers[executionID] == nil {
		e.subscribers[executionID] = make(map[chan WorkflowEvent]struct{})
	}
	e.subscribers[executionID][ch] = struct{}{}
	e.mu.Unlock()
	return ch
}

// Unsubscribe 取消订阅并关闭 channel
func (e *WorkflowEngine) Unsubscribe(executionID int64, ch <-chan WorkflowEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	subs := e.subscribers[executionID]
	if subs == nil {
		return
	}
	for c := range subs {
		if c == ch {
			delete(subs, c)
			close(c)
			break
		}
	}
	if len(subs) == 0 {
		delete(e.subscribers, executionID)
	}
}

// LastOutputs 返回最近一次 Execute 收集到的所有节点输出
func (e *WorkflowEngine) LastOutputs() map[string]*NodeOutput {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make(map[string]*NodeOutput, len(e.lastOutputs))
	for k, v := range e.lastOutputs {
		out[k] = v
	}
	return out
}

// Execute 执行工作流
func (e *WorkflowEngine) Execute(ctx context.Context, plan *ExecutionPlan, executionID int64, projectID string) error {
	log.Printf("[Engine] Execute start: executionID=%d, projectID=%s, plan levels=%d, totalNodes=%d", executionID, projectID, len(plan.Levels), len(plan.Schema.Nodes))
	execCtx := NewExecutionContext()

	// 设置项目ID，供节点执行器使用（如ImageExecutor需要确定存储路径）
	execCtx.SetProjectID(projectID)

	// 构造上游映射表（target -> [source, ...]），供 ScriptExecutor 等需要读上游的节点使用
	upstreamByTarget := make(map[string][]string, len(plan.Schema.Connections))
	for _, c := range plan.Schema.Connections {
		upstreamByTarget[c.Target] = append(upstreamByTarget[c.Target], c.Source)
	}
	execCtx.SetUpstreamMap(upstreamByTarget)

	// 把全图所有节点的原始 data 写进 execCtx（即便被 single / downstream 模式裁掉）
	// 让执行器可以读到上游节点的最新 data（来自画布，已包含上一次执行结果）
	nodeDataByID := make(map[string]json.RawMessage, len(plan.Schema.Nodes))
	for _, n := range plan.Schema.Nodes {
		nodeDataByID[n.ID] = n.Data
	}
	execCtx.SetNodeDataMap(nodeDataByID)

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionStart,
		Timestamp:   time.Now().UnixMilli(),
	})

	// 收集本次执行的所有输出，供外部回写画布
	outputs := make(map[string]*NodeOutput)

	// 打印 plan 概览，方便排查"是不是在重跑上游"
	for levelIdx, level := range plan.Levels {
		ids := make([]string, 0, len(level))
		for _, n := range level {
			ids = append(ids, n.ID+":"+n.Type)
		}
		log.Printf("[Engine] plan: levels=%d, level[%d] nodes=%v", len(plan.Levels), levelIdx, ids)
	}

	for levelIdx, level := range plan.Levels {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var levelErrors []error

		for _, node := range level {
			wg.Add(1)
			go func(n WorkflowNode) {
				defer wg.Done()

				execStart := time.Now()
				// 进度心跳：每 10s 推送一次 node_progress，让前端显示耗时
				// 节点真正完成 / 失败时 cancel 掉
				heartbeatCtx, stopHeartbeat := context.WithCancel(ctx)
				defer stopHeartbeat()
				go func() {
					t := time.NewTicker(10 * time.Second)
					defer t.Stop()
					for {
						select {
						case <-heartbeatCtx.Done():
							return
						case <-t.C:
							elapsed := time.Since(execStart)
							log.Printf("[Engine] node %s (%s) still running, elapsed=%v", n.ID, n.Type, elapsed.Round(time.Second))
							e.emit(WorkflowEvent{
								ExecutionID: executionID,
								EventType:   EventNodeProgress,
								NodeID:      n.ID,
								NodeName:    n.Type,
								Data: map[string]interface{}{
									"elapsed":   elapsed.Seconds(),
									"elapsedMs": elapsed.Milliseconds(),
									"message":   fmt.Sprintf("已运行 %ds", int(elapsed.Seconds())),
								},
								Timestamp: time.Now().UnixMilli(),
							})
						}
					}
				}()

				e.emit(WorkflowEvent{
					ExecutionID: executionID,
					EventType:   EventNodeStart,
					NodeID:      n.ID,
					NodeName:    n.Type,
					Timestamp:   time.Now().UnixMilli(),
				})

				executor, ok := e.registry.Get(n.Type)
				if !ok {
					err := fmt.Errorf("no executor for node type: %s", n.Type)
					log.Printf("[Engine] no executor for nodeID=%s type=%s", n.ID, n.Type)
					mu.Lock()
					levelErrors = append(levelErrors, err)
					mu.Unlock()

					execCtx.SetOutput(n.ID, &NodeOutput{
						NodeID: n.ID,
						Status: "failed",
						Error:  err.Error(),
					})

					e.emit(WorkflowEvent{
						ExecutionID: executionID,
						EventType:   EventNodeFailed,
						NodeID:      n.ID,
						NodeName:    n.Type,
						Data:        map[string]interface{}{"error": err.Error()},
						Timestamp:   time.Now().UnixMilli(),
					})
					return
				}

				output, err := executor.Execute(ctx, n, execCtx)
				if err != nil {
					log.Printf("[Engine] executor error nodeID=%s type=%s err=%v", n.ID, n.Type, err)
					mu.Lock()
					levelErrors = append(levelErrors, err)
					mu.Unlock()

					execCtx.SetOutput(n.ID, &NodeOutput{
						NodeID: n.ID,
						Status: "failed",
						Error:  err.Error(),
					})

					e.emit(WorkflowEvent{
						ExecutionID: executionID,
						EventType:   EventNodeFailed,
						NodeID:      n.ID,
						NodeName:    n.Type,
						Data:        map[string]interface{}{"error": err.Error()},
						Timestamp:   time.Now().UnixMilli(),
					})
					return
				}

				execCtx.SetOutput(n.ID, output)

				// 收集 output 供外部回写
				mu.Lock()
				outputs[n.ID] = output
				mu.Unlock()

				e.emit(WorkflowEvent{
					ExecutionID: executionID,
					EventType:   EventNodeComplete,
					NodeID:      n.ID,
					NodeName:    n.Type,
					Data:        output.Data,
					Timestamp:   time.Now().UnixMilli(),
				})
			}(node)
		}

		wg.Wait()

		if len(levelErrors) > 0 {
			e.emit(WorkflowEvent{
				ExecutionID: executionID,
				EventType:   EventExecutionFailed,
				Data:        map[string]interface{}{"error": fmt.Sprintf("level %d failed: %v", levelIdx, levelErrors)},
				Timestamp:   time.Now().UnixMilli(),
			})
			// 即使失败也保存已收集的输出
			e.saveOutputs(outputs)
			return fmt.Errorf("level %d failed: %v", levelIdx, levelErrors)
		}
	}

	e.saveOutputs(outputs)

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionDone,
		Timestamp:   time.Now().UnixMilli(),
	})

	return nil
}

// saveOutputs 把本次执行的所有输出存到 engine.lastOutputs
func (e *WorkflowEngine) saveOutputs(outputs map[string]*NodeOutput) {
	if len(outputs) == 0 {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastOutputs = outputs
}

func (e *WorkflowEngine) emit(event WorkflowEvent) {
	if event.Type == "" {
		event.Type = eventTypeToWSName(event.EventType)
	}
	e.mu.Lock()
	subs := e.subscribers[event.ExecutionID]
	if len(subs) == 0 {
		e.mu.Unlock()
		return
	}
	// fan-out to all subscribers; drop on full (避免慢消费者阻塞引擎)
	for ch := range subs {
		select {
		case ch <- event:
		default:
			// channel full, drop for this subscriber
		}
	}
	e.mu.Unlock()
}

// --- 事件系统 ---

type EventType string

const (
	EventExecutionStart  EventType = "execution.start"
	EventNodeStart       EventType = "node.start"
	EventNodeProgress    EventType = "node.progress"
	EventNodeComplete    EventType = "node.complete"
	EventNodeFailed      EventType = "node.failed"
	EventExecutionDone   EventType = "execution.done"
	EventExecutionFailed EventType = "execution.failed"
)

type WorkflowEvent struct {
	// Type 前端约定的 WSEventType 命名（如 node_completed / execution_started）
	Type string `json:"type"`
	// EventType 内部用的事件名（如 node.complete / execution.start）
	EventType   EventType   `json:"eventType"`
	ExecutionID int64       `json:"executionId"`
	NodeID      string      `json:"nodeId,omitempty"`
	NodeName    string      `json:"nodeName,omitempty"`
	Data        interface{} `json:"data,omitempty"`
	Timestamp   int64       `json:"timestamp"`
}

// eventTypeToWSName 把内部 EventType 映射到前端约定的 WSEventType
func eventTypeToWSName(t EventType) string {
	switch t {
	case EventExecutionStart:
		return "execution_started"
	case EventExecutionDone:
		return "execution_completed"
	case EventExecutionFailed:
		return "execution_failed"
	case EventNodeStart:
		return "node_started"
	case EventNodeProgress:
		return "node_progress"
	case EventNodeComplete:
		return "node_completed"
	case EventNodeFailed:
		return "node_failed"
	default:
		return string(t)
	}
}

// --- 默认执行器 ---

// TextExecutor 文本节点执行器（调用 LLM 生成故事剧本文本）
type TextExecutor struct {
	llmClient *llm.Client
}

// NewTextExecutor 创建文本执行器
func NewTextExecutor(client *llm.Client) *TextExecutor {
	return &TextExecutor{llmClient: client}
}

func (t *TextExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Content string `json:"content"`
		Prompt  string `json:"prompt"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse text node data: %w", err)
	}

	// 优先使用 prompt（用户输入的提示词），如果为空则用 content
	userInput := stripMentionMarkers(data.Prompt)
	if userInput == "" {
		userInput = data.Content
	}

	// 如果没有用户输入，直接透传
	if userInput == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data:   map[string]interface{}{"content": ""},
		}, nil
	}

	// 调用 LLM 生成故事文本
	storyContent, err := llm.GenerateStory(ctx, t.llmClient, userInput)
	if err != nil {
		return nil, fmt.Errorf("generate story: %w", err)
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data:   map[string]interface{}{"content": storyContent},
	}, nil
}

// ScriptExecutor 脚本节点执行器：用户输入 prompt + 上游文本 → LLM 生成分镜剧本
type ScriptExecutor struct {
	llmClient *llm.Client
}

// NewScriptExecutor 创建脚本执行器
func NewScriptExecutor(client *llm.Client) *ScriptExecutor {
	return &ScriptExecutor{llmClient: client}
}

func (s *ScriptExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Prompt        string `json:"prompt"`
		ScriptContent string `json:"scriptContent"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse script node data: %w", err)
	}

	// 收集上游节点已保存的 data（来自画布，不依赖上游是否在本轮被执行）
	// 优先读上游的 data.content（持久化结果），其次尝试读本轮 execCtx.output（罕见）
	var upstreamText strings.Builder
	for _, srcID := range execCtx.GetUpstreamSources(node.ID) {
		// 1) 优先：从已保存的画布 data 读 content（即便上游没跑也能拿到上次结果）
		if raw, ok := execCtx.GetNodeData(srcID); ok && len(raw) > 0 {
			var nd struct {
				Content string `json:"content"`
			}
			if err := json.Unmarshal(raw, &nd); err == nil && nd.Content != "" {
				if upstreamText.Len() > 0 {
					upstreamText.WriteString("\n\n")
				}
				upstreamText.WriteString(nd.Content)
				continue
			}
		}
		// 2) 兜底：读本轮执行输出
		if out, ok := execCtx.GetOutput(srcID); ok && out != nil {
			if content, ok := out.Data["content"].(string); ok && content != "" {
				if upstreamText.Len() > 0 {
					upstreamText.WriteString("\n\n")
				}
				upstreamText.WriteString(content)
			}
		}
	}
	material := truncateStr(upstreamText.String(), 3000)

	// 既没有上游文本也没有用户 prompt：透传保留的 scriptContent
	if material == "" && data.Prompt == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"scriptContent": data.ScriptContent,
				"characters":    []interface{}{},
				"scenes":        []interface{}{},
				"props":         []interface{}{},
				"shots":         []interface{}{},
			},
		}, nil
	}

	// 没有 LLM client 时（MVP）：把上游文本当作剧本正文兜底
	if s.llmClient == nil {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"scriptContent": material,
				"characters":    []interface{}{},
				"scenes":        []interface{}{},
				"props":         []interface{}{},
				"shots":         []interface{}{},
			},
		}, nil
	}

	// 清理 prompt 文本里的 [[m:ID]] 占位符（前端 @ 引用渲染标记，LLM 看了会困惑）
	cleanedPrompt := stripMentionMarkers(data.Prompt)

	// 把用户 prompt 作为创作方向附加在素材末尾
	fullInput := material
	if cleanedPrompt != "" {
		if fullInput != "" {
			fullInput += "\n\n[创作方向]\n" + cleanedPrompt
		} else {
			fullInput = cleanedPrompt
		}
	}

	log.Printf("[ScriptExecutor] nodeID=%s upstreamChars=%d promptChars=%d fullInputChars=%d", node.ID, len(material), len(cleanedPrompt), len(fullInput))
	result, err := llm.GenerateScript(ctx, s.llmClient, fullInput)
	if err != nil {
		return nil, fmt.Errorf("generate script: %w", err)
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"scriptContent": result.ScriptContent,
			"characters":    toAnySlice(result.Characters),
			"scenes":        toAnySlice(result.Scenes),
			"props":         toAnySlice(result.Props),
			"shots":         toAnySlice(result.Shots),
		},
	}, nil
}

// toAnySlice 把结构体切片转成 interface{} 切片，方便写进 map[string]interface{}
func toAnySlice[T any](s []T) []interface{} {
	out := make([]interface{}, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

// truncateStr 把字符串截断到 max 字符（按 rune 计，避免切到中文中间）。
// 超过 max 会在末尾追加 "...[truncated]"，方便 LLM 知道这是被截断的素材。
func truncateStr(s string, max int) string {
	if max <= 0 || len([]rune(s)) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + "\n...[truncated]"
}

// mentionMarkerRe 匹配前端 @ 引用占位符 [[m:<id>]]，id 是字母数字随机串
var mentionMarkerRe = regexp.MustCompile(`\[\[m:[A-Za-z0-9_]+\]\]`)

// stripMentionMarkers 把 prompt 文本里的 [[m:ID]] 占位符去掉（它们是前端渲染标记，
// LLM 看了会当成垃圾文本）。
func stripMentionMarkers(s string) string {
	if s == "" {
		return s
	}
	return strings.TrimSpace(mentionMarkerRe.ReplaceAllString(s, ""))
}

// getAssetTypeFromNodeID 从节点 ID 中提取资产类型
// 节点 ID 格式：{类型}-{资产名}-{脚本节点ID}
// 例如："角色-小明-node123"、"场景-教室-node123"、"道具-椅子-node123"
func getAssetTypeFromNodeID(nodeID string) string {
	if strings.HasPrefix(nodeID, "角色-") {
		return "character"
	} else if strings.HasPrefix(nodeID, "场景-") {
		return "scene"
	} else if strings.HasPrefix(nodeID, "道具-") {
		return "prop"
	}
	return "" // 普通图片节点
}

// ImageExecutor 图像节点执行器(调用硅基流动 Kolors API)
type ImageExecutor struct {
	imageClient      *llm.ImageClient
	modelManager     *llm.ModelManager
	fileUploadService *service.FileUploadService
}

// NewImageExecutor 创建图像执行器
func NewImageExecutor(client *llm.ImageClient, modelManager *llm.ModelManager, fileUploadService *service.FileUploadService) *ImageExecutor {
	return &ImageExecutor{
		imageClient:      client,
		modelManager:     modelManager,
		fileUploadService: fileUploadService,
	}
}

func (i *ImageExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode   string `json:"mode"`
		Prompt string `json:"prompt"`
		Model  string `json:"model"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse image node data: %w", err)
	}

	// 没有提示词时直接返回空结果
	if data.Prompt == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"imageUrl": "",
			},
		}, nil
	}

	// 没有图像客户端时(MVP 阶段):透传返回空 URL
	if i.imageClient == nil {
		log.Printf("[ImageExecutor] no imageClient, returning empty imageUrl")
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"imageUrl": "",
			},
		}, nil
	}

	// ✅ 尺寸参数优先级：
	// 1. 节点数据中的 width/height（用户通过图片节点编辑弹窗设置的）
	// 2. 模型配置中的默认参数（models.yaml 中的 parameters.width/height）
	// 3. 系统默认值 1024x1024
	var width, height int

	// 优先使用节点数据中的尺寸
	if data.Width > 0 && data.Height > 0 {
		width = data.Width
		height = data.Height
	} else if i.modelManager != nil && data.Model != "" {
		// 否则尝试从模型配置中读取默认尺寸
		modelConfig := i.modelManager.FindModelByID(data.Model)
		if modelConfig != nil {
			if w, ok := modelConfig.Parameters["width"].(int); ok && w > 0 {
				width = w
			}
			if h, ok := modelConfig.Parameters["height"].(int); ok && h > 0 {
				height = h
			}
		}
	}

	// 如果仍然没有尺寸，使用系统默认值
	if width == 0 || height == 0 {
		width = 1024
		height = 1024
	}

	size := fmt.Sprintf("%dx%d", width, height)

	// 清理提示词中的占位符
	cleanedPrompt := stripMentionMarkers(data.Prompt)

	// ✅ 根据节点 ID 提取资产类型，使用统一的提示词构建函数
	assetType := getAssetTypeFromNodeID(node.ID)
	finalPrompt := llm.BuildAssetImagePrompt(assetType, cleanedPrompt)

	if assetType != "" {
		log.Printf("[ImageExecutor] 检测到资产节点: nodeID=%s assetType=%s (视图要求由脚本节点生成分镜时自动添加)", node.ID, assetType)
	} else {
		log.Printf("[ImageExecutor] 普通图片节点: nodeID=%s", node.ID)
	}

	// 确定使用的模型 ID（传递给硅基流动 API）
	// 前端传递的是 model.ID（如 "kolors-default"），需要转换为 model_id（如 "Kwai-Kolors/Kolors"）
	apiModelID := "Kwai-Kolors/Kolors" // 默认值

	if data.Model != "" && i.modelManager != nil {
		// 根据 model.ID 查找模型配置
		modelConfig := i.modelManager.FindModelByID(data.Model)
		if modelConfig != nil && modelConfig.ModelID != "" {
			apiModelID = modelConfig.ModelID
			log.Printf("[ImageExecutor] 找到模型配置: ID=%s -> ModelID=%s", data.Model, apiModelID)
		} else {
			log.Printf("[ImageExecutor] 未找到模型配置或 ModelID 为空: modelID=%s，使用默认模型", data.Model)
		}
	}

	log.Printf("[ImageExecutor] nodeID=%s promptLen=%d model=%s apiModel=%s size=%s", node.ID, len(finalPrompt), data.Model, apiModelID, size)

	// 调用图像生成 API
	siliconflowURL, err := i.imageClient.GenerateImageWithModel(ctx, apiModelID, finalPrompt, size)
	if err != nil {
		return nil, fmt.Errorf("generate image: %w", err)
	}

	// ✅ 下载硅基流动图片并使用 FileUploadService 上传
	ownURL, err := i.downloadAndUpload(ctx, siliconflowURL, node.ID, execCtx.GetProjectID())
	if err != nil {
		log.Printf("[ImageExecutor] 下载上传失败，使用原始URL: %v", err)
		// 如果失败，仍然返回原始URL，确保功能可用
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"imageUrl": siliconflowURL,
			},
		}, nil
	}

	log.Printf("[ImageExecutor] 图片上传成功: siliconflowURL=%s -> ownURL=%s", siliconflowURL, ownURL)

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"imageUrl": ownURL,
		},
	}, nil
}

// downloadAndUpload 下载硅基流动图片并使用 FileUploadService 上传（复用哈希去重等逻辑）
func (i *ImageExecutor) downloadAndUpload(ctx context.Context, siliconflowURL string, nodeID string, projectID string) (string, error) {
	// 1. 下载图片
	log.Printf("[ImageExecutor] 开始下载图片: url=%s projectID=%s nodeID=%s", siliconflowURL, projectID, nodeID)

	httpClient := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := httpClient.Get(siliconflowURL)
	if err != nil {
		return "", fmt.Errorf("download image from siliconflow: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download image failed: status=%d", resp.StatusCode)
	}

	// 2. 使用 FileUploadService 上传（复用哈希去重、路径构建、URL生成等逻辑）
	result, err := i.fileUploadService.UploadFromReader(resp.Body, resp.ContentLength, "image.png", service.UploadOptions{
		Dir:          "canvas",
		ProjectID:    projectID,
		DefaultExt:   ".png",
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		return "", fmt.Errorf("upload image: %w", err)
	}

	log.Printf("[ImageExecutor] 图片上传成功: objectName=%s url=%s cached=%v", result.ObjectName, result.URL, result.Cached)

	return result.URL, nil
}

// VideoExecutor 视频节点执行器（MVP: 透传，后续接入可灵/Seedance）
type VideoExecutor struct{}

func (v *VideoExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode   string `json:"mode"`
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse video node data: %w", err)
	}
	// TODO: 调用可灵/Seedance API 生视频
	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"mode":      data.Mode,
			"prompt":    data.Prompt,
			"video_url": "",
		},
	}, nil
}

// AudioExecutor 音频节点执行器（MVP: 透传，后续接入 TTS）
type AudioExecutor struct{}

func (a *AudioExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode string `json:"mode"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse audio node data: %w", err)
	}
	// TODO: 调用 TTS API
	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"mode":       data.Mode,
			"text":       data.Text,
			"audio_url":  "",
		},
	}, nil
}

// NewDefaultRegistry 创建默认执行器注册表
func NewDefaultRegistry(llmClient *llm.Client, imageClient *llm.ImageClient, modelManager *llm.ModelManager, fileUploadService *service.FileUploadService) *ExecutorRegistry {
	registry := NewExecutorRegistry()
	registry.Register("text", NewTextExecutor(llmClient))
	registry.Register("script", NewScriptExecutor(llmClient))
	registry.Register("image", NewImageExecutor(imageClient, modelManager, fileUploadService))
	registry.Register("video", &VideoExecutor{})
	registry.Register("audio", &AudioExecutor{})
	return registry
}
