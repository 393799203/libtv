package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
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
	// userID 项目属主用户ID，画布文件存到 users/<userID>/canvas/<projectID>/
	userID string
}

func NewExecutionContext() *ExecutionContext {
	return &ExecutionContext{
		outputs:          make(map[string]*NodeOutput),
		upstreamByTarget: make(map[string][]string),
		nodeDataByID:     make(map[string]json.RawMessage),
		projectID:        "",
		userID:           "",
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

// SetUserID 设置项目属主用户ID
func (ec *ExecutionContext) SetUserID(userID string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.userID = userID
}

// GetUserID 获取项目属主用户ID（执行器扣费用）
func (ec *ExecutionContext) GetUserID() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.userID
}

// GetCanvasDir 返回画布文件的存储目录前缀：
// 有 userID 时存 users/<userID>/canvas（落到用户目录，删用户时级联清理），
// 否则降级存公共 canvas 目录（历史兼容）
func (ec *ExecutionContext) GetCanvasDir() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	if ec.userID != "" {
		return "users/" + ec.userID + "/canvas"
	}
	return "canvas"
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

// Execute 执行工作流（userID 为项目属主，画布文件存到 users/<userID>/canvas/<projectID>/）
func (e *WorkflowEngine) Execute(ctx context.Context, plan *ExecutionPlan, executionID int64, projectID string, userID string) error {
	log.Printf("[Engine] Execute start: executionID=%d, projectID=%s, userID=%s, plan levels=%d, totalNodes=%d", executionID, projectID, userID, len(plan.Levels), len(plan.Schema.Nodes))
	execCtx := NewExecutionContext()

	// 设置项目ID与属主用户ID，供节点执行器使用（确定存储路径）
	execCtx.SetProjectID(projectID)
	execCtx.SetUserID(userID)

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
	biller    *service.BillingService
}

// NewTextExecutor 创建文本执行器
func NewTextExecutor(client *llm.Client, biller *service.BillingService) *TextExecutor {
	return &TextExecutor{llmClient: client, biller: biller}
}

func (t *TextExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Content string `json:"content"`
		Prompt  string `json:"prompt"`
		Model   string `json:"model"`
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

	// 扣费校验：通过后才调用 LLM（账单记录模型与场景）
	if _, err := t.biller.Charge(ctx, execCtx.GetUserID(), service.BillingActionStory, data.Model, "故事生成"); err != nil {
		return nil, err
	}

	// 调用 LLM 生成故事文本（直接使用data.Model作为model_id）
	storyContent, err := llm.GenerateStory(ctx, t.llmClient, userInput, data.Model)
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
	biller    *service.BillingService
}

// NewScriptExecutor 创建脚本执行器
func NewScriptExecutor(client *llm.Client, biller *service.BillingService) *ScriptExecutor {
	return &ScriptExecutor{llmClient: client, biller: biller}
}

func (s *ScriptExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Prompt        string          `json:"prompt"`
		Model         string          `json:"model"`
		ScriptContent string          `json:"scriptContent"`
		Mentions      json.RawMessage `json:"mentions"` // ✅ 添加 Mentions 字段，用于用户明确@引用的上游节点
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse script node data: %w", err)
	}

	// ✅ 解析 mentions 字段，提取用户明确@引用的节点ID
	// 根据nodeId从节点data中提取完整content，而不是使用截断的textSnippet（前端预览用）
	var upstreamText strings.Builder
	var mentions []struct {
		NodeID      string `json:"nodeId"`
		NodeType    string `json:"nodeType"`
		TextSnippet string `json:"textSnippet"` // 前端预览用（后端不使用）
	}
	// ✅ 记录用户@引用了哪些文本节点，用于错误提示
	var referencedTextNodes []string // 引用的文本节点ID列表
	if err := json.Unmarshal(data.Mentions, &mentions); err == nil {
		for _, m := range mentions {
			// ✅ 只处理用户明确@引用的文本节点
			if m.NodeType == "text" {
				referencedTextNodes = append(referencedTextNodes, m.NodeID)
				// ✅ 根据nodeId从节点data中提取完整content（支持实时更新）
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						Content string `json:"content"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.Content != "" {
						if upstreamText.Len() > 0 {
							upstreamText.WriteString("\n\n")
						}
						upstreamText.WriteString(nd.Content) // ✅ 完整剧本正文（不截断）
					}
				}
			}
		}
	}
	material := upstreamText.String() // ✅ 直接使用完整内容（不截断）

	// ✅ 如果用户@引用了文本节点，但提取不到任何剧本内容，返回错误提示
	if len(referencedTextNodes) > 0 && material == "" {
		return nil, fmt.Errorf("您引用的上游剧本节点没有内容，请确保剧本节点已生成或上传剧本内容（引用的节点ID: %s）", strings.Join(referencedTextNodes, ", "))
	}

	// ✅ 检查用户是否连接了上游剧本节点但没有@引用
	// 场景1：上游输入栏有剧本节点，但提示词中没有@引用
	upstreamSources := execCtx.GetUpstreamSources(node.ID)
	var hasUpstreamTextNode bool // 是否连接了上游text节点
	for _, srcID := range upstreamSources {
		if raw, ok := execCtx.GetNodeData(srcID); ok && len(raw) > 0 {
			var nd struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(raw, &nd); err == nil && nd.Type == "text" {
				hasUpstreamTextNode = true
				break
			}
		}
	}
	// ✅ 如果连接了上游text节点，但没有@引用任何text节点，返回错误提示
	if hasUpstreamTextNode && len(referencedTextNodes) == 0 {
		return nil, fmt.Errorf("您已连接上游剧本节点，但未在提示词中通过@引用使用剧本内容，请点击上游输入栏插入@引用")
	}

	// ✅ 场景2：没有连接任何上游节点，也没有输入提示词
	if len(upstreamSources) == 0 && data.Prompt == "" {
		return nil, fmt.Errorf("请连接上游剧本节点并在提示词中通过@引用，或直接输入创作提示词")
	}

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

	log.Printf("[ScriptExecutor] nodeID=%s upstreamChars=%d promptChars=%d fullInputChars=%d model=%s", node.ID, len(material), len(cleanedPrompt), len(fullInput), data.Model)
	// 扣费校验：通过后才调用 LLM（账单记录模型与场景）
	if _, err := s.biller.Charge(ctx, execCtx.GetUserID(), service.BillingActionScript, data.Model, "分镜剧本生成"); err != nil {
		return nil, err
	}
	// 调用 LLM 生成分镜剧本（直接使用data.Model作为model_id）
	result, err := llm.GenerateScript(ctx, s.llmClient, fullInput, data.Model)
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

// ImageExecutor 图像节点执行器（调用图像生成API）
type ImageExecutor struct {
	imageClient       *llm.ImageClient
	modelManager      *llm.ModelManager
	fileUploadService *service.FileUploadService
	biller            *service.BillingService
}

// NewImageExecutor 创建图像执行器
func NewImageExecutor(client *llm.ImageClient, modelManager *llm.ModelManager, fileUploadService *service.FileUploadService, biller *service.BillingService) *ImageExecutor {
	return &ImageExecutor{
		imageClient:       client,
		modelManager:      modelManager,
		fileUploadService: fileUploadService,
		biller:            biller,
	}
}

func (i *ImageExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode        string          `json:"mode"`
		Prompt      string          `json:"prompt"`
		Model       string          `json:"model"`
		Resolution  string          `json:"resolution"`  // 清晰度：1K/2K/4K
		AspectRatio string          `json:"aspectRatio"` // 比例：16:9/9:16/1:1等
		Quality     string          `json:"quality"`     // 画质：低画质/标准画质/高画质
		Count       int             `json:"count"`       // 生成数量
		Mentions    json.RawMessage `json:"mentions"`    // ✅ 添加 Mentions 字段，用于用户明确@引用的上游节点
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse image node data: %w", err)
	}

	// ✅ 解析 mentions 字段，提取用户明确@引用的节点ID
	// 根据nodeId从节点data中提取完整imageUrl，而不是直接使用mentions中的imageUrl（前端预览用）
	var styleImageURLs []string     // 风格图：只提取画风/色彩/视觉风格
	var referenceImageURLs []string // 普通参考图：保持主体结构进行修改
	var mentions []struct {
		ID       string `json:"id"`
		NodeID   string `json:"nodeId"`
		NodeType string `json:"nodeType"`
		ImageUrl string `json:"imageUrl"` // 前端预览用（后端不使用）
	}

	// ✅ 详细日志：打印mentions字段内容（用于调试图生图判断逻辑）
	log.Printf("[ImageExecutor] ========== 图生图判断逻辑（开始） ========== ")
	log.Printf("[ImageExecutor] 当前节点ID: %s", node.ID)
	log.Printf("[ImageExecutor] data.Mentions字段: %s", string(data.Mentions))

	if err := json.Unmarshal(data.Mentions, &mentions); err == nil {
		// 防御：只保留 prompt 中实际存在的 [[m:xxx]] 对应的 mentions
		validMentions := mentions[:0]
		for _, m := range mentions {
			marker := fmt.Sprintf("[[m:%s]]", m.ID)
			if m.ID != "" && !strings.Contains(data.Prompt, marker) {
				log.Printf("[ImageExecutor] ⚠️ 跳过残留mention: id=%s nodeId=%s type=%s (prompt中不存在)", m.ID, m.NodeID, m.NodeType)
				continue
			}
			validMentions = append(validMentions, m)
		}
		mentions = validMentions

		log.Printf("[ImageExecutor] mentions解析成功，找到%d个引用", len(mentions))
		for idx, m := range mentions {
			log.Printf("[ImageExecutor] mentions[%d]: nodeId=%s nodeType=%s imageUrl=%s", idx, m.NodeID, m.NodeType, m.ImageUrl)
			// ✅ 只处理用户明确@引用的图片节点
			if m.NodeType == "image" {
				// ✅ 根据nodeId从节点data中提取完整imageUrl（支持实时更新）
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						ImageUrl string `json:"imageUrl"`
						StyleId  string `json:"styleId"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.ImageUrl != "" {
						// 区分风格图（ID以style-开头或有styleId字段）和普通参考图
						if strings.HasPrefix(m.NodeID, "style-") || nd.StyleId != "" {
							styleImageURLs = append(styleImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] 🎨 从@引用的风格图提取到URL: nodeId=%s imageUrl=%s", m.NodeID, nd.ImageUrl)
						} else {
							referenceImageURLs = append(referenceImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] ✅ 从@引用的图片节点提取到URL: nodeId=%s imageUrl=%s", m.NodeID, nd.ImageUrl)
						}
					} else {
						log.Printf("[ImageExecutor] ❌ @引用的图片节点没有imageUrl: nodeId=%s raw=%s", m.NodeID, string(raw))
					}
				} else {
					log.Printf("[ImageExecutor] ❌ @引用的图片节点找不到数据: nodeId=%s", m.NodeID)
				}
			}
		}
	} else {
		log.Printf("[ImageExecutor] ❌ mentions解析失败: err=%v", err)
	}

	// 合并所有上游图片URL
	upstreamImageURLs := append(styleImageURLs, referenceImageURLs...)

	if len(upstreamImageURLs) > 0 {
		log.Printf("[ImageExecutor] ✅ 最终结果：风格图=%d 普通参考图=%d 总计=%d", len(styleImageURLs), len(referenceImageURLs), len(upstreamImageURLs))
	} else {
		log.Printf("[ImageExecutor] ⚠️ 没有找到@引用的图片，尝试fallback逻辑（查找上游连接的图片节点）")
		// ✅ 如果用户没有明确@引用图片，但当前节点有上游连接的图片节点，默认使用第一个上游图片作为参考图
		// 这符合直觉：用户通过画布连接上游图片节点，本身就表示"基于上游图片生成"
		upstreamSources := execCtx.GetUpstreamSources(node.ID)
		log.Printf("[ImageExecutor] 上游节点列表: %v", upstreamSources)

		for idx, sourceNodeID := range upstreamSources {
			log.Printf("[ImageExecutor] 检查上游节点[%d]: nodeId=%s", idx, sourceNodeID)
			if raw, ok := execCtx.GetNodeData(sourceNodeID); ok && len(raw) > 0 {
				var nd struct {
					Type     string `json:"type"`     // 节点类型
					ImageUrl string `json:"imageUrl"` // 图片URL
					StyleId  string `json:"styleId"`  // 风格图标识
				}
				if err := json.Unmarshal(raw, &nd); err == nil {
					log.Printf("[ImageExecutor] 上游节点数据: type=%s imageUrl=%s", nd.Type, nd.ImageUrl)
					// ✅ 检查是否是图片节点（通过type字段或imageUrl字段判断）
					if nd.Type == "image" || nd.ImageUrl != "" {
						// 区分风格图和普通参考图
						if strings.HasPrefix(sourceNodeID, "style-") || nd.StyleId != "" {
							styleImageURLs = append(styleImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] 🎨 默认使用上游风格图: upstreamNodeID=%s upstreamImageURL=%s", sourceNodeID, nd.ImageUrl)
						} else {
							referenceImageURLs = append(referenceImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] ✅ 默认使用上游连接的图片作为参考图: upstreamNodeID=%s upstreamImageURL=%s", sourceNodeID, nd.ImageUrl)
						}
					} else {
						log.Printf("[ImageExecutor] ❌ 上游节点不是图片节点: type=%s imageUrl=%s", nd.Type, nd.ImageUrl)
					}
				} else {
					log.Printf("[ImageExecutor] ❌ 上游节点数据解析失败: nodeId=%s", sourceNodeID)
				}
			} else {
				log.Printf("[ImageExecutor] ❌ 上游节点找不到数据: nodeId=%s", sourceNodeID)
			}
		}
		// fallback 后重新合并
		upstreamImageURLs = append(styleImageURLs, referenceImageURLs...)
	}

	// ✅ 最终判断结果
	log.Printf("[ImageExecutor] ========== 图生图判断逻辑（结束） ========== ")
	log.Printf("[ImageExecutor] 最终结果: upstreamImageURLs=%v (是否使用图生图=%v 图片数=%d)", upstreamImageURLs, len(upstreamImageURLs) > 0, len(upstreamImageURLs))

	// 没有提示词时直接返回空结果
	if data.Prompt == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"imageUrl":  "",
				"imageUrls": []string{},
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
				"imageUrl":  "",
				"imageUrls": []string{},
			},
		}, nil
	}

	// ✅ 尺寸参数：从 resolution + aspectRatio 计算
	// 前端保存时确保这两个字段必有值
	var width, height int

	if data.Resolution != "" && data.AspectRatio != "" {
		// 根据分辨率和比例计算尺寸
		width, height = calculateSizeFromResolutionAndRatio(data.Resolution, data.AspectRatio)
		log.Printf("[ImageExecutor] 从分辨率和比例计算尺寸: resolution=%s aspectRatio=%s -> %dx%d", data.Resolution, data.AspectRatio, width, height)
	} else {
		// 如果节点没有保存resolution/aspectRatio（异常情况），使用系统默认值
		width = 1920
		height = 1080
		log.Printf("[ImageExecutor] 使用系统默认尺寸: %dx%d", width, height)
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

	// 确定使用的模型 ID（传递给图像生成 API）
	apiModelID := data.Model

	// 华数TokenHub部分模型有最小像素要求，自动提升分辨率
	minPixels := getModelMinPixels(apiModelID)
	if minPixels > 0 && width*height < minPixels {
		log.Printf("[ImageExecutor] 模型%s要求最小%d像素，当前%d像素(%dx%d)，自动提升", apiModelID, minPixels, width*height, width, height)
		width, height = upscaleToMinPixels(width, height, minPixels)
		size = fmt.Sprintf("%dx%d", width, height)
		log.Printf("[ImageExecutor] 提升后尺寸: %dx%d (%d像素)", width, height, width*height)
	}

	log.Printf("[ImageExecutor] nodeID=%s promptLen=%d model=%s size=%s hasRefImage=%v refImageCount=%d data.Count=%d", node.ID, len(finalPrompt), apiModelID, size, len(upstreamImageURLs) > 0, len(upstreamImageURLs), data.Count)

	// 生成数量：count <= 0 时默认为 1
	count := data.Count
	if count <= 0 {
		count = 1
	}
	log.Printf("[ImageExecutor] 生成数量: data.Count=%d -> 实际count=%d", data.Count, count)

	// 扣费校验：通过后才调用图像生成 API（账单记录模型与场景）
	if _, err := i.biller.Charge(ctx, execCtx.GetUserID(), service.BillingActionImage, apiModelID, "图片生成"); err != nil {
		return nil, err
	}

	// ✅ 调用图像生成 API（根据是否有用户@引用的上游图片选择文生图或图生图）
	// 返回所有生成图片的 URL 列表（N>1 时有多个）
	var generatedURLs []string
	var err error

	if len(upstreamImageURLs) > 0 {
		// 根据风格图/参考图组合构建不同的提示词
		var imageToImagePrompt string
		if len(styleImageURLs) > 0 && len(referenceImageURLs) > 0 {
			// 既有风格图又有参考图：参考风格图的画风，基于参考图内容修改
			imageToImagePrompt = fmt.Sprintf("参考风格图的画风、色彩和视觉风格，基于参考图的内容进行修改：%s。请保持参考图的主体结构，同时采用风格图的艺术风格。", finalPrompt)
		} else if len(styleImageURLs) > 0 {
			// 只有风格图：仅提取风格元素，严禁复制内容
			imageToImagePrompt = fmt.Sprintf("仅从风格图中提取以下艺术元素：画风（如油画/水彩/赛博朋克等）、色彩色调、光影氛围、笔触纹理、构图风格。严格禁止复制风格图中的任何具体内容，包括但不限于：人物、角色、物体、场景、建筑、背景。根据用户描述生成全新的画面：%s。生成结果应具有与风格图相同的艺术风格，但内容完全不同。", finalPrompt)
		} else {
			// 只有普通参考图：基于参考图修改
			imageToImagePrompt = fmt.Sprintf("基于参考图修改：%s。请保持参考图中的主体结构、细节特征和整体风格，只进行用户指定的修改。", finalPrompt)
		}
		log.Printf("[ImageExecutor] 使用图生图模式: styleCount=%d refCount=%d prompt=%s", len(styleImageURLs), len(referenceImageURLs), imageToImagePrompt)
		generatedURLs, err = i.imageClient.GenerateImageFromImageWithGuidance(ctx, apiModelID, upstreamImageURLs, imageToImagePrompt, size, 12.0, count)
		if err != nil {
			return nil, fmt.Errorf("image-to-image generation failed: %w", err)
		}
	} else {
		log.Printf("[ImageExecutor] 使用文生图模式")
		generatedURLs, err = i.imageClient.GenerateImageWithModel(ctx, apiModelID, finalPrompt, size, count)
		if err != nil {
			return nil, fmt.Errorf("generate image: %w", err)
		}
	}

	log.Printf("[ImageExecutor] 生成完成: imageCount=%d", len(generatedURLs))

	// 逐个下载图片并使用 FileUploadService 上传
	// 失败的图片回退使用原始 URL，确保功能可用
	ownURLs := make([]string, 0, len(generatedURLs))
	for idx, generatedURL := range generatedURLs {
		imageInfo, dlErr := i.downloadAndUpload(ctx, generatedURL, node.ID, execCtx.GetCanvasDir(), execCtx.GetProjectID(), width, height)
		if dlErr != nil {
			log.Printf("[ImageExecutor] 下载上传失败(idx=%d)，使用原始URL: %v", idx, dlErr)
			ownURLs = append(ownURLs, generatedURL)
		} else {
			log.Printf("[ImageExecutor] 图片上传成功(idx=%d): generatedURL=%s -> ownURL=%s size=%dx%d", idx, generatedURL, imageInfo.url, imageInfo.width, imageInfo.height)
			ownURLs = append(ownURLs, imageInfo.url)
		}
	}

	// 第一个 URL（兼容现有前端逻辑读取 data.imageUrl）
	firstURL := ""
	if len(ownURLs) > 0 {
		firstURL = ownURLs[0]
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"imageUrl":  firstURL, // ✅ 第一个，兼容现有前端逻辑
			"imageUrls": ownURLs,  // ✅ 全部 URL，供前端创建多节点
			"width":     width,    // ✅ 返回实际图片宽度
			"height":    height,   // ✅ 返回实际图片高度
		},
	}, nil
}

// imageInfo 包含图片URL和尺寸信息
type imageInfo struct {
	url    string
	width  int
	height int
}

// downloadAndUpload 下载图片并使用 FileUploadService 上传（复用哈希去重等逻辑）
func (i *ImageExecutor) downloadAndUpload(ctx context.Context, imageURL string, nodeID string, canvasDir string, projectID string, width int, height int) (*imageInfo, error) {
	log.Printf("[ImageExecutor] 开始下载图片: url=%s dir=%s projectID=%s nodeID=%s", imageURL, canvasDir, projectID, nodeID)

	httpClient := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := httpClient.Get(imageURL)
	if err != nil {
		return nil, fmt.Errorf("download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download image failed: status=%d", resp.StatusCode)
	}

	imageData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read image data: %w", err)
	}

	log.Printf("[ImageExecutor] 图片下载成功: size=%d bytes, 使用生成尺寸: %dx%d", len(imageData), width, height)

	result, err := i.fileUploadService.UploadFromReader(bytes.NewReader(imageData), int64(len(imageData)), "image.png", service.UploadOptions{
		Dir:            canvasDir,
		ProjectID:      projectID,
		DefaultExt:     ".png",
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		return nil, fmt.Errorf("upload image: %w", err)
	}

	log.Printf("[ImageExecutor] 图片上传成功: objectName=%s url=%s cached=%v", result.ObjectName, result.URL, result.Cached)

	return &imageInfo{
		url:    result.URL,
		width:  width,
		height: height,
	}, nil
}

