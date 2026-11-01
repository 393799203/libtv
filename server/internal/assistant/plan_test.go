package assistant

import (
	"encoding/json"
	"strings"
	"testing"
)

func sampleSnapshot() Snapshot {
	return Snapshot{
		Nodes: []Node{
			{ID: "story", Type: "text", Data: map[string]interface{}{"content": "小狐狸下山"}},
			{ID: "script", Type: "script", Data: map[string]interface{}{"shots": []interface{}{
				map[string]interface{}{"id": "shot-1", "visual": "山间小路"},
			}}},
			{ID: "image", Type: "image", Data: map[string]interface{}{"hasImage": true}},
		},
		Connections: []Connection{{Source: "story", Target: "script"}},
	}
}

func TestPlanValidShotImage(t *testing.T) {
	p, err := Parse("```json\n"+`{
		"message":"准备为第一镜补图",
		"createNodes":[{"id":"new:frame","type":"image","label":"第一镜首帧","prompt":"山间小路上的狐狸","scriptNodeId":"script","shotId":"shot-1","refIndex":1}],
		"connections":[{"source":"script","target":"new:frame"},{"source":"image","target":"new:frame"}],
		"generateNodeIds":["new:frame"]
	}`+"\n```", sampleSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	if len(p.CreateNodes) != 1 || p.NextSteps == nil || p.UpdateNodes == nil {
		t.Fatalf("invalid normalized plan: %+v", p)
	}
}

func TestPlanRejectsUnsafeToolsAndReferences(t *testing.T) {
	cases := map[string]string{
		"code execution":       `{"message":"执行","code":"alert(1)"}`,
		"media overwrite":      `{"message":"覆盖","updateNodes":[{"nodeId":"image","imageUrl":"fake"}]}`,
		"unknown node":         `{"message":"生成","generateNodeIds":["not-on-canvas"]}`,
		"cycle":                `{"message":"连线","connections":[{"source":"script","target":"story"}]}`,
		"self edge":            `{"message":"连线","connections":[{"source":"story","target":"story"}]}`,
		"unsupported type":     `{"message":"创建","createNodes":[{"id":"new:1","type":"shell","label":"脚本"}]}`,
		"duplicate aliases":    `{"message":"创建","createNodes":[{"id":"new:1","type":"text","label":"A"},{"id":"new:1","type":"text","label":"B"}]}`,
		"fake shot":            `{"message":"创建","createNodes":[{"id":"new:1","type":"image","label":"图","scriptNodeId":"script","shotId":"missing","refIndex":1}]}`,
		"write output":         `{"message":"创建","createNodes":[{"id":"new:1","type":"image","label":"图","content":"fake output"}]}`,
		"duplicate generation": `{"message":"生成","generateNodeIds":["image","image"]}`,
		"dependent stage":      `{"message":"生成","generateNodeIds":["story","script"]}`,
		"trailing JSON":        `{"message":"你好"} {"message":"另一个计划"}`,
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(input, sampleSnapshot()); err == nil {
				t.Fatal("expected rejection")
			}
		})
	}
	snapshot := sampleSnapshot()
	snapshot.Nodes[0].Data["status"] = "running"
	if _, err := Parse(`{"message":"修改","updateNodes":[{"nodeId":"story","prompt":"改写"}]}`, snapshot); err == nil {
		t.Fatal("running node must not be modified")
	}
}

func TestSnapshotBoundsAndSelection(t *testing.T) {
	s := sampleSnapshot()
	s.SelectedNodeIDs = []string{"missing"}
	if ValidateSnapshot(s) == nil {
		t.Fatal("missing selection accepted")
	}
	s = sampleSnapshot()
	s.Nodes[0].Data["content"] = strings.Repeat("字", 20000)
	if ValidateSnapshot(s) == nil {
		t.Fatal("oversized data accepted")
	}
}

func TestSuggestionHasArrayWireContract(t *testing.T) {
	p, err := Parse(`{"message":"建议先准备角色图"}`, sampleSnapshot())
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(p)
	if strings.Contains(string(raw), "null") {
		t.Fatalf("array fields must not serialize as null: %s", raw)
	}
}

func TestPlanNormalizesOnlyUnambiguousSlotDefaults(t *testing.T) {
	ordinary, err := Parse(`{"message":"准备创建故事","createNodes":[{"id":"new:story","type":"text","label":"故事","prompt":"","content":"狐狸下山","refIndex":1}]}`, sampleSnapshot())
	if err != nil || ordinary.CreateNodes[0].RefIndex != 0 {
		t.Fatalf("ordinary index should be ignored: %+v %v", ordinary, err)
	}
	frame, err := Parse(`{"message":"准备首帧","createNodes":[{"id":"new:image","type":"image","label":"首帧","scriptNodeId":"script","shotId":"shot-1"}]}`, sampleSnapshot())
	if err != nil || frame.CreateNodes[0].RefIndex != 1 {
		t.Fatalf("default slot: %+v %v", frame, err)
	}
	if _, err := Parse(`{"message":"创建","createNodes":[{"id":"new:text","type":"text","label":"故事","scriptNodeId":"script","shotId":"shot-1","refIndex":1}]}`, sampleSnapshot()); err == nil {
		t.Fatal("explicit incompatible ownership must not be discarded")
	}
}
