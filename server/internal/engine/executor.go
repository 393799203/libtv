package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"
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
	eventCh  chan WorkflowEvent
}

func NewWorkflowEngine(registry *ExecutorRegistry) *WorkflowEngine {
	return &WorkflowEngine{
		registry: registry,
		eventCh:  make(chan WorkflowEvent, 100),
	}
}

// Events 返回事件通道
func (e *WorkflowEngine) Events() <-chan WorkflowEvent {
	return e.eventCh
}

// Execute 执行工作流
func (e *WorkflowEngine) Execute(ctx context.Context, plan *ExecutionPlan, executionID int64) error {
	execCtx := NewExecutionContext()

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionStart,
		Timestamp:   time.Now().UnixMilli(),
	})

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
			return fmt.Errorf("level %d failed: %v", levelIdx, levelErrors)
		}
	}

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionDone,
		Timestamp:   time.Now().UnixMilli(),
	})

	return nil
}

func (e *WorkflowEngine) emit(event WorkflowEvent) {
	select {
	case e.eventCh <- event:
	default:
		// channel full, drop event
	}
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
	ExecutionID int64       `json:"executionId"`
	EventType   EventType   `json:"eventType"`
	NodeID      string      `json:"nodeId,omitempty"`
	NodeName    string      `json:"nodeName,omitempty"`
	Data        interface{} `json:"data,omitempty"`
	Timestamp   int64       `json:"timestamp"`
}

// --- 默认执行器 ---

// TextExecutor 文本节点执行器（透传）
type TextExecutor struct{}

func (t *TextExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Content string `json:"content"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse text node data: %w", err)
	}
	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data:   map[string]interface{}{"content": data.Content},
	}, nil
}

// ScriptExecutor 脚本节点执行器（MVP: 透传，后续接入 LLM）
type ScriptExecutor struct{}

func (s *ScriptExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		ScriptContent string `json:"scriptContent"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse script node data: %w", err)
	}
	// TODO: 调用 LLM 解析剧本，生成结构化分镜
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
func NewDefaultRegistry() *ExecutorRegistry {
	registry := NewExecutorRegistry()
	registry.Register("text", &TextExecutor{})
	registry.Register("script", &ScriptExecutor{})
	registry.Register("image", &ImageExecutor{})
	registry.Register("video", &VideoExecutor{})
	registry.Register("audio", &AudioExecutor{})
	return registry
}