// VideoExecutor 视频节点执行器（doubao-seedance）
type VideoExecutor struct {
	videoClient       *llm.VideoClient
	fileUploadService *service.FileUploadService
	biller            *service.BillingService
}

// NewVideoExecutor 创建视频执行器
func NewVideoExecutor(videoClient *llm.VideoClient, fileUploadService *service.FileUploadService, biller *service.BillingService) *VideoExecutor {
	return &VideoExecutor{
		videoClient:       videoClient,
		fileUploadService: fileUploadService,
		biller:            biller,
	}
}

func (v *VideoExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode          string          `json:"mode"`
		Prompt        string          `json:"prompt"`
		Model         string          `json:"model"`
		Duration      int             `json:"duration"`
		Fps           int             `json:"fps"`
		AspectRatio   string          `json:"aspectRatio"`
		Resolution    string          `json:"resolution"`
		VideoMode     string          `json:"videoMode"`
		GenerateAudio *bool           `json:"generateAudio"` // 指针类型，区分未设置(nil)和显式false
		Mentions      json.RawMessage `json:"mentions"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse video node data: %w", err)
	}

	// generateAudio 默认为 true（开启声音生成）
	generateAudio := true
	if data.GenerateAudio != nil {
		generateAudio = *data.GenerateAudio
	}

	log.Printf("[VideoExecutor] nodeID=%s model=%s promptLen=%d duration=%d videoMode=%s generateAudio=%v", node.ID, data.Model, len(data.Prompt), data.Duration, data.VideoMode, generateAudio)

	// 解析 mentions，收集上游图片URL和视频URL
	var imageURLs []string
	var videoURLs []string
	var mentions []struct {
		ID       string `json:"id"`
		NodeID   string `json:"nodeId"`
		NodeType string `json:"nodeType"`
	}
	if err := json.Unmarshal(data.Mentions, &mentions); err == nil {
		// 防御：只保留 prompt 中实际存在的 [[m:xxx]] 对应的 mentions
		// 防止前端残留已删除的 mention 导致错误收集资源
		validMentions := mentions[:0]
		for _, m := range mentions {
			marker := fmt.Sprintf("[[m:%s]]", m.ID)
			if m.ID != "" && !strings.Contains(data.Prompt, marker) {
				log.Printf("[VideoExecutor] ⚠️ 跳过残留mention: id=%s nodeId=%s type=%s (prompt中不存在)", m.ID, m.NodeID, m.NodeType)
				continue
			}
			validMentions = append(validMentions, m)
		}
		mentions = validMentions

		for _, m := range mentions {
			if m.NodeType == "image" {
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						ImageUrl string `json:"imageUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.ImageUrl != "" {
						imageURLs = append(imageURLs, nd.ImageUrl)
						log.Printf("[VideoExecutor] ✅ 参考图: nodeId=%s imageUrl=%s", m.NodeID, nd.ImageUrl)
					}
				}
			} else if m.NodeType == "video" {
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						VideoUrl string `json:"videoUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.VideoUrl != "" {
						videoURLs = append(videoURLs, nd.VideoUrl)
						log.Printf("[VideoExecutor] ✅ 参考视频: nodeId=%s videoUrl=%s", m.NodeID, nd.VideoUrl)
					}
				}
			}
		}
	}

	// fallback: 查找上游连接的图片/视频节点
	// 仅当 mentions 完全没有提供某类资源时，才从上游补充（尊重用户 @mentions 的选择）
	// 首尾帧模式需要2张图，所以不能只收集1张；video.go 会按模式截断数量
	mentionsImageCount := len(imageURLs)
	mentionsVideoCount := len(videoURLs)
	if mentionsImageCount == 0 || mentionsVideoCount == 0 {
		upstreamSources := execCtx.GetUpstreamSources(node.ID)
		for _, sourceNodeID := range upstreamSources {
			if raw, ok := execCtx.GetNodeData(sourceNodeID); ok && len(raw) > 0 {
				var nd struct {
					ImageUrl string `json:"imageUrl"`
					VideoUrl string `json:"videoUrl"`
					Type     string `json:"type"`
				}
				if err := json.Unmarshal(raw, &nd); err == nil {
					if nd.Type == "image" && nd.ImageUrl != "" && mentionsImageCount == 0 && len(imageURLs) < 9 {
						imageURLs = append(imageURLs, nd.ImageUrl)
						log.Printf("[VideoExecutor] ✅ 从上游图片节点获取参考图: nodeId=%s", sourceNodeID)
					} else if nd.Type == "video" && nd.VideoUrl != "" && mentionsVideoCount == 0 && len(videoURLs) == 0 {
						videoURLs = append(videoURLs, nd.VideoUrl)
						log.Printf("[VideoExecutor] ✅ 从上游视频节点获取参考视频: nodeId=%s", sourceNodeID)
					}
				}
			}
		}
	}

	// 确定模型
	model := data.Model
	if model == "" {
		model = "doubao-seedance-2.0-fast"
	}

	// 视频节点直接使用前端传来的分辨率（480p/720p/1080p/4K）
	resolution := data.Resolution
	if resolution == "" {
		resolution = "1080p"
	}
	if resolution == "4K" {
		resolution = "4k"
	}

	// 扣费校验：通过后才调用视频生成 API（账单记录模型与场景）
	if _, err := v.biller.Charge(ctx, execCtx.GetUserID(), service.BillingActionVideo, model, "视频生成"); err != nil {
		return nil, err
	}

	// 调用视频生成API
	videoURL, err := v.videoClient.GenerateVideo(
		ctx,
		model,
		data.Prompt,
		data.Duration,
		resolution,
		data.AspectRatio,
		imageURLs,
		videoURLs,
		data.VideoMode,
		generateAudio,
	)
	if err != nil {
		log.Printf("[VideoExecutor] ❌ 视频生成失败: %v", err)
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": err.Error(),
			},
		}, nil
	}

	log.Printf("[VideoExecutor] ✅ 视频生成成功: nodeId=%s videoUrl=%s", node.ID, videoURL)

	// 下载视频并使用 FileUploadService 上传到 users/<userID>/canvas/<projectID>/（与图片保存机制一致）
	ownVideoURL, dlErr := v.downloadAndUpload(ctx, videoURL, node.ID, execCtx.GetCanvasDir(), execCtx.GetProjectID())
	if dlErr != nil {
		log.Printf("[VideoExecutor] ⚠️ 视频下载上传失败，使用原始URL: %v", dlErr)
		ownVideoURL = videoURL
	} else {
		log.Printf("[VideoExecutor] ✅ 视频已保存: original=%s -> ownURL=%s", videoURL, ownVideoURL)
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"mode":     data.Mode,
			"prompt":   data.Prompt,
			"videoUrl": ownVideoURL,
		},
	}, nil
}

// downloadAndUpload 下载视频并使用 FileUploadService 上传（复用哈希去重等逻辑）
func (v *VideoExecutor) downloadAndUpload(ctx context.Context, videoURL string, nodeID string, canvasDir string, projectID string) (string, error) {
	log.Printf("[VideoExecutor] 开始下载视频: url=%s dir=%s projectID=%s nodeID=%s", videoURL, canvasDir, projectID, nodeID)

	httpClient := &http.Client{
		Timeout: 300 * time.Second, // 视频文件较大，超时设为5分钟
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, videoURL, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("download video: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download video failed: status=%d", resp.StatusCode)
	}

	videoData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read video data: %w", err)
	}

	log.Printf("[VideoExecutor] 视频下载成功: size=%d bytes", len(videoData))

	// 从 Content-Type 推断扩展名
	ext := ".mp4"
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "webm") {
		ext = ".webm"
	} else if strings.Contains(contentType, "mov") {
		ext = ".mov"
	}

	result, err := v.fileUploadService.UploadFromReader(bytes.NewReader(videoData), int64(len(videoData)), "video"+ext, service.UploadOptions{
		Dir:            canvasDir,
		ProjectID:      projectID,
		DefaultExt:     ext,
		ContentTypeFor: service.ContentTypeForVideo,
	})
	if err != nil {
		return "", fmt.Errorf("upload video: %w", err)
	}

	log.Printf("[VideoExecutor] 视频上传成功: objectName=%s url=%s cached=%v", result.ObjectName, result.URL, result.Cached)
	return result.URL, nil
}

// AudioExecutor 音频节点执行器
type AudioExecutor struct {
	audioClient       *llm.AudioClient
	fileUploadService *service.FileUploadService
	biller            *service.BillingService
}

// NewAudioExecutor 创建音频执行器
func NewAudioExecutor(audioClient *llm.AudioClient, fileUploadService *service.FileUploadService, biller *service.BillingService) *AudioExecutor {
	return &AudioExecutor{
		audioClient:       audioClient,
		fileUploadService: fileUploadService,
		biller:            biller,
	}
}

func (a *AudioExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode     string          `json:"mode"`
		Text     string          `json:"text"`
		Model    string          `json:"model"`
		Voice    string          `json:"voice"`
		Speed    float64         `json:"speed"`
		Style    string          `json:"style"`
		Tone     string          `json:"tone"`
		Prompt   string          `json:"prompt"`
		Mentions json.RawMessage `json:"mentions"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse audio node data: %w", err)
	}

	// 确定模型
	model := data.Model
	if model == "" {
		model = "qwen3-tts-instruct-flash"
	}

	// 确定音色
	voice := data.Voice
	if voice == "" || voice == "default" {
		voice = "Cherry"
	}

	// 确定输入文本：优先用 prompt（用户直接在音频节点输入的文本），其次用 text（上游传入）
	inputText := strings.TrimSpace(data.Prompt)
	if inputText == "" {
		inputText = strings.TrimSpace(data.Text)
	}

	// 如果都没有，尝试从上游文本节点获取
	if inputText == "" {
		sources := execCtx.GetUpstreamSources(node.ID)
		for _, sourceID := range sources {
			if raw, ok := execCtx.GetNodeData(sourceID); ok && len(raw) > 0 {
				var nd struct {
					Type    string `json:"type"`
					Content string `json:"content"`
				}
				if err := json.Unmarshal(raw, &nd); err == nil && nd.Type == "text" && nd.Content != "" {
					inputText = strings.TrimSpace(nd.Content)
					log.Printf("[AudioExecutor] ✅ 从上游文本节点获取内容: nodeId=%s len=%d", sourceID, len(inputText))
					break
				}
			}
		}
	}

	if inputText == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": "没有输入文本，无法生成音频",
			},
		}, nil
	}

	log.Printf("[AudioExecutor] nodeID=%s model=%s voice=%s speed=%.2f style=%s tone=%s textLen=%d", node.ID, model, voice, data.Speed, data.Style, data.Tone, len(inputText))

	// 扣费校验：通过后才调用 TTS API（账单记录模型与场景）
	if _, err := a.biller.Charge(ctx, execCtx.GetUserID(), service.BillingActionAudio, model, "音频生成"); err != nil {
		return nil, err
	}

	// 调用 TTS API
	audioData, err := a.audioClient.GenerateSpeech(ctx, model, inputText, voice, data.Speed, data.Style, data.Tone)
	if err != nil {
		log.Printf("[AudioExecutor] ❌ TTS生成失败: %v", err)
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": err.Error(),
			},
		}, nil
	}

	log.Printf("[AudioExecutor] ✅ TTS生成成功: nodeId=%s audioBytes=%d", node.ID, len(audioData))

	// 上传到 users/<userID>/canvas/<projectID>/（无 userID 时降级 canvas/<projectID>/）
	projectID := execCtx.GetProjectID()
	result, err := a.fileUploadService.UploadFromReader(
		bytes.NewReader(audioData),
		int64(len(audioData)),
		fmt.Sprintf("%s.wav", node.ID),
		service.UploadOptions{
			Dir:         execCtx.GetCanvasDir(),
			ProjectID:   projectID,
			AllowedExts: map[string]bool{".wav": true, ".mp3": true},
			DefaultExt:  ".wav",
			ContentTypeFor: func(ext string) string {
				if ext == ".mp3" {
					return "audio/mpeg"
				}
				return "audio/wav"
			},
		},
	)
	if err != nil {
		log.Printf("[AudioExecutor] ❌ 音频上传失败: %v", err)
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": fmt.Sprintf("上传音频失败: %v", err),
			},
		}, nil
	}

	log.Printf("[AudioExecutor] ✅ 音频上传成功: objectName=%s url=%s cached=%v", result.ObjectName, result.URL, result.Cached)

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"mode":     data.Mode,
			"text":     inputText,
			"audioUrl": result.URL,
		},
	}, nil
}

// calculateSizeFromResolutionAndRatio 根据分辨率和比例计算图片尺寸
// resolution: "1K" / "2K" / "4K"
// aspectRatio: "16:9" / "9:16" / "1:1" / "4:3" 等
func calculateSizeFromResolutionAndRatio(resolution, aspectRatio string) (int, int) {
	// 1. 计算目标像素总数
	var totalPixels int
	switch resolution {
	case "1K":
		totalPixels = 1280 * 720 // 约92万像素
	case "2K":
		totalPixels = 1920 * 1080 // 约207万像素
	case "4K":
		totalPixels = 3840 * 2160 // 约829万像素
	default:
		totalPixels = 1280 * 720 // 默认1K
	}

	// 2. 解析宽高比
	var ratioW, ratioH float64
	if aspectRatio == "free" || aspectRatio == "" {
		// 自适应比例，默认使用16:9
		ratioW = 16
		ratioH = 9
	} else {
		parts := strings.Split(aspectRatio, ":")
		if len(parts) == 2 {
			// 将字符串转换为浮点数
			w, err1 := parseFloat(parts[0])
			h, err2 := parseFloat(parts[1])
			if err1 == nil && err2 == nil && w > 0 && h > 0 {
				ratioW = w
				ratioH = h
			} else {
				// 解析失败，使用默认16:9
				ratioW = 16
				ratioH = 9
			}
		} else {
			// 格式错误，使用默认16:9
			ratioW = 16
			ratioH = 9
		}
	}

	// 3. 计算实际宽度和高度
	// width * height = totalPixels
	// width / height = ratioW / ratioH
	// => width = sqrt(totalPixels * ratioW / ratioH)
	// => height = sqrt(totalPixels * ratioH / ratioW)
	ratio := ratioW / ratioH
	width := int(math.Sqrt(float64(totalPixels) * ratio))
	height := int(math.Sqrt(float64(totalPixels) / ratio))

	// 确保是8的倍数（大多数图片生成API的要求）
	width = roundTo8(width)
	height = roundTo8(height)

	return width, height
}

// getModelMinPixels 返回模型要求的最小像素数（0表示无限制）
// 华数TokenHub的 doubao-seedream 系列要求至少 3,686,400 像素
func getModelMinPixels(modelID string) int {
	switch {
	case strings.HasPrefix(modelID, "doubao-seedream"):
		return 3686400 // 至少约 1920x1920
	default:
		return 0
	}
}

// upscaleToMinPixels 等比放大尺寸以满足最小像素要求
func upscaleToMinPixels(width, height, minPixels int) (int, int) {
	if width*height >= minPixels {
		return width, height
	}
	// 按比例放大：scale = sqrt(minPixels / (width * height))
	scale := math.Sqrt(float64(minPixels) / float64(width*height))
	newW := roundTo8(int(math.Ceil(float64(width) * scale)))
	newH := roundTo8(int(math.Ceil(float64(height) * scale)))
	return newW, newH
}

// parseFloat 辅助函数：将字符串解析为浮点数
func parseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	return f, err
}

// roundTo8 将数值调整为最接近的8的倍数
func roundTo8(n int) int {
	return ((n + 4) / 8) * 8
}

// NewDefaultRegistry 创建默认执行器注册表（biller 为积分扣费服务，各执行器在真实 AI 调用前扣费并记账）
func NewDefaultRegistry(llmClient *llm.Client, imageClient *llm.ImageClient, videoClient *llm.VideoClient, audioClient *llm.AudioClient, modelManager *llm.ModelManager, fileUploadService *service.FileUploadService, biller *service.BillingService) *ExecutorRegistry {
	registry := NewExecutorRegistry()
	registry.Register("text", NewTextExecutor(llmClient, biller))
	registry.Register("script", NewScriptExecutor(llmClient, biller))
	registry.Register("image", NewImageExecutor(imageClient, modelManager, fileUploadService, biller))
	registry.Register("video", NewVideoExecutor(videoClient, fileUploadService, biller))
	registry.Register("audio", NewAudioExecutor(audioClient, fileUploadService, biller))
	return registry
}
