// Canvas plans extend the existing assistant with bounded project-level tools.
package assistant

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

type Node struct {
	ID   string                 `json:"id"`
	Type string                 `json:"type"`
	Data map[string]interface{} `json:"data"`
}

type Connection struct {
	Source string `json:"source"`
	Target string `json:"target"`
}

type Snapshot struct {
	Nodes           []Node       `json:"nodes"`
	Connections     []Connection `json:"connections"`
	SelectedNodeIDs []string     `json:"selectedNodeIds"`
	TotalNodes      int          `json:"totalNodes"`
}

type CreateNode struct {
	ID           string `json:"id"`
	Type         string `json:"type"`
	Label        string `json:"label"`
	Prompt       string `json:"prompt"`
	Content      string `json:"content,omitempty"`
	ScriptNodeID string `json:"scriptNodeId,omitempty"`
	ShotID       string `json:"shotId,omitempty"`
	RefIndex     int    `json:"refIndex,omitempty"`
}

type UpdateNode struct {
	NodeID string  `json:"nodeId"`
	Label  *string `json:"label,omitempty"`
	Prompt *string `json:"prompt,omitempty"`
}

type Plan struct {
	Message         string       `json:"message"`
	NextSteps       []string     `json:"nextSteps"`
	CreateNodes     []CreateNode `json:"createNodes"`
	UpdateNodes     []UpdateNode `json:"updateNodes"`
	Connections     []Connection `json:"connections"`
	GenerateNodeIDs []string     `json:"generateNodeIds"`
}

// PlanError identifies model-output errors which can be corrected once before
// returning a failure. Network/provider errors must never trigger this retry.
type PlanError struct {
	Kind   string
	Reason string
}

func (e *PlanError) Error() string { return e.Reason }

func supported(t string) bool {
	return t == "text" || t == "script" || t == "image" || t == "video" || t == "audio"
}

// ValidateSnapshot rejects oversized or ambiguous context before an upstream call.
func ValidateSnapshot(s Snapshot) error {
	if len(s.Nodes) > 160 || len(s.Connections) > 640 || len(s.SelectedNodeIDs) > 160 {
		return fmt.Errorf("画布上下文过大，请缩小选中范围")
	}
	rawSnapshot, err := json.Marshal(s)
	if err != nil || len(rawSnapshot) > 128000 {
		return fmt.Errorf("画布上下文过大，请缩小选中范围")
	}
	ids := make(map[string]bool, len(s.Nodes))
	for _, n := range s.Nodes {
		if n.ID == "" || len(n.ID) > 128 || strings.HasPrefix(n.ID, "new:") || ids[n.ID] {
			return fmt.Errorf("画布节点标识无效")
		}
		ids[n.ID] = true
		raw, err := json.Marshal(n.Data)
		if err != nil || len(raw) > 48000 {
			return fmt.Errorf("单个节点上下文过大")
		}
	}
	for _, e := range s.Connections {
		if !ids[e.Source] || !ids[e.Target] {
			return fmt.Errorf("画布连线引用不存在的节点")
		}
	}
	for _, id := range s.SelectedNodeIDs {
		if !ids[id] {
			return fmt.Errorf("选中节点不在上下文中")
		}
	}
	return nil
}

// Parse accepts a JSON object or a single Markdown JSON fence, never embedded code.
func Parse(text string, snapshot Snapshot) (*Plan, error) {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```") {
		if end := strings.IndexByte(text, '\n'); end >= 0 && strings.HasSuffix(text, "```") {
			text = strings.TrimSpace(text[end+1 : len(text)-3])
		}
	}
	var p Plan
	d := json.NewDecoder(strings.NewReader(text))
	d.DisallowUnknownFields()
	if err := d.Decode(&p); err != nil {
		return nil, &PlanError{Kind: "format", Reason: fmt.Sprintf("操作计划格式无效：%v", err)}
	}
	if err := d.Decode(new(interface{})); err != io.EOF {
		return nil, &PlanError{Kind: "format", Reason: "操作计划包含多余内容"}
	}
	// An orphan slot index carries no identity and is irrelevant for an ordinary
	// node. Ignore it; never discard or invent an explicit script/shot reference.
	for i := range p.CreateNodes {
		n := &p.CreateNodes[i]
		if n.ScriptNodeID == "" && n.ShotID == "" {
			n.RefIndex = 0
		} else if n.Type == "image" && n.ScriptNodeID != "" && n.ShotID != "" && n.RefIndex == 0 {
			n.RefIndex = 1
		}
	}
	if err := Validate(p, snapshot); err != nil {
		return nil, &PlanError{Kind: "validation", Reason: err.Error()}
	}
	// Keep the wire contract stable: Go nil slices encode as null, while the
	// browser deliberately accepts only arrays before applying any operations.
	if p.NextSteps == nil {
		p.NextSteps = []string{}
	}
	if p.CreateNodes == nil {
		p.CreateNodes = []CreateNode{}
	}
	if p.UpdateNodes == nil {
		p.UpdateNodes = []UpdateNode{}
	}
	if p.Connections == nil {
		p.Connections = []Connection{}
	}
	if p.GenerateNodeIDs == nil {
		p.GenerateNodeIDs = []string{}
	}
	return &p, nil
}

