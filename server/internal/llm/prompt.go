package llm

import (
	"fmt"
	"strings"
)



// ---- 提示词生成相关类型定义 ----

// AssetReference 资产引用（角色、场景、道具）
type AssetReference struct {
	Name        string `json:"name"`        // 资产名称
	Description string `json:"description"` // 资产描述
	ImageURL    string `json:"imageUrl"`    // 资产图片 URL
}

// ShotDataForGeneration 用于生成提示词的完整镜头数据
type ShotDataForGeneration struct {
	Visual        string `json:"visual"`        // 画面描述
	ShotSize            string `json:"shotSize"`            // 镜别
	CameraMovement      string `json:"cameraMovement"`      // 运镜方式（含角度，如"俯视缓慢推镜头"、"仰视快速摇镜头"）
	Dialogue            string `json:"dialogue"`            // 对白
	SoundEffect         string `json:"soundEffect"`         // 音效
	LightingAtmosphere  string `json:"lightingAtmosphere"`  // 光影氛围（如"柔和自然光"、"强烈对比光"、"温暖夕阳光"）
	ToneHint            string `json:"toneHint"`            // 基调提示
}

// ---- 提示词生成相关常量 ----

// PromptGenerationSystemPrompt 提示词生成的系统提示词
const PromptGenerationSystemPrompt = `你是一个专业的影视镜头描述专家。你的任务是根据提供的镜头信息和资产信息，同时生成画面提示词和运动提示词。

要求：
1. **画面提示词**：
   - **景别描述**：以镜头景别开头（如"中景镜头"、"特写镜头"）
   - **场景描述**：描述场景环境，使用括号形式引用场景资产（@场景-场景名称）
   - **人物描述**：描述人物姿态、动作、服装细节、面部特征，使用括号形式引用角色资产（@角色-角色名称）
   - **环境细节**：描述场景中的关键物体、道具（使用@道具-道具名称引用）、光线来源、背景元素
   - **光影描述**：整合光影氛围信息，描述光线效果、亮度分布、阴影形态、人物轮廓光效
   - **构图描述**：描述画面构图特点、人物位置、背景布局
   - **氛围描述**：描述画面传达的情绪氛围（如压抑、温暖、紧张等）
   - **色彩基调**：描述整体色调、饱和度特征
   - **视觉风格**：在末尾用方括号整合基调提示信息，格式：[视觉风格：风格描述。色彩基调：色彩过渡描述。光影特征：光影特点。画质媒介：媒介质感。媒介声明：媒介类型。]
   - 引用格式：资产名称（@类型-资产名称）
   - 例如：南方（@角色-南方）、水下洞穴主通道（@场景-水下洞穴主通道）、古代剑（@道具-古代剑）
   - 画面提示词应该完整、结构化，便于后续生成图像

2. **运动提示词**：
   - 按时间线结构描述：起始状态 → 动作过程 → 结束状态
   - **起始状态**：描述镜头开始时的景别、人物姿态（使用@角色-角色名称引用）、环境状态（使用@场景-场景名称引用）
   - **动作过程**：详细描述镜头运动轨迹、速度、节奏；人物动作变化（使用@角色-角色名称引用）；环境动态元素（使用@场景-场景名称、@道具-道具名称引用）
   - **结束状态**：描述镜头结束时的画面状态、人物最终姿态（使用@角色-角色名称引用）
   - **音效与对白**：整合镜头中的对白内容、音效描述、环境声音
   - **配乐提示**：如果有基调提示，描述合适的配乐风格和入场时机
   - **负面提示**：列出需要避免的视觉问题（如面部特征漂移、纹理闪烁、肢体畸形等）
   - **视觉风格**：整合基调提示中的风格、色彩、光影特征
   - 运动提示词中所有涉及的角色、场景、道具都必须使用资产引用格式：@类型-资产名称
   - 运动提示词应该完整、结构化，便于后续生成视频

输出格式（严格遵守）：
画面提示词：[景别描述。场景描述。人物描述。环境细节。光影描述。构图描述。氛围描述。色彩基调。[视觉风格：...]]
运动提示词：[起始状态：... 动作过程：... 结束状态：... 音效与对白：... 配乐：... 负面提示：... 视觉风格：...]`

// ---- 提示词生成相关函数 ----

// BuildPromptGenerationUserMessage 构建提示词生成的用户消息
func BuildPromptGenerationUserMessage(
	shotData ShotDataForGeneration,
	characters []AssetReference,
	scenes []AssetReference,
	props []AssetReference,
) string {
	return fmt.Sprintf(`镜头信息：
- 画面描述：%s
- 镜别：%s
- 运镜方式（含角度）：%s
- 对白：%s
- 音效：%s
- 光影氛围：%s
- 基调提示：%s

可用资产：
角色：%s
场景：%s
道具：%s

请同时生成画面提示词和运动提示词，画面提示词中使用括号形式引用相关资产。格式示例：南方（@角色-南方）、水下洞穴主通道（@场景-水下洞穴主通道）。`,
		shotData.Visual,
		shotData.ShotSize,
		shotData.CameraMovement,
		shotData.Dialogue,
		shotData.SoundEffect,
		shotData.LightingAtmosphere,
		shotData.ToneHint,
		formatAssetList(characters, "角色"),
		formatAssetList(scenes, "场景"),
		formatAssetList(props, "道具"),
	)
}

// parsePromptResponse 解析 LLM 响应，提取画面提示词和运动提示词
func parsePromptResponse(content string) (string, string) {
	// 查找"画面提示词："和"运动提示词："标记
	storyboardPrompt := ""
	motionPrompt := ""

	// 简单解析：查找关键标记
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "画面提示词：") || strings.HasPrefix(line, "画面提示词:") {
			storyboardPrompt = strings.TrimPrefix(line, "画面提示词：")
			storyboardPrompt = strings.TrimPrefix(storyboardPrompt, "画面提示词:")
			storyboardPrompt = strings.TrimSpace(storyboardPrompt)
		} else if strings.HasPrefix(line, "运动提示词：") || strings.HasPrefix(line, "运动提示词:") {
			motionPrompt = strings.TrimPrefix(line, "运动提示词：")
			motionPrompt = strings.TrimPrefix(motionPrompt, "运动提示词:")
			motionPrompt = strings.TrimSpace(motionPrompt)
		}
	}

	// 如果没有找到标记，尝试简单分割（兼容旧格式）
	if storyboardPrompt == "" && motionPrompt == "" {
		// 按换行分割，第一部分为画面，第二部分为运动
		parts := strings.SplitN(content, "\n", 2)
		if len(parts) >= 1 {
			storyboardPrompt = strings.TrimSpace(parts[0])
		}
		if len(parts) >= 2 {
			motionPrompt = strings.TrimSpace(parts[1])
		}
	}

	return storyboardPrompt, motionPrompt
}

// formatAssetList 格式化资产列表
func formatAssetList(assets []AssetReference, assetType string) string {
	if len(assets) == 0 {
		return fmt.Sprintf("无%s", assetType)
	}

	var result string
	for i, asset := range assets {
		if i > 0 {
			result += "、"
		}
		result += fmt.Sprintf("%s（%s）", asset.Name, asset.Description)
	}
	return result
}

// ---- 故事/剧本生成相关 ----

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
- characters: 角色列表，每个角色有 name（名字）、description（详细的角色文生图提示词）、imageUrl（空字符串，用户后续上传参考图）
- scenes: 场景列表，每个场景有 name（场景名称）、description（详细的场景文生图提示词）、timeOfDay（时段：早晨/上午/中午/下午/傍晚/夜晚/深夜）、location（具体地点）、mood（氛围情绪）、imageUrl（空字符串）
- props: 道具列表，每个道具有 name（名称）、description（详细的道具文生图提示词）、category（分类：服装/武器/交通工具/日常用品/电子设备/其他）、imageUrl（空字符串）
- shots: 分镜列表，每个分镜包含：
  - id: 唯一标识，如 "shot-1"
  - shotNumber: 镜头序号（从1开始递增）
  - duration: 时长（秒），建议2-8秒
  - visual: 画面内容的详细描述，要讲清细节，场景
  - shotSize: 镜别（特写/近景/中景/全景/远景/大远景）
  - cameraMovement: 运镜方式（含拍摄角度，如："俯视缓慢推镜头"、"仰视快速摇镜头"、"平视固定镜头"、"鸟瞰环绕镜头"）
  - dialogue: 角色对白或旁白
  - soundEffect: 音效描述
  - lightingAtmosphere: 光影氛围（如："柔和自然光"、"强烈对比光"、"温暖夕阳光"、"冷色调月光"、"霓虹灯效果"）
  - toneHint: 基调风格提示词

## 字段说明

- **scriptContent**: 完整的 Markdown 格式剧本，包含场景标题、动作描述、对白
- **characters**: 剧本中出现的所有角色（2-6个），每个角色的 description 必须是完整的角色文生图提示词，**末尾必须包含角色四视图要求和宫格布局**：
  【基本外貌】年龄约XX岁，性别，身高约XXXcm，体型（苗条/健壮/丰满等）
  【面部特征】发型（具体描述），发色，眼睛颜色，肤色，面部特征（如：圆脸、高鼻梁、薄唇等）
  【服装细节】上装（颜色、款式、材质），下装（颜色、款式、材质），鞋子（颜色、款式），配饰（如有）
  【性格气质】表情（如：温柔、严肃、活泼等），姿态特点，整体气质风格
  【角色四视图】生成角色的四视图，包含正面视图、3/4 半侧面视图、90度正侧面视图、背面视图四个视角，横向排列展示，每个视角清晰展示角色的完整外观特征。
  这些详细描述是后续AI生图的关键输入，确保角色在不同镜头中保持视觉一致性
