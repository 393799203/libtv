package repository

import (
	"encoding/json"
	"testing"

	"gorm.io/datatypes"
)

// 画布保存的「产物字段只增不减」是防「明明生成了、一刷新又变回生成中」的关键规则，
// 这里把边界钉住：产物保留、状态以新值为准、非产物字段不受影响、老内容缺失时不炸。
func TestMergeStickyProducts(t *testing.T) {
	oldContent := datatypes.JSON(`{
		"nodes": [
			{"id": "v1", "type": "video", "position": {"x": 1, "y": 2},
			 "data": {"status": "success", "videoUrl": "https://cdn/keep.mp4", "thumbUrl": "https://cdn/keep.jpg", "prompt": "old"}},
			{"id": "t1", "type": "text", "data": {"status": "success", "content": "已生成的剧本"}},
			{"id": "gone", "type": "image", "data": {"status": "success", "imageUrl": "https://cdn/gone.png"}}
		],
		"edges": [{"id": "e1", "source": "v1", "target": "t1"}],
		"viewport": {"x": 0, "y": 0, "zoom": 1}
	}`)

	cases := []struct {
		name        string
		newContent  string
		wantVideo   string
		wantThumb   string
		wantContent string
		wantStatus  string
		wantPrompt  string
	}{
		{
			// 前端旧快照：产物字段全空、状态回 running（SSE 丢事件时的真实场景）
			name:       "旧快照不抹产物，但状态以新值为准",
			newContent: `{"nodes":[{"id":"v1","type":"video","position":{"x":1,"y":2},"data":{"status":"running","progressMessage":"已运行 3s"}}],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`,
			wantVideo:  "https://cdn/keep.mp4",
			wantThumb:  "https://cdn/keep.jpg",
			wantStatus: "running",
			// 注意范围：只对**产物字段**做保留。prompt/position 等其它字段一律以即将保存的
			// 内容为准（客户端才是这些字段的权威），否则用户清空提示词、移动节点都会被"复活"。
			wantPrompt: "",
		},
		{
			// 显式写入新产物：以新值为准（用户重新生成/替换）
			name:       "新产物覆盖旧产物",
			newContent: `{"nodes":[{"id":"v1","type":"video","data":{"status":"success","videoUrl":"https://cdn/new.mp4","thumbUrl":"https://cdn/new.jpg"}}],"edges":[],"viewport":{}}`,
			wantVideo:  "https://cdn/new.mp4",
			wantThumb:  "https://cdn/new.jpg",
			wantStatus: "success",
			wantPrompt: "",
		},
		{
			// 空串/null/空数组都算「没有产物」，必须用磁盘上的值补回
			name:        "空串与null视为缺失并被补回",
			newContent:  `{"nodes":[{"id":"t1","type":"text","data":{"status":"running","content":""}}],"edges":[],"viewport":{}}`,
			wantStatus:  "running",
			wantContent: "已生成的剧本",
		},
		{
			// 节点被删除：不该把它从画布里复活
			name:       "已删除的节点不复活",
			newContent: `{"nodes":[],"edges":[],"viewport":{}}`,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			merged := mergeStickyProducts(oldContent, datatypes.JSON(tc.newContent))
			var doc struct {
				Nodes []struct {
					ID   string                     `json:"id"`
					Data map[string]json.RawMessage `json:"data"`
				} `json:"nodes"`
				Edges []json.RawMessage `json:"edges"`
			}
			if err := json.Unmarshal(merged, &doc); err != nil {
				t.Fatalf("合并结果不是合法 JSON: %v", err)
			}
			if len(doc.Nodes) == 0 {
				if tc.wantVideo != "" || tc.wantContent != "" {
					t.Fatalf("节点被丢光了: %s", string(merged))
				}
				return
			}
			got := map[string]string{}
			for _, n := range doc.Nodes {
				for _, f := range []string{"videoUrl", "thumbUrl", "content", "status", "prompt"} {
					if raw, ok := n.Data[f]; ok {
						var s string
						_ = json.Unmarshal(raw, &s)
						if s != "" {
							got[f] = s
						}
					}
				}
			}
			check := func(field, want string) {
				if want != "" && got[field] != want {
					t.Errorf("%s = %q, 期望 %q", field, got[field], want)
				}
			}
			check("videoUrl", tc.wantVideo)
			check("thumbUrl", tc.wantThumb)
			check("content", tc.wantContent)
			check("status", tc.wantStatus)
			check("prompt", tc.wantPrompt)
		})
	}
}

// 内容为空/非法时不能把画布写坏：必须原样返回待保存的内容
func TestMergeStickyProducts_DegradesSafely(t *testing.T) {
	incoming := datatypes.JSON(`{"nodes":[{"id":"a","data":{"status":"running"}}]}`)
	for _, old := range []datatypes.JSON{nil, datatypes.JSON(``), datatypes.JSON(`not-json`), datatypes.JSON(`{}`)} {
		if got := string(mergeStickyProducts(old, incoming)); got != string(incoming) {
			t.Fatalf("旧内容 %q 时未原样返回，得到 %q", string(old), got)
		}
	}
	if got := string(mergeStickyProducts(datatypes.JSON(`{"nodes":[]}`), datatypes.JSON(`oops`))); got != "oops" {
		t.Fatalf("新内容非法时应原样返回，得到 %q", got)
	}
}
