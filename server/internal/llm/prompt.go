package llm

import (
	"fmt"
	"regexp"
	"strings"
)

// viewMarkerRe 匹配视图要求标记【三视图要求】、【四视图要求】、【六视图要求】
var viewMarkerRe = regexp.MustCompile(`【三视图要求】[^\n]*|【四视图要求】[^\n]*|【六视图要求】[^\n]*`)

// StorySystemPrompt 故事/剧本文本生成 System Prompt
// 用于：用户输入提示词 → LLM 生成故事剧本文本 → 填充到 TextNode.content
const StorySystemPrompt = `你是一个富有创造力的影视编剧。你的任务是根据用户的创意提示，创作一段引人入胜的故事剧本文本。

## 输出要求

直接输出故事正文，使用 Markdown 格式。内容应包含：

1. **场景描述**：用生动的语言描绘环境、氛围、光影
2. **角色行为**：角色的动作、表情、心理活动
3. **对白**：自然流畅的角色对话（如有角色）
4. **叙事节奏**：开头抓人、中间有冲突或转折、结尾有回味

## 创作原则

- 字数 500~2000 字，根据用户提示的复杂度灵活调整
- 风格可以多样：悬疑、治愈、科幻、爱情、喜剧等，根据用户提示自动匹配
- 注重画面感，因为后续会基于此文本生成视频分镜
- 对白要符合人物性格，不要说教
- 不要输出标题、作者、摘要等元信息，直接开始故事正文
- 用中文写作`

// BuildStoryUserPrompt 构建故事生成的用户 Prompt
func BuildStoryUserPrompt(userPrompt string) string {
	return fmt.Sprintf("请根据以下创意提示，创作一段影视故事剧本：\n\n%s", userPrompt)
}

// ScriptSystemPrompt 剧本/分镜生成 System Prompt（后续脚本节点用）
const ScriptSystemPrompt = `你是一个专业的影视剧本编剧和分镜师。你的任务是将用户提供的文本内容（故事大纲、场景描述、角色设定等）转化为结构化的影视分镜脚本。

## 输出要求

你必须严格以 JSON 格式输出，包含以下字段：

- scriptContent: 完整的剧本文本（Markdown格式，包含场景描述和对白）
- characters: 角色列表，每个角色有 name（名字）、description（详细的角色三视图文生图提示词，包含：基本外貌、面部特征、服装细节、性格气质、三视图要求）、imageUrl（空字符串，用户后续上传参考图）
- scenes: 场景列表，每个场景有 name（场景名称）、description（场景四视图文生图提示词）、timeOfDay（时段：早晨/上午/中午/下午/傍晚/夜晚/深夜）、location（具体地点）、mood（氛围情绪）、imageUrl（空字符串）
- props: 道具列表，每个道具有 name（名称）、description（道具六视图文生图提示词）、category（分类：服装/武器/交通工具/日常用品/电子设备/其他）、imageUrl（空字符串）
- shots: 分镜列表，每个分镜包含：
  - id: 唯一标识，如 "shot-1"
  - shotNumber: 镜头序号（从1开始递增）
  - duration: 时长（秒），建议2-8秒
  - visualPrompt: 画面内容的详细描述，用于AI图像生成
  - shotSize: 镜别（特写/近景/中景/全景/远景/大远景）
  - cameraAngle: 拍摄角度（俯视/仰视/平视/鸟瞰/倾斜）
  - dialogue: 角色对白或旁白
  - soundEffect: 音效描述
  - cameraMovement: 运镜方式（固定/推/拉/摇/移/跟/升降/环绕）
  - toneHint: 基调风格提示词

## 字段说明

- **scriptContent**: 完整的 Markdown 格式剧本，包含场景标题、动作描述、对白
- **characters**: 剧本中出现的所有角色（2-6个），每个角色的 description 必须是完整的角色文生图提示词，格式如下：
  【基本外貌】年龄约XX岁，性别，身高约XXXcm，体型（苗条/健壮/丰满等）
  【面部特征】发型（具体描述），发色，眼睛颜色，肤色，面部特征（如：圆脸、高鼻梁、薄唇等）
  【服装细节】上装（颜色、款式、材质），下装（颜色、款式、材质），鞋子（颜色、款式），配饰（如有）
  【性格气质】表情（如：温柔、严肃、活泼等），姿态特点，整体气质风格
  这些详细描述是后续AI生图的关键输入，确保角色在不同镜头中保持视觉一致性
- **scenes**: 剧本涉及的所有主要场景（1-5个），每个场景的 description 必须是完整的场景文生图提示词，格式如下：
  【空间布局】场景的整体空间结构，包含主要区域划分、出入口位置、关键陈设位置
  【环境氛围】光线条件（自然光/人造光/混合光）、色调倾向（暖色/冷色/中性）、天气状况（如适用）、空气质感
  【主要元素】场景中的核心物体、家具、装饰，每个元素的位置和外观
  【风格特征】建筑风格、时代背景、文化元素、整体视觉风格
  这些详细描述是后续AI生图的关键输入，确保场景在不同镜头中保持视觉一致性
- **props**: 剧本中出现的关键道具（1-8个），每个道具的 description 必须是完整的道具文生图提示词，格式如下：
  【基本外观】物品类型、整体尺寸（大/中/小）、主要颜色、材质质感
  【细节特征】表面纹理、装饰图案、特殊标记、磨损痕迹（如有）
  【功能提示】使用状态、发光部件、活动部件、技术细节（如适用）
  【风格调性】时代风格、设计风格、品质感、文化属性
  这些详细描述是后续AI生图的关键输入，确保道具在不同镜头中保持视觉一致性
- **shots**: 分镜列表，每个分镜包含：
  - shotNumber: 镜头序号（从1开始递增）
  - duration: 时长（秒），建议2-8秒
  - visualPrompt: **最重要的字段**，详细描述画面内容、构图、光影、色调，用于后续AI生图
  - shotSize: 镜别（特写/近景/中景/全景/远景/大远景）
  - cameraAngle: 拍摄角度（俯视/仰视/平视/鸟瞰/倾斜）
  - dialogue: 该镜头的对白或旁白（可为空字符串）
  - soundEffect: 音效（可为空字符串）
  - cameraMovement: 运镜方式（固定/推/拉/摇/移/跟/升降/环绕）
  - toneHint: 基调风格提示词

## 创作原则

1. 根据文本内容自动拆分为合理的镜头数量（一般5-15个镜头）
2. 每个镜头的 visualPrompt 要足够详细，包含：主体、环境、光线、色彩、构图、氛围
3. 角色描述必须按照提示词格式详细描述，包含：基本外貌（年龄、性别、身高、体型）、面部特征（发型、发色、眼睛、肤色、五官）、服装细节（上装、下装、鞋子、配饰）、性格气质（表情、姿态、风格）
4. 场景描述必须按照提示词格式详细描述，包含：空间布局、环境氛围、主要元素、风格特征
5. 道具描述必须按照提示词格式详细描述，包含：基本外观、细节特征、功能提示、风格调性
6. 镜别和运镜要多样化，避免单调
7. 对白自然，符合角色性格
8. 整体节奏要有起伏，开头吸引人，中间有冲突，结尾有余韵

## 注意事项

- 只输出 JSON，不要输出任何其他文字
- 确保 JSON 格式合法，可以被 JSON 解析器正确解析
- visualPrompt 使用中文描述，因为后续图像生成模型对中文理解更好
- 如果原文信息不足，可以合理发挥创作，保持故事连贯性
- characters/scenes/props 的 imageUrl 统一设为空字符串 ""`