- **scenes**: 剧本涉及的所有主要场景（1-5个），每个场景的 description 必须是完整的场景文生图提示词，**末尾必须包含场景四视图要求和宫格布局**：
  【空间布局】场景的整体空间结构，包含主要区域划分、出入口位置、关键陈设位置
  【环境氛围】光线条件（自然光/人造光/混合光）、色调倾向（暖色/冷色/中性）、天气状况（如适用）、空气质感
  【主要元素】场景中的核心物体、家具、装饰，每个元素的位置和外观
  【风格特征】建筑风格、时代背景、文化元素、整体视觉风格
  【场景四视图】生成场景的四视图，包含正面视图、左侧45度视图、右侧45度视图、背面视图四个视角，以2x2四宫格形式展示上下各两张，各宫格之间用1px白边隔离，完整呈现场景的空间布局、环境氛围和细节元素。
  这些详细描述是后续AI生图的关键输入，确保场景在不同镜头中保持视觉一致性
- **props**: 剧本中出现的关键道具（1-8个），每个道具的 description 必须是完整的道具文生图提示词，**末尾必须包含道具六视图要求和宫格布局**：
  【基本外观】物品类型、整体尺寸（大/中/小）、主要颜色、材质质感
  【细节特征】表面纹理、装饰图案、特殊标记、磨损痕迹（如有）
  【功能提示】使用状态、发光部件、活动部件、技术细节（如适用）
  【风格调性】时代风格、设计风格、品质感、文化属性
  【道具六视图】生成道具的六视图，包含正面视图、背面视图、左侧视图、右侧视图、顶部视图、底部视图六个视角，以2x3六宫格形式展示，各宫格之间用1px白边隔离，详细展示道具各个角度的外观细节和结构特征。
  这些详细描述是后续AI生图的关键输入，确保道具在不同镜头中保持视觉一致性
- **shots**: 分镜列表，每个分镜包含：
  - **cameraMovement**: 运镜方式字段需融合拍摄角度和运动方式，格式为"角度+运动方式"，如"俯视缓慢推镜头"、"仰视快速摇镜头"
  - **lightingAtmosphere**: 光影氛围，描述画面的光线特性，如光源类型、光线强度、阴影形态、色调倾向等
  - shotNumber: 镜头序号（从1开始递增）
  - duration: 时长（秒），建议2-8秒
  - visual: **最重要的字段**，详细描述画面内容、构图、光影、色调
  - shotSize: 镜别（特写/近景/中景/全景/远景/大远景）
  - cameraAngle: 拍摄角度（俯视/仰视/平视/鸟瞰/倾斜）
  - dialogue: 该镜头的对白或旁白（可为空字符串）
  - soundEffect: 音效（可为空字符串）
  - cameraMovement: 运镜方式（固定/推/拉/摇/移/跟/升降/环绕）
  - toneHint: 基调风格提示词

## 创作原则

1. 根据文本内容自动拆分为合理的镜头数量（一般5-15个镜头）
2. 每个镜头的 visual 要足够详细，包含：主体、环境、光线、色彩、构图、氛围
3. 角色描述必须按照提示词格式详细描述，包含：基本外貌（年龄、性别、身高、体型）、面部特征（发型、发色、眼睛、肤色、五官）、服装细节（上装、下装、鞋子、配饰）、性格气质（表情、姿态、风格）、角色四视图要求
4. 场景描述必须按照提示词格式详细描述，包含：空间布局、环境氛围、主要元素、风格特征、场景四视图要求
5. 道具描述必须按照提示词格式详细描述，包含：基本外观、细节特征、功能提示、风格调性、道具六视图要求
6. 镜别和运镜要多样化，避免单调
7. 对白自然，符合角色性格
8. 整体节奏要有起伏，开头吸引人，中间有冲突，结尾有余韵

## 注意事项

- 只输出 JSON，不要输出任何其他文字
- 确保 JSON 格式合法，可以被 JSON 解析器正确解析
- visual 使用中文描述，因为后续图像生成模型对中文理解更好
- 如果原文信息不足，可以合理发挥创作，保持故事连贯性
- characters/scenes/props 中的 name 字段中不要有括号`

// BuildScriptUserPrompt 构建剧本生成的用户 Prompt
func BuildScriptUserPrompt(textContent string) string {
	return fmt.Sprintf("请根据以下文本内容生成影视分镜脚本：\n\n%s", textContent)
}

// BuildAssetImagePrompt 构建资产图片生成的完整提示词
// assetType: "character"（角色）、"scene"（场景）、"prop"（道具）
// description: 资产的详细描述（包含视图要求和宫格布局）
// 注意: 视图要求（三视图、四视图、六视图、宫格布局等）由脚本节点生成分镜时自动添加
func BuildAssetImagePrompt(assetType string, description string) string {
	// 直接返回描述，保留脚本节点自动添加的视图要求和宫格布局
	return description
}


