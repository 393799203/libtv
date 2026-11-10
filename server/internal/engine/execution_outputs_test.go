package engine

import (
	"context"
	"testing"
)

type isolatedResultExecutor struct{}

func (isolatedResultExecutor) Execute(_ context.Context, node WorkflowNode, _ *ExecutionContext) (*NodeOutput, error) {
	return &NodeOutput{NodeID: node.ID, Status: "success", Data: map[string]interface{}{"videoUrl": node.ID + ".mp4"}}, nil
}

func TestExecutionReturnsItsOwnOutputsAfterAnotherExecution(t *testing.T) {
	registry := NewExecutorRegistry()
	registry.Register("video", isolatedResultExecutor{})
	eng := NewWorkflowEngine(registry)
	run := func(id string, executionID int64) map[string]*NodeOutput {
		t.Helper()
		node := WorkflowNode{ID: id, Type: "video"}
		outputs, err := eng.ExecuteWithOutputs(context.Background(),
			&ExecutionPlan{Schema: WorkflowSchema{Nodes: []WorkflowNode{node}}, Levels: [][]WorkflowNode{{node}}},
			executionID, "project", "user")
		if err != nil {
			t.Fatal(err)
		}
		return outputs
	}
	first := run("first", 1)
	second := run("second", 2)
	if len(first) != 1 || first["first"] == nil || first["second"] != nil ||
		len(second) != 1 || second["second"] == nil || second["first"] != nil {
		t.Fatalf("execution output maps mixed: first=%v second=%v", first, second)
	}
}
