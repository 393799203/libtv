package engine

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type videoReference struct {
	NodeID string
	Label  string
	URL    string
	Style  bool
	Previz bool
	Slot   int
}

type videoReferences struct {
	Images   []videoReference
	Videos   []videoReference
	Audios   []videoReference
	Mentions []promptMention
	Mode     string
	bindings map[string][]videoReferenceBinding
}

type videoReferenceBinding struct {
	kind  string
	index int
}

type videoReferenceSource struct {
	Type         string `json:"type"`
	Label        string `json:"label"`
	ImageURL     string `json:"imageUrl"`
	VideoURL     string `json:"videoUrl"`
	AudioURL     string `json:"audioUrl"`
	StillURL     string `json:"stillUrl"`
	StyleID      string `json:"styleId"`
	RefIndex     int    `json:"refIndex"`
	ScriptNodeID string `json:"scriptNodeId"`
	ShotID       string `json:"shotId"`
}

func videoSource(nodeID string, execCtx *ExecutionContext) (videoReferenceSource, bool) {
	var source videoReferenceSource
	raw, ok := execCtx.GetNodeData(nodeID)
	if !ok || json.Unmarshal(raw, &source) != nil {
		return source, false
	}
	return source, true
}

func resolveVideoReferences(nodeID, prompt, mode string, raw json.RawMessage, execCtx *ExecutionContext) (videoReferences, error) {
	mentions, err := activePromptMentions(prompt, raw)
	if err != nil {
		return videoReferences{}, err
	}
	result := videoReferences{Mentions: mentions, Mode: mode, bindings: make(map[string][]videoReferenceBinding)}
	// 索引用 (类型, 节点)；预演可同时提供图片和视频，两类不互相去重。
	seenImages, seenVideos, seenAudios := map[string]bool{}, map[string]bool{}, map[string]bool{}
	seenMarkers := make(map[string]bool)
	add := func(nodeID string, source videoReferenceSource, kind string, duplicateFrame bool) {
		ref := videoReference{NodeID: nodeID, Label: source.Label, Style: source.StyleID != "", Previz: source.Type == "previz", Slot: source.RefIndex}
		switch kind {
		case "image":
			ref.URL = source.ImageURL
			if source.Type == "previz" {
				ref.URL = source.StillURL
			}
			if ref.URL != "" && (!seenImages[nodeID] || duplicateFrame) {
				result.Images = append(result.Images, ref)
				seenImages[nodeID] = true
			}
		case "video":
			ref.URL = source.VideoURL
			if ref.URL != "" && !seenVideos[nodeID] {
				result.Videos = append(result.Videos, ref)
				seenVideos[nodeID] = true
			}
		case "audio":
			ref.URL = source.AudioURL
			if ref.URL != "" && !seenAudios[nodeID] {
				result.Audios = append(result.Audios, ref)
				seenAudios[nodeID] = true
			}
		}
	}
	for _, mention := range mentions {
		if mention.NodeType != "image" && mention.NodeType != "video" && mention.NodeType != "audio" && mention.NodeType != "previz" {
			continue
		}
		if mention.ID != "" && seenMarkers[mention.ID] {
			continue
		}
		seenMarkers[mention.ID] = true
		source, ok := videoSource(mention.NodeID, execCtx)
		if source.Type == "" {
			source.Type = mention.NodeType
		}
		if source.Label == "" {
			source.Label = mention.Label
		}
		if mode == "first-last-frame" && (mention.NodeType == "video" || mention.NodeType == "audio") {
			return result, fmt.Errorf("首尾帧模式不能引用视频或音频，请移除对应引用或切换全能参考模式")
		}
		ready := ok
		switch mention.NodeType {
		case "image":
			ready = ready && strings.TrimSpace(source.ImageURL) != ""
			add(mention.NodeID, source, "image", mode == "first-last-frame")
		case "video":
			ready = ready && strings.TrimSpace(source.VideoURL) != ""
			add(mention.NodeID, source, "video", false)
		case "audio":
			ready = ready && strings.TrimSpace(source.AudioURL) != ""
			add(mention.NodeID, source, "audio", false)
		case "previz":
			if mode == "first-last-frame" {
				ready = ready && strings.TrimSpace(source.StillURL) != ""
			} else {
				ready = ready && (strings.TrimSpace(source.StillURL) != "" || strings.TrimSpace(source.VideoURL) != "")
				add(mention.NodeID, source, "video", false)
			}
			add(mention.NodeID, source, "image", mode == "first-last-frame")
		}
		if !ready {
			name := source.Label
			if name == "" {
				name = mention.NodeID
			}
			return result, fmt.Errorf("参考素材「%s」尚未准备好，请先上传、生成或导出预演素材", name)
		}
	}
	explicitImages, explicitVideos, explicitAudios := len(result.Images) > 0, len(result.Videos) > 0, len(result.Audios) > 0
	var styles []struct {
		id     string
		source videoReferenceSource
	}
	for _, sourceID := range execCtx.GetUpstreamSources(nodeID) {
		source, ok := videoSource(sourceID, execCtx)
		if !ok {
			continue
		}
		missing := (!explicitImages && source.Type == "image" && source.StyleID == "" && strings.TrimSpace(source.ImageURL) == "") ||
			(mode == "first-last-frame" && !explicitImages && source.Type == "previz" && strings.TrimSpace(source.StillURL) == "") ||
			(mode != "first-last-frame" && !explicitVideos && len(result.Videos) == 0 && source.Type == "video" && strings.TrimSpace(source.VideoURL) == "") ||
			(mode != "first-last-frame" && !explicitAudios && source.Type == "audio" && strings.TrimSpace(source.AudioURL) == "")
		if missing {
			name := source.Label
			if name == "" {
				name = sourceID
			}
			return result, fmt.Errorf("上游参考素材「%s」尚未准备好，请先完成该素材或移除对应连线", name)
		}
		if source.Type == "image" || source.Type == "previz" {
			if source.StyleID != "" && mode != "first-last-frame" && !seenImages[sourceID] {
				styles = append(styles, struct {
					id     string
					source videoReferenceSource
				}{sourceID, source})
			} else if !explicitImages && source.StyleID == "" {
				add(sourceID, source, "image", mode == "first-last-frame")
			}
		}
		if mode != "first-last-frame" {
			// 与现有前端费用预估一致：没有显式视频引用时只补第一条参考视频。
			if !explicitVideos && len(result.Videos) == 0 && (source.Type == "video" || source.Type == "previz") {
				add(sourceID, source, "video", false)
			}
			if !explicitAudios && source.Type == "audio" {
				add(sourceID, source, "audio", false)
			}
		}
	}
	for _, style := range styles {
		add(style.id, style.source, "image", false)
	}
	if mode == "first-last-frame" {
		if len(result.Images) == 0 || len(result.Images) > 2 {
			return result, fmt.Errorf("首尾帧模式需要 1–2 张图片，请明确选择首帧和尾帧后重试")
		}
		// 分镜有明确槽位时按 refIndex 定位首尾，提示词先提到尾帧也不能颠倒两帧。
		target, _ := videoSource(nodeID, execCtx)
		slots := target.ScriptNodeID != "" && target.ShotID != ""
		for _, ref := range result.Images {
			source, _ := videoSource(ref.NodeID, execCtx)
			slots = slots && source.ScriptNodeID == target.ScriptNodeID && source.ShotID == target.ShotID && ref.Slot > 0
		}
		if slots {
			sort.SliceStable(result.Images, func(i, j int) bool { return result.Images[i].Slot < result.Images[j].Slot })
			if result.Images[0].Slot != 1 {
				return result, fmt.Errorf("首帧槽位尚未准备好，不能将尾帧当作首帧，请补充起始画面")
			}
			if len(result.Images) == 2 && result.Images[0].NodeID != result.Images[1].NodeID && result.Images[1].Slot != 2 {
				return result, fmt.Errorf("首尾帧槽位不明确，请保留第1张起始画面和第2张结束画面")
			}
		}
	} else if len(result.Images) > videoMaxRefImages {
		return result, fmt.Errorf("参考图片共 %d 张，最多支持 %d 张，请减少引用后重试", len(result.Images), videoMaxRefImages)
	}
	// 所有数组顺序确定以后，再用不可变的类型和序号绑定标记。
	frameUse := make(map[string]int)
	for _, mention := range mentions {
		if mention.ID == "" || len(result.bindings[mention.ID]) > 0 {
			continue
		}
		var imageIndices []int
		for i := range result.Images {
			if result.Images[i].NodeID == mention.NodeID {
				imageIndices = append(imageIndices, i)
			}
		}
		if len(imageIndices) > 0 {
			slot := 0
			if mode == "first-last-frame" && len(imageIndices) > 1 {
				slot = frameUse[mention.NodeID] % len(imageIndices)
				frameUse[mention.NodeID]++
			}
			result.bindings[mention.ID] = append(result.bindings[mention.ID], videoReferenceBinding{"image", imageIndices[slot]})
		}
		for _, group := range []struct {
			refs []videoReference
			kind string
		}{{result.Videos, "video"}, {result.Audios, "audio"}} {
			for i := range group.refs {
				if group.refs[i].NodeID == mention.NodeID {
					result.bindings[mention.ID] = append(result.bindings[mention.ID], videoReferenceBinding{group.kind, i})
					break
				}
			}
		}
	}
	return result, nil
}

