package handler

import (
	"context"
	"encoding/json"
	"testing"

	"gorm.io/datatypes"
	"libtv/internal/engine"
	"libtv/internal/model"
)

type finalCanvasRepo struct{ canvas *model.Canvas }

func (r *finalCanvasRepo) FindByProjectID(context.Context, string) (*model.Canvas, error) {
	return r.canvas, nil
}
func (r *finalCanvasRepo) Save(_ context.Context, canvas *model.Canvas) error {
	r.canvas = canvas
	return nil
}
func (r *finalCanvasRepo) DeleteByProjectID(context.Context, string) error { return nil }

func TestFinalOutputsUseLatestCanvasAndOnlyOwnNodes(t *testing.T) {
	repo := &finalCanvasRepo{canvas: &model.Canvas{ProjectID: "p", Content: datatypes.JSON(`{"nodes":[
		{"id":"a","data":{"status":"running"}},
		{"id":"b","position":{"x":123},"data":{"status":"success","videoUrl":"latest-b.mp4"}}
	]}`)}}
	h := &WorkflowHandler{canvasRepo: repo}
	stale := &model.Canvas{ProjectID: "p", Content: datatypes.JSON(`{"nodes":[
		{"id":"a","data":{"status":"failed","error":"old"}},
		{"id":"b","data":{"status":"failed","error":"old b"}}
	]}`)}
	node := engine.WorkflowNode{ID: "a", Data: json.RawMessage(`{}`)}
	h.persistNodeOutputs(context.Background(), stale,
		&engine.ExecutionPlan{Levels: [][]engine.WorkflowNode{{node}}, Schema: engine.WorkflowSchema{Nodes: []engine.WorkflowNode{node}}},
		map[string]*engine.NodeOutput{
			"a": {Status: "success", Data: map[string]interface{}{"videoUrl": "a.mp4"}},
			"b": {Status: "failed", Error: "foreign output"},
		})
	var doc struct {
		Nodes []struct {
			ID       string                     `json:"id"`
			Data     map[string]json.RawMessage `json:"data"`
			Position struct {
				X int `json:"x"`
			} `json:"position"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(repo.canvas.Content, &doc); err != nil {
		t.Fatal(err)
	}
	if string(doc.Nodes[0].Data["status"]) != `"success"` || len(doc.Nodes[0].Data["error"]) != 0 {
		t.Fatalf("own success not persisted: %s", repo.canvas.Content)
	}
	if string(doc.Nodes[1].Data["status"]) != `"success"` || string(doc.Nodes[1].Data["videoUrl"]) != `"latest-b.mp4"` || doc.Nodes[1].Position.X != 123 {
		t.Fatalf("unrelated node overwritten from stale snapshot: %s", repo.canvas.Content)
	}
}

func TestSuccessfulVideoRetryClearsPreviousError(t *testing.T) {
	existing := map[string]json.RawMessage{
		"status":   json.RawMessage(`"failed"`),
		"error":    json.RawMessage(`"previous rejection"`),
		"videoUrl": json.RawMessage(`"previous.mp4"`),
	}
	mergeNodeOutputData(existing, &engine.NodeOutput{
		Status: "success", Data: map[string]interface{}{"videoUrl": "new.mp4"},
	})
	if string(existing["status"]) != `"success"` || len(existing["error"]) != 0 || string(existing["videoUrl"]) != `"new.mp4"` {
		t.Fatalf("successful retry retained previous failure: %v", existing)
	}
}

// 元素编辑指令（elementEdit）是**一次性**的：这一跑按蒙版合成完就必须从画布数据里删掉，
// 否则用户下次从这个节点直接点生成，会又按旧蒙版合成一遍 —— 界面上看是"点了生成但画面
// 几乎没变"，还白扣一次积分。这条用例钉住"成功即删、失败保留"。
func TestMergeNodeOutputData_ClearsOneShotElementEdit(t *testing.T) {
	existing := map[string]json.RawMessage{
		"elementEdit": json.RawMessage(`{"baseUrl":"https://cdn/a.png","maskUrl":"https://cdn/m.png","prompt":"改成红色"}`),
		"prompt":      json.RawMessage(`"四视图设定表"`),
	}

	mergeNodeOutputData(existing, &engine.NodeOutput{
		Status: "success",
		Data: map[string]interface{}{
			"imageUrl":    "https://cdn/out.png",
			"width":       4096,
			"height":      2304,
			"clearFields": []string{"elementEdit"},
		},
	})

	if _, ok := existing["elementEdit"]; ok {
		t.Error("成功后必须删掉一次性的 elementEdit（否则下次生成会又按旧蒙版合成一遍）")
	}
	if string(existing["prompt"]) != `"四视图设定表"` {
		t.Error("删指令不能动别的字段（节点的提示词要原样留着）")
	}
	if string(existing["imageUrl"]) != `"https://cdn/out.png"` {
		t.Error("产物字段仍要正常回写")
	}
	if string(existing["status"]) != `"success"` {
		t.Error("状态仍要正常回写")
	}
}

// 失败时不删：重试还要用同一份蒙版。删了的话重试会变成"整图重画"，
// 而用户以为只是同一处再改一次。
func TestMergeNodeOutputData_KeepsElementEditOnFailure(t *testing.T) {
	existing := map[string]json.RawMessage{
		"elementEdit": json.RawMessage(`{"baseUrl":"https://cdn/a.png","maskUrl":"https://cdn/m.png","prompt":"改成红色"}`),
	}

	mergeNodeOutputData(existing, &engine.NodeOutput{
		Status: "failed",
		Error:  "元素编辑：下载蒙版失败",
	})

	if _, ok := existing["elementEdit"]; !ok {
		t.Error("失败时必须保留 elementEdit，重试才还是「只改选区」")
	}
	if string(existing["error"]) == "" {
		t.Error("失败原因要写进节点数据（前端红框靠它显示）")
	}
}

// 普通生成（没有 clearFields）不能误删任何东西
func TestMergeNodeOutputData_NoClearFieldsIsNoop(t *testing.T) {
	existing := map[string]json.RawMessage{
		"elementEdit": json.RawMessage(`{"baseUrl":"a","maskUrl":"m","prompt":"p"}`),
	}
	mergeNodeOutputData(existing, &engine.NodeOutput{
		Status: "success",
		Data:   map[string]interface{}{"imageUrl": "https://cdn/out.png"},
	})
	if _, ok := existing["elementEdit"]; !ok {
		t.Error("没点名要删就不该删（clearFields 只服务于元素编辑）")
	}
}