func Validate(p Plan, snapshot Snapshot) error {
	if strings.TrimSpace(p.Message) == "" || utf8.RuneCountInString(p.Message) > 6000 {
		return fmt.Errorf("助手回复为空或过长")
	}
	if len(p.NextSteps) > 3 || len(p.CreateNodes) > 12 || len(p.UpdateNodes) > 12 ||
		len(p.Connections) > 36 || len(p.GenerateNodeIDs) > 8 {
		return fmt.Errorf("本次操作过多，请分阶段执行")
	}
	for _, step := range p.NextSteps {
		if utf8.RuneCountInString(step) > 200 {
			return fmt.Errorf("后续建议过长")
		}
	}
	types := make(map[string]string)
	existing := make(map[string]Node)
	busy := make(map[string]bool)
	for _, n := range snapshot.Nodes {
		types[n.ID], existing[n.ID] = n.Type, n
		busy[n.ID] = n.Data["status"] == "running" || n.Data["status"] == "pending"
	}
	for _, n := range p.CreateNodes {
		if !strings.HasPrefix(n.ID, "new:") || len(n.ID) > 80 || types[n.ID] != "" || !supported(n.Type) {
			return fmt.Errorf("助手创建了无效或重复的节点")
		}
		if strings.TrimSpace(n.Label) == "" || utf8.RuneCountInString(n.Label) > 80 ||
			utf8.RuneCountInString(n.Prompt) > 8000 || utf8.RuneCountInString(n.Content) > 12000 {
			return fmt.Errorf("新节点内容为空或过长")
		}
		if n.Content != "" && n.Type != "text" {
			return fmt.Errorf("只有文本节点可以直接写入正文")
		}
		if n.ScriptNodeID != "" || n.ShotID != "" || n.RefIndex != 0 {
			script, ok := existing[n.ScriptNodeID]
			if !ok || script.Type != "script" || n.Type != "image" || n.RefIndex < 1 || n.RefIndex > 2 {
				return fmt.Errorf("「%s」的分镜归属无效：仅分镜图片能关联当前画布中已有的分镜，槽位须为1或2", n.Label)
			}
			found := false
			if shots, ok := script.Data["shots"].([]interface{}); ok {
				for _, raw := range shots {
					if shot, ok := raw.(map[string]interface{}); ok && shot["id"] == n.ShotID {
						found = true
					}
				}
			}
			if !found {
				return fmt.Errorf("「%s」引用的镜头不在当前分镜中", n.Label)
			}
		}
		types[n.ID] = n.Type
	}
	updated := make(map[string]bool)
	for _, u := range p.UpdateNodes {
		n, ok := existing[u.NodeID]
		if !ok || !supported(n.Type) || busy[u.NodeID] || updated[u.NodeID] || (u.Label == nil && u.Prompt == nil) {
			return fmt.Errorf("不能修改不存在、重复或正在生成的节点")
		}
		if u.Label != nil && (strings.TrimSpace(*u.Label) == "" || utf8.RuneCountInString(*u.Label) > 80) ||
			u.Prompt != nil && utf8.RuneCountInString(*u.Prompt) > 8000 {
			return fmt.Errorf("修改的节点内容无效")
		}
		updated[u.NodeID] = true
	}
	// Test each new edge against the existing graph, rather than rejecting unrelated
	// legacy cycles elsewhere on the canvas.
	edges := append([]Connection(nil), snapshot.Connections...)
	for _, e := range p.Connections {
		if !supported(types[e.Source]) || !supported(types[e.Target]) || e.Source == e.Target || busy[e.Target] ||
			!canConnect(types[e.Source], types[e.Target]) {
			return fmt.Errorf("不能连接不存在、运行中或不支持的节点")
		}
		if reachable(e.Target, e.Source, edges) {
			return fmt.Errorf("本次连接会形成循环，请调整流程")
		}
		edges = append(edges, e)
	}
	generated := make(map[string]bool)
	for _, id := range p.GenerateNodeIDs {
		if !supported(types[id]) || busy[id] || generated[id] {
			return fmt.Errorf("生成目标无效、重复或正在运行")
		}
		generated[id] = true
	}
	// Each card runs one ready stage. Dependent stages require a new user turn
	// after the upstream outputs are available.
	for _, e := range edges {
		if generated[e.Source] && generated[e.Target] {
			return fmt.Errorf("请先生成上游节点，再继续下一阶段")
		}
	}
	return nil
}

// Keep in sync with PROMPT_PANEL_CONFIGS.acceptedInputs for these five tools.
func canConnect(source, target string) bool {
	switch target {
	case "script":
		return source == "text"
	case "audio":
		return source == "text" || source == "script"
	case "image", "text":
		return source == "text" || source == "script" || source == "image"
	case "video":
		return supported(source)
	default:
		return false
	}
}

func reachable(from, to string, edges []Connection) bool {
	seen := map[string]bool{}
	queue := []string{from}
	for len(queue) > 0 {
		id := queue[0]
		queue = queue[1:]
		if id == to {
			return true
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		for _, e := range edges {
			if e.Source == id {
				queue = append(queue, e.Target)
			}
		}
	}
	return false
}
