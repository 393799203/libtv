package engine

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// 空节点（既没有提示词、也没有上游素材）直点「生成」不该发请求，也不该"静默成功"。
// 这几个用例锁住各执行器的判定与提示语。
//
// 构造执行器时依赖一律传 nil：空输入的判定都发生在触碰上游客户端/计费之前，
// 真走到后面会 nil panic —— 用例跑得通本身就说明判定在最前面。
func mustNodeData(t *testing.T, data map[string]interface{}) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("序列化节点数据失败: %v", err)
	}
	return raw
}

func assertNodeFailed(t *testing.T, out *NodeOutput, err error, wantSubstr string) {
	t.Helper()
	if err != nil {
		t.Fatalf("应当是节点级失败（返回 failed 状态），却直接返回了错误: %v", err)
	}
	if out == nil {
		t.Fatal("输出为空")
	}
	if out.Status != "failed" {
		t.Fatalf("期望 status=failed，实际 status=%q（data=%v）", out.Status, out.Data)
	}
	msg, _ := out.Data["error"].(string)
	if !strings.Contains(msg, wantSubstr) {
		t.Fatalf("错误提示里应包含 %q，实际: %q", wantSubstr, msg)
	}
}

// 文本节点：原来空输入直接透传 success + 空内容，前端连红点都没有
func TestTextExecutorEmptyInputFails(t *testing.T) {
	exec := NewTextExecutor(nil, nil, nil)
	out, err := exec.Execute(
		context.Background(),
		WorkflowNode{ID: "text-1", Type: "text", Data: mustNodeData(t, map[string]interface{}{
			"prompt":  "   ", // 只有空白也算没输入
			"content": "",
		})},
		&ExecutionContext{},
	)
	assertNodeFailed(t, out, err, "没有输入提示词")
}

// 图片节点：原来空提示词返回 success + 空 imageUrl；现在即使有上游参考图也要求提示词
func TestImageExecutorEmptyPromptFails(t *testing.T) {
	exec := NewImageExecutor(nil, nil, nil, nil, nil, nil)
	out, err := exec.Execute(
		context.Background(),
		WorkflowNode{ID: "image-1", Type: "image", Data: mustNodeData(t, map[string]interface{}{
			"prompt": "",
			"model":  "gemini-2.5-flash-image",
		})},
		&ExecutionContext{},
	)
	assertNodeFailed(t, out, err, "没有输入提示词")
}

// 反向用例：写了提示词就不该被空输入判定拦下（此处 imageClient 为 nil，
// 会走到"没有图像客户端"的兜底分支 —— 关键是不能命中"没有输入提示词"）
func TestImageExecutorWithPromptIsNotBlocked(t *testing.T) {
	exec := NewImageExecutor(nil, nil, nil, nil, nil, nil)
	out, err := exec.Execute(
		context.Background(),
		WorkflowNode{ID: "image-2", Type: "image", Data: mustNodeData(t, map[string]interface{}{
			"prompt": "一只在屋顶看星星的机器人",
			"model":  "gemini-2.5-flash-image",
		})},
		&ExecutionContext{},
	)
	if err != nil {
		t.Fatalf("不应返回错误: %v", err)
	}
	if msg, _ := out.Data["error"].(string); strings.Contains(msg, "没有输入提示词") {
		t.Fatalf("有提示词却被空输入判定拦下了: %q", msg)
	}
}

// 视频节点：原来空提示词 + 无素材也会发给上游换一条技术性报错
func TestVideoExecutorEmptyInputFails(t *testing.T) {
	exec := NewVideoExecutor(nil, nil, nil, nil, nil)
	out, err := exec.Execute(
		context.Background(),
		WorkflowNode{ID: "video-1", Type: "video", Data: mustNodeData(t, map[string]interface{}{
			"prompt": "",
			"model":  "doubao-seedance-2.0-fast",
		})},
		&ExecutionContext{},
	)
	assertNodeFailed(t, out, err, "没有输入提示词，也没有上游参考素材")
}

// 音频节点：这一条是既有行为（原本就会报错），一并锁住避免以后被改回静默
func TestAudioExecutorEmptyInputFails(t *testing.T) {
	exec := NewAudioExecutor(nil, nil, nil, nil)
	out, err := exec.Execute(
		context.Background(),
		WorkflowNode{ID: "audio-1", Type: "audio", Data: mustNodeData(t, map[string]interface{}{
			"prompt": "",
			"text":   "",
		})},
		&ExecutionContext{},
	)
	assertNodeFailed(t, out, err, "没有输入文本")
}

// 脚本节点：既没上游、也没提示词时给出明确的补输入指引（既有行为）
func TestScriptExecutorEmptyInputFails(t *testing.T) {
	exec := NewScriptExecutor(nil, nil, nil)
	_, err := exec.Execute(
		context.Background(),
		WorkflowNode{ID: "script-1", Type: "script", Data: mustNodeData(t, map[string]interface{}{
			"prompt":        "",
			"scriptContent": "",
		})},
		&ExecutionContext{},
	)
	if err == nil {
		t.Fatal("既没有上游也没有提示词时应当报错")
	}
	if !strings.Contains(err.Error(), "直接输入创作提示词") {
		t.Fatalf("错误提示应引导用户补输入，实际: %v", err)
	}
}