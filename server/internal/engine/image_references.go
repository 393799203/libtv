package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type imageReference struct {
	NodeID string
	URL    string
	Label  string
	Style  bool
	Previz bool
}

// imageReferences 是本次请求唯一的图片顺序。图号、占位符和 API 图片数组均读这一份，
// 不再分别排列风格图和内容图后重组。
type imageReferences struct {
	Images   []imageReference
	Mentions []promptMention
}

func activePromptMentions(prompt string, raw json.RawMessage) ([]promptMention, error) {
	var mentions []promptMention
	if len(raw) > 0 && json.Unmarshal(raw, &mentions) != nil {
		return nil, fmt.Errorf("参考素材信息无法读取，请重新选择参考节点")
	}
	known := make(map[string]bool, len(mentions))
	for _, mention := range mentions {
		known[mention.ID] = true
	}
	for _, marker := range mentionMarkerRe.FindAllString(prompt, -1) {
		id := strings.TrimSuffix(strings.TrimPrefix(marker, "[[m:"), "]]")
		if !known[id] {
			return nil, fmt.Errorf("参考节点的引用信息不完整，请删除失效引用并重新选择")
		}
	}
	active := make([]promptMention, 0, len(mentions))
	for _, m := range mentions {
		if m.ID == "" || strings.Contains(prompt, "[[m:"+m.ID+"]]") {
			active = append(active, m)
		}
	}
	// 旧数据里的数组顺序可能与提示词不一致；以用户实际引用的首次出现顺序为准。
	// 没有占位符 ID 的历史引用排在后面，维持它们原有的相对顺序。
	sort.SliceStable(active, func(i, j int) bool {
		position := func(m promptMention) int {
			if m.ID == "" {
				return len(prompt)
			}
			return strings.Index(prompt, "[[m:"+m.ID+"]]")
		}
		return position(active[i]) < position(active[j])
	})
	return active, nil
}

func readImageReference(nodeID, nodeType string, execCtx *ExecutionContext) (imageReference, bool) {
	ref := imageReference{NodeID: nodeID}
	raw, ok := execCtx.GetNodeData(nodeID)
	if !ok {
		return ref, false
	}
	var data struct {
		Type     string `json:"type"`
		Label    string `json:"label"`
		ImageURL string `json:"imageUrl"`
		StillURL string `json:"stillUrl"`
		StyleID  string `json:"styleId"`
	}
	if json.Unmarshal(raw, &data) != nil {
		return ref, false
	}
	ref.Label = data.Label
	ref.Style = data.StyleID != ""
	ref.Previz = nodeType == "previz" || data.Type == "previz"
	if ref.Previz {
		ref.URL = data.StillURL
	} else if nodeType == "image" || data.Type == "image" || data.ImageURL != "" {
		ref.URL = data.ImageURL
	}
	return ref, strings.TrimSpace(ref.URL) != ""
}

func resolveImageReferences(nodeID, prompt string, rawMentions json.RawMessage, execCtx *ExecutionContext) (imageReferences, error) {
	mentions, err := activePromptMentions(prompt, rawMentions)
	if err != nil {
		return imageReferences{}, err
	}
	result := imageReferences{Mentions: mentions}
	seen := make(map[string]bool)
	add := func(ref imageReference) {
		if !seen[ref.NodeID] {
			result.Images = append(result.Images, ref)
			seen[ref.NodeID] = true
		}
	}
	for _, mention := range mentions {
		if mention.NodeType != "image" && mention.NodeType != "previz" {
			continue
		}
		ref, ok := readImageReference(mention.NodeID, mention.NodeType, execCtx)
		if !ok {
			name := ref.Label
			if name == "" {
				name = mention.Label
			}
			if name == "" {
				name = mention.NodeID
			}
			return result, fmt.Errorf("参考图片「%s」尚未准备好，请先上传图片、完成生成或导出预演静帧", name)
		}
		add(ref)
	}

	explicitImages := len(result.Images) > 0
	var styles []imageReference
	for _, sourceID := range execCtx.GetUpstreamSources(nodeID) {
		ref, ok := readImageReference(sourceID, "", execCtx)
		if !ok || seen[sourceID] {
			continue
		}
		if ref.Style {
			styles = append(styles, ref)
		} else if !explicitImages {
			// 只有未明确 @ 图片时才使用连线兜底，尊重用户对内容图的选择。
			add(ref)
		}
	}
	for _, style := range styles {
		// 隐式风格图放在已选内容图之后，避免把用户的图1、图2整体挤后。
		duplicate := false
		for _, existing := range result.Images {
			if existing.Style && existing.URL == style.URL {
				duplicate = true
				break
			}
		}
		if !duplicate {
			add(style)
		}
	}
	return result, nil
}

func (refs imageReferences) urls() (all, styles, content []string) {
	for _, ref := range refs.Images {
		all = append(all, ref.URL)
		if ref.Style {
			styles = append(styles, ref.URL)
		} else {
			content = append(content, ref.URL)
		}
	}
	return
}

func (refs imageReferences) rewritePrompt(prompt string) string {
	numbers := make(map[string]int, len(refs.Images))
	for i, ref := range refs.Images {
		numbers[ref.NodeID] = i + 1
	}
	// 保留所有引用别名。同一张图在文中多次出现时，始终指向同一个图号。
	for _, mention := range refs.Mentions {
		if index, ok := numbers[mention.NodeID]; ok && mention.ID != "" {
			prompt = strings.ReplaceAll(prompt, "[[m:"+mention.ID+"]]", fmt.Sprintf("图%d", index))
		}
	}
	return prompt
}

func (refs imageReferences) describePrompt(prompt string) string {
	if len(refs.Images) == 0 {
		return prompt
	}
	var mapping strings.Builder
	mapping.WriteString("【本次参考图编号】\n以下图号严格对应本次请求图片数组的顺序：\n")
	for i, ref := range refs.Images {
		fmt.Fprintf(&mapping, "图%d", i+1)
		if ref.Label != "" {
			fmt.Fprintf(&mapping, "（名称：%q）", ref.Label)
		}
		switch {
		case ref.Style:
			mapping.WriteString("：仅提供画风、色彩与光影，不提供人物身份、人脸、服装或场景内容。\n")
		case ref.Previz:
			mapping.WriteString("：预演静帧，构图或姿态的具体用途以用户指令为准。\n")
		default:
			mapping.WriteString("：内容参考，各自提供的身份、人脸、动作或背景以用户指令为准。\n")
		}
	}
	mapping.WriteString("【参考规则】\n用户指定单一人物身份或人脸来源时，必须保持该图的人物身份，不得混入其他图的人脸。" +
		"某图仅用于动作、构图、背景或风格时，不得从该图替换人物身份。严格按每张图被指定的用途组合。\n【用户指令】\n")
	mapping.WriteString(prompt)
	return mapping.String()
}