// BuildScriptUserPrompt 构建剧本生成的用户 Prompt
func BuildScriptUserPrompt(textContent string) string {
	return fmt.Sprintf("请根据以下文本内容生成影视分镜脚本：\n\n%s", textContent)
}

// BuildAssetImagePrompt 构建资产图片生成的完整提示词
// assetType: "character"（角色）、"scene"（场景）、"prop"（道具）
// description: 资产的详细描述（可能包含【视图要求】标记）
func BuildAssetImagePrompt(assetType string, description string) string {
	// 清理描述中的视图要求标记（避免重复）
	cleanedDescription := cleanViewMarkers(description)

	// 根据资产类型添加对应的视图指令
	var viewInstruction string
	switch assetType {
	case "character":
		// 角色四视图：正面、45度侧面、90度正侧面、背面
		viewInstruction = "生成角色的四视图，包含正面视图、3/4 半侧面视图、90度正侧面视图、背面视图四个视角，横向排列展示，每个视角清晰展示角色的完整外观特征。"
	case "scene":
		// 场景四视图：正面、左侧45°、右侧45°、背面
		viewInstruction = "生成场景的四视图，包含正面视图、左侧45度视图、右侧45度视图、背面视图四个视角，以四宫格形式展示上下各两张，各宫格之间用1px白边隔离，完整呈现场景的空间布局、环境氛围和细节元素。"
	case "prop":
		// 道具六视图：正面、背面、左侧、右侧、顶部、底部
		viewInstruction = "生成道具的六视图，包含正面视图、背面视图、左侧视图、右侧视图、顶部视图、底部视图六个视角，以六宫格形式展示，各宫格之间用1px白边隔离，详细展示道具各个角度的外观细节和结构特征。"
	default:
		// 普通图片节点，不添加视图指令
		return cleanedDescription
	}

	// 合成最终提示词：视图指令 + 清理后的描述
	return viewInstruction + "\n\n" + cleanedDescription
}

// cleanViewMarkers 清理提示词中的视图要求标记（避免与自动添加的指令重复）
func cleanViewMarkers(s string) string {
	if s == "" {
		return s
	}
	cleaned := viewMarkerRe.ReplaceAllString(s, "")
	return strings.TrimSpace(cleaned)
}