func (refs videoReferences) urls() (images, videos, audios []string) {
	for _, ref := range refs.Images {
		images = append(images, ref.URL)
	}
	for _, ref := range refs.Videos {
		videos = append(videos, ref.URL)
	}
	for _, ref := range refs.Audios {
		audios = append(audios, ref.URL)
	}
	return
}

func (refs videoReferences) name(binding videoReferenceBinding) string {
	switch binding.kind {
	case "image":
		if refs.Mode == "first-last-frame" {
			if binding.index == 0 {
				return "首帧（图1）"
			}
			return "尾帧（图2）"
		}
		return fmt.Sprintf("图%d", binding.index+1)
	case "video":
		return fmt.Sprintf("视频%d", binding.index+1)
	case "audio":
		return fmt.Sprintf("音频%d", binding.index+1)
	}
	return ""
}

func (refs videoReferences) rewritePrompt(prompt string) string {
	for id, sources := range refs.bindings {
		if id == "" {
			continue
		}
		var names []string
		for _, source := range sources {
			if name := refs.name(source); name != "" {
				names = append(names, name)
			}
		}
		prompt = strings.ReplaceAll(prompt, "[[m:"+id+"]]", strings.Join(names, "、"))
	}
	return stripMentionMarkers(prompt)
}

func (refs videoReferences) describePrompt(prompt string) string {
	if len(refs.Images)+len(refs.Videos)+len(refs.Audios) == 0 {
		return prompt
	}
	var out strings.Builder
	out.WriteString("【本次视频参考素材】\n图片、视频、音频分别从1编号，与实际发送的各类素材顺序一致：\n")
	for _, group := range []struct {
		items []videoReference
		kind  string
	}{{refs.Images, "image"}, {refs.Videos, "video"}, {refs.Audios, "audio"}} {
		for i, ref := range group.items {
			out.WriteString(refs.name(videoReferenceBinding{group.kind, i}))
			if ref.Label != "" {
				fmt.Fprintf(&out, "（名称：%q）", ref.Label)
			}
			switch {
			case ref.Style && refs.Mode != "first-last-frame":
				out.WriteString("：仅参考画风、色彩和光影，不替换主体身份。\n")
			case ref.Previz:
				out.WriteString("：预演素材，走位、动作、构图或运镜用途以用户指令为准。\n")
			default:
				out.WriteString("：具体用途以用户指令为准。\n")
			}
		}
	}
	out.WriteString("【参考规则】\n严格区分身份、人脸、动作、背景、运镜与声音来源。" +
		"用户指定单一人脸或身份来源时，不得混入其他参考素材中的人脸；只参考动作、构图、运镜或声音的素材不得替换人物身份。\n")
	if refs.Mode == "first-last-frame" {
		out.WriteString("首帧用于起始画面；存在尾帧时，尾帧用于结束画面。保持两者位置，不得互换。\n")
	}
	out.WriteString("【用户指令】\n")
	out.WriteString(prompt)
	return out.String()
}
