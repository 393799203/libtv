package handler

import (
	"encoding/json"
	"testing"

	"libtv/internal/engine"
)

// 节点产出写回画布是「状态必须等于事实」的最后一步：产物要落下去、
// 失败要带原因、且任何一次失败/重跑都不能把已经交付的产物抹掉。
func TestMergeNodeOutputData(t *testing.T) {
	decode := func(m map[string]json.RawMessage) map[string]string {
		out := map[string]string{}
		for k, raw := range m {
			var s string
			if err := json.Unmarshal(raw, &s); err == nil {
				out[k] = s
			}
		}
		return out
	}

	t.Run("成功：写产物、清历史错误", func(t *testing.T) {
		existing := map[string]json.RawMessage{
			"status": json.RawMessage(`"failed"`),
			"error":  json.RawMessage(`"上一次失败"`),
		}
		mergeNodeOutputData(existing, &engine.NodeOutput{
			Status: "success",
			Data: map[string]interface{}{
				"videoUrl": "https://cdn/v.mp4",
				"thumbUrl": "https://cdn/t.jpg",
			},
		})
		got := decode(existing)
		if got["status"] != "success" || got["videoUrl"] != "https://cdn/v.mp4" || got["thumbUrl"] != "https://cdn/t.jpg" {
			t.Fatalf("产物未写全: %v", got)
		}
		if _, ok := existing["error"]; ok {
			t.Fatalf("成功时必须清掉历史 error，否则前端一直挂着红框: %v", got)
		}
	})

	t.Run("失败：写错误但保留已交付产物", func(t *testing.T) {
		existing := map[string]json.RawMessage{
			"status":   json.RawMessage(`"success"`),
			"videoUrl": json.RawMessage(`"https://cdn/keep.mp4"`),
		}
		mergeNodeOutputData(existing, &engine.NodeOutput{
			Status: "failed",
			Error:  "上游轮询超时",
		})
		got := decode(existing)
		if got["status"] != "failed" || got["error"] != "上游轮询超时" {
			t.Fatalf("失败态/原因未写入: %v", got)
		}
		if got["videoUrl"] != "https://cdn/keep.mp4" {
			t.Fatalf("失败不能抹掉上一次已交付的视频地址: %v", got)
		}
	})

	t.Run("空产物不覆盖已有产物", func(t *testing.T) {
		existing := map[string]json.RawMessage{
			"imageUrl": json.RawMessage(`"https://cdn/keep.png"`),
		}
		mergeNodeOutputData(existing, &engine.NodeOutput{
			Status: "success",
			Data:   map[string]interface{}{"imageUrl": ""},
		})
		got := decode(existing)
		if got["imageUrl"] != "https://cdn/keep.png" {
			t.Fatalf("空串不该把已有产物抹掉: %v", got)
		}
	})

	t.Run("多图与尺寸一并写回", func(t *testing.T) {
		existing := map[string]json.RawMessage{}
		mergeNodeOutputData(existing, &engine.NodeOutput{
			Status: "success",
			Data: map[string]interface{}{
				"imageUrls": []string{"https://cdn/1.png", "https://cdn/2.png"},
				"width":     float64(2560),
				"height":    float64(1440),
			},
		})
		var urls []string
		if err := json.Unmarshal(existing["imageUrls"], &urls); err != nil || len(urls) != 2 {
			t.Fatalf("imageUrls 未写回: %v", decode(existing))
		}
		got := decode(existing)
		if got["width"] != "2560" && string(existing["width"]) != "2560" {
			t.Fatalf("width 未写回: %s", string(existing["width"]))
		}
	})

	t.Run("音频/白模静帧/多缩略图产物同样落库", func(t *testing.T) {
		existing := map[string]json.RawMessage{}
		mergeNodeOutputData(existing, &engine.NodeOutput{
			Status: "success",
			Data: map[string]interface{}{
				"audioUrl":  "https://cdn/a.mp3",
				"stillUrl":  "https://cdn/s.jpg",
				"thumbUrls": []string{"https://cdn/t1.jpg", "https://cdn/t2.jpg"},
			},
		})
		got := decode(existing)
		if got["audioUrl"] != "https://cdn/a.mp3" {
			t.Fatalf("音频产物未落库（关掉页面就丢）: %v", got)
		}
		if got["stillUrl"] != "https://cdn/s.jpg" {
			t.Fatalf("白模静帧未落库: %v", got)
		}
		var thumbs []string
		if err := json.Unmarshal(existing["thumbUrls"], &thumbs); err != nil || len(thumbs) != 2 {
			t.Fatalf("多缩略图未落库: %s", string(existing["thumbUrls"]))
		}
	})
}
