package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"libtv/internal/llm"
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
}

func NewExecutionContext() *ExecutionContext {
	return &ExecutionContext{
		outputs: make(map[string]*NodeOutput),
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
func (e *WorkflowEngine) Execute(ctx context.Context, plan *ExecutionPlan, executionID int64) error {
	log.Printf("[Engine] Execute start: executionID=%d, plan levels=%d, totalNodes=%d", executionID, len(plan.Levels), len(plan.Schema.Nodes))
	execCtx := NewExecutionContext()

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionStart,
		Timestamp:   time.Now().UnixMilli(),
	})

	// 收集本次执行的所有输出，供外部回写画布
	outputs := make(map[string]*NodeOutput)

	for levelIdx, level := range plan.Levels {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var levelErrors []error

		for _, node := range level {
			wg.Add(1)
			go func(n WorkflowNode) {
				defer wg.Done()

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
						Data:        err.Error(),
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
						Data:        err.Error(),
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
				Data:        fmt.Sprintf("level %d failed: %v", levelIdx, levelErrors),
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
	userInput := data.Prompt
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

// ScriptExecutor 脚本节点执行器（MVP: 透传，后续接入 LLM 生成分镜）
type ScriptExecutor struct{}

func (s *ScriptExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		ScriptContent string `json:"scriptContent"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse script node data: %w", err)
	}
	// TODO: 后续接入 LLM，基于上游文本内容生成分镜剧本
	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"scriptContent": data.ScriptContent,
			"characters":    []interface{}{},
			"shots":         []interface{}{},
		},
	}, nil
}

// ImageExecutor 图像节点执行器（MVP: 透传，后续接入 SD API）
type ImageExecutor struct{}

func (i *ImageExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode   string `json:"mode"`
		Prompt string `json:"prompt"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse image node data: %w", err)
	}
	// TODO: 调用 SD API / MJ API 生图
	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"mode":   data.Mode,
			"prompt": data.Prompt,
			"images": []string{},
		},
	}, nil
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
func NewDefaultRegistry(llmClient *llm.Client) *ExecutorRegistry {
	registry := NewExecutorRegistry()
	registry.Register("text", NewTextExecutor(llmClient))
	registry.Register("script", &ScriptExecutor{})
	registry.Register("image", &ImageExecutor{})
	registry.Register("video", &VideoExecutor{})
	registry.Register("audio", &AudioExecutor{})
	return registry
}
