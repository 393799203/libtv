package engine

import (
	"encoding/json"
	"fmt"
)

// CanvasDSL 前端画布 JSON 结构
type CanvasDSL struct {
	Nodes    []CanvasNode `json:"nodes"`
	Edges    []CanvasEdge `json:"edges"`
	Viewport Viewport     `json:"viewport"`
}

type CanvasNode struct {
	ID       string          `json:"id"`
	Type     string          `json:"type"` // text/image/video/audio/script
	Position Position        `json:"position"`
	Data     json.RawMessage `json:"data"`
}

type CanvasEdge struct {
	ID           string `json:"id"`
	Source       string `json:"source"`
	Target       string `json:"target"`
	SourceHandle string `json:"sourceHandle"`
	TargetHandle string `json:"targetHandle"`
}

type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type Viewport struct {
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Zoom float64 `json:"zoom"`
}

// WorkflowSchema 去可视化后的纯逻辑图
type WorkflowSchema struct {
	Nodes       []WorkflowNode `json:"nodes"`
	Connections []Connection   `json:"connections"`
}

type WorkflowNode struct {
	ID   string          `json:"id"`
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type Connection struct {
	Source       string `json:"source"`
	Target       string `json:"target"`
	SourceHandle string `json:"sourceHandle"`
	TargetHandle string `json:"targetHandle"`
}

// ExecutionPlan 执行计划（拓扑排序后分层）
type ExecutionPlan struct {
	Levels [][]WorkflowNode // Level[i] = 可并行执行的节点列表
	Schema WorkflowSchema
}

// Parse 将 Canvas JSON 解析为 WorkflowSchema
func Parse(canvasJSON []byte) (*WorkflowSchema, error) {
	var dsl CanvasDSL
	if err := json.Unmarshal(canvasJSON, &dsl); err != nil {
		return nil, fmt.Errorf("parse canvas JSON: %w", err)
	}

	schema := &WorkflowSchema{
		Nodes:       make([]WorkflowNode, 0, len(dsl.Nodes)),
		Connections: make([]Connection, 0, len(dsl.Edges)),
	}

	for _, node := range dsl.Nodes {
		schema.Nodes = append(schema.Nodes, WorkflowNode{
			ID:   node.ID,
			Type: node.Type,
			Data: node.Data,
		})
	}

	for _, edge := range dsl.Edges {
		schema.Connections = append(schema.Connections, Connection{
			Source:       edge.Source,
			Target:       edge.Target,
			SourceHandle: edge.SourceHandle,
			TargetHandle: edge.TargetHandle,
		})
	}

	return schema, nil
}
