package engine

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestVideoExecutorAcceptsFractionalStoryboardDuration(t *testing.T) {
	exec := NewVideoExecutor(nil, nil, nil, nil, nil, nil, nil)
	out, err := exec.Execute(context.Background(),
		WorkflowNode{ID: "video-1", Type: "video", Data: json.RawMessage(`{
			"prompt":"","model":"doubao-seedance-2.0-fast","duration":3.5
		}`)}, &ExecutionContext{})
	if err != nil || out == nil || out.Status != "failed" {
		t.Fatalf("应通过时长解析，进入空输入校验: out=%+v err=%v", out, err)
	}
	detail, _ := out.Data["error"].(string)
	if !strings.Contains(detail, "没有输入提示词，也没有上游参考素材") {
		t.Fatalf("小数秒不应触发解析错误: %q", detail)
	}
}
