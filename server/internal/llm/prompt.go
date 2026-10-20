package llm

import (
	"fmt"
	"regexp"
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
	Visual             string `json:"visual"`             // 画面描述
	ShotSize           string `json:"shotSize"`           // 镜别
	CameraMovement     string `json:"cameraMovement"`     // 运镜方式（含角度，如"俯视缓慢推镜头"、"仰视快速摇镜头"）
	Dialogue           string `json:"dialogue"`           // 对白
	SoundEffect        string `json:"soundEffect"`        // 音效
	LightingAtmosphere string `json:"lightingAtmosphere"` // 光影氛围（如"柔和自然光"、"强烈对比光"、"温暖夕阳光"）
	ToneHint           string `json:"toneHint"`           // 基调提示
}

// ---- 提示词生成相关常量 ----

// PromptGenerationSystemPrompt 提示词生成的系统提示词
// cameraMovementKeywordBlock 运镜方式关键词约束（中英对照）
// 注入提示词生成与分镜剧本生成的系统提示词：运镜方式必须从此表选取
const cameraMovementKeywordBlock = `运镜方式必须从以下关键词中选取（中英对照，可在其前附加拍摄角度与速度修饰，如"俯视缓慢向前推"）：向前推（Push-in）、向后拉（Pull-out）、左右摇（Pan left / Pan right）、上下摇（Tilt up / Tilt down）、轨道跟移（Tracking shot）、环绕（Arc / Orbit shot）、摇臂升降（Crane shot）、云台稳定跟拍（Gimbal shot）、手持纪实（Hand-held）、希区柯克变焦（Hitchcock zoom）`

// cameraPositionKeywordBlock 机位方位关键词约束（中英对照）
// 注入提示词生成与分镜剧本生成的系统提示词：机位方位必须从此表选取
const cameraPositionKeywordBlock = `机位方位必须从以下关键词中选取（中英对照）：正面机位（Front shot）、斜侧机位（Three-quarter shot，45°侧面）、侧面机位（Profile shot）、背面机位（Back shot）、过肩机位（Over-the-shoulder）、主观机位（POV）`

// filmLookBlock 胶片电影质感约束
// 注入画面/运动提示词的视觉风格要求与分镜剧本的创作原则：全片统一胶片电影感
const filmLookBlock = `胶片电影质感：35mm胶片摄影质感，细腻胶片颗粒（film grain），高光处自然光晕（halation），柔和低反差影调，暗部保留细节不死黑，电影调色（低饱和、青橙色调或胶片灰、胶片曲线），避免数码过锐与塑料感过度平滑`

// asset3DBlock 资产 3D 立体风格约束
// 注入角色/场景/道具文生图模板：资产必须是 3D 立体质感，避免纸片式平面感
const asset3DBlock = `【3D立体风格】3D立体渲染质感，造型有体积感与纵深，材质表现真实（皮肤/布料/金属/石材等质感分明），光影塑造立体感，避免平面化、纸片式、2D插画风格`

// ---- 视图要求块的公共片段 ----
//
// 这三段与前端 web/src/utils/imageViewPrompts.ts 的 STYLE_LOCK / VIEW_REBUILD /
// SHEET_RULES 逐字对齐：画布"生成视图"和脚本流程"生成资产设定图"必须得到同类产物，
// 两边文案一旦分叉，同一套资产会出现两种画风。
//
// 为什么必须加"风格锁定"：原来的正向描述里"白底 + 背景纯白无缝 + 均匀柔和平光 +
// 不要投影阴影 + 正投影 + 模型设定图 + 画清轮廓"叠在一起，图像模型会直接输出白底线描稿
// —— 实测第一个视图经常整格变成白色线条图。这组词里任何一条单独出现都还算合理
// （正投影是正交视图唯一说得清的表述，必须保留），但叠加起来就等于在描述一张线稿：
// 没有背景色、没有明暗过渡、没有阴影、没有材质，模型只能画出轮廓线。
// 所以处理方式是：删掉白底/平光/无阴影/画清轮廓这类诱导措辞，同时**显式要求彩色立体渲染**，
// 把"要什么"写清楚，而不是只靠否定句。

// styleLockBlock 视图风格锁定（前端 STYLE_LOCK）
const styleLockBlock = `【彩色立体渲染】必须是成品级的彩色立体画面：明确的体积感与明暗过渡、材质高光与布料褶皱清晰（皮肤/布料/金属/木材质感分明）；不要线稿、不要描边、不要黑白单色、不要白模、不要工程制图或平面图标风格。`

// viewRebuildBlock 多视图共同前提：参考图只提供"主体长什么样"，视角与构图必须按文字重建（前端 VIEW_REBUILD）
const viewRebuildBlock = `每一格都必须严格按上面写明的相机角度单独绘制、各格视角明显不同；严禁沿用参考图的相机角度与构图 —— 参考图只用来提供主体的外观、配色、材质与画风。`

// viewSheetRulesBlock 宫格排布的公共要求（前端 SHEET_RULES）。
// 切分是纯几何等分（trimPx 默认 0），不需要白线做依据；原来要求"各宫格之间用 1px 白边隔离"
// 等于让模型画白色分割线，本身就是白线稿观感的一部分，改成"极窄的浅灰间隙"。
const viewSheetRulesBlock = `各宫格等比等分、每格内容居中且不越界，格与格之间只留极窄的浅灰间隙（不要画白色分割线、不要画外框、不要网格线、不要编号），格内不要出现任何文字、箭头、尺寸标注或水印。`

// 注意：上面三段常量在下文视图要求块里必须**内联拼在同一行**（` + styleLockBlock + ` 这种写法），
// 不能各自独立成行。原因是 stripViewRequirementBlocks 以"行"为单位跳过视图要求块，
// 遇到以【开头的新行就认为块已结束（见下面的 viewRequirementHead / stripViewRequirementBlocks）：
// styleLockBlock 以【彩色立体渲染】开头，一旦换行就会被当成新小节从而漏进帧提示词里。

const promptGenSystemPromptHead = `你是一个专业的影视镜头描述专家。你的任务是根据提供的镜头信息和资产信息，同时生成画面提示词和运动提示词。

要求：
1. **画面提示词**：
   - **景别与机位**：以景别+机位方位+俯仰角度开头（如"中景，斜侧机位，平视"、"特写，正面机位，微俯"）。` + cameraPositionKeywordBlock + `
   - **场景描述**：描述场景环境，使用括号形式引用场景资产（@场景-场景名称）
   - **人物描述**：描述人物姿态、动作、服装细节、面部特征，使用括号形式引用角色资产（@角色-角色名称）
   - **环境细节**：描述场景中的关键物体、道具（使用@道具-道具名称引用）、光线来源、背景元素
   - **光影描述**：整合光影氛围信息，描述光线效果、亮度分布、阴影形态、人物轮廓光效
   - **镜头光学**：描述镜头光学特性——焦距质感（35mm/50mm/85mm定焦镜头感）、景深控制（特写用浅景深柔化背景、全景用深景深保留环境细节）、焦外虚化光斑、镜头光晕（lens flare）
   - **构图描述**：运用专业构图法则（三分法、对称构图、引导线、负空间留白），描述前景-中景-背景层次、人物位置、背景布局
   - **氛围描述**：描述画面传达的情绪氛围（如压抑、温暖、紧张等）
   - **色彩基调**：电影调色风格，描述整体色调与饱和度特征（低饱和胶片灰、青橙色调等电影感调色），胶片曲线影调
   - **视觉风格**：在末尾用方括号整合基调提示信息，格式：[视觉风格：风格描述。色彩基调：色彩过渡描述。光影特征：光影特点。画质媒介：媒介质感。媒介声明：媒介类型。]
   - **胶片质感**：` + filmLookBlock + `
   - 引用格式：资产名称（@类型-资产名称）
   - 例如：南方（@角色-南方）、水下洞穴主通道（@场景-水下洞穴主通道）、古代剑（@道具-古代剑）
   - **引用格式铁律**：所有资产引用必须写成「（@类型-资产名称）」完整括号形式（全角括号），禁止省略括号或只写 @类型-名称，否则资产无法被识别
   - 画面提示词应该完整、结构化，便于后续生成图像

2. **运动提示词**：
   - 按时间线结构详细描述：起始状态 → 中间过程（多个阶段） → 结束状态
   - **起始状态**：描述镜头开始时的景别与机位（机位方位+俯仰角度）、人物初始姿态与表情（使用@角色-角色名称引用）、环境初始状态（使用@场景-场景名称引用）、光线初始效果
   - **中间过程**（核心部分，必须拆分为2-4个连续阶段详细描述）：
     - 每个阶段必须包含：该阶段的时间节点（如"第1-2秒"、"随后"、"紧接着"）、人物具体动作与姿态变化（使用@角色-角色名称引用）、表情与情绪变化、肢体运动轨迹与速度、与环境中道具的交互（使用@道具-道具名称引用）、镜头运动方式与轨迹变化、光影与氛围的渐变效果
     - 必须描述动作的起承转合，例如：从静止到启动的过渡 → 动作的高潮或转折 → 动作的延续与变化
     - 描述人物与环境的互动细节：脚步移动、手部动作、头发/衣物飘动、风吹效果、光影在人物面部的流转
     - 描述镜头跟随人物运动的方式：焦点转移、景深的变化
   - **运镜方式约束**：` + cameraMovementKeywordBlock + `
   - **结束状态**：描述镜头结束时的画面状态、人物最终姿态与表情（使用@角色-角色名称引用）、环境最终状态、画面定格感
   - **音效与对白**：整合镜头中的对白内容、音效描述、环境声音，按时间线排列
   - **配乐提示**：如果有基调提示，描述合适的配乐风格和入场时机
   - **负面提示**：列出需要避免的视觉问题（如面部特征漂移、纹理闪烁、肢体畸形、动作突变等）
   - **视觉风格**：整合基调提示中的风格、色彩、光影特征，并保持胶片电影质感（胶片颗粒、光晕、柔和低反差影调、电影调色）
   - 运动提示词中所有涉及的角色、场景、道具都必须使用资产引用格式：@类型-资产名称
   - 运动提示词应该完整、结构化，便于后续生成视频

输出格式（严格遵守）：
画面提示词：[景别与机位。场景描述。人物描述。环境细节。光影描述。镜头光学。构图描述。氛围描述。色彩基调。[视觉风格：...]]
运动提示词：[起始状态：... 中间过程-阶段1（第X-X秒）：... 中间过程-阶段2（第X-X秒）：... 中间过程-阶段3（第X-X秒）：... 结束状态：... 音效与对白：... 配乐：... 负面提示：... 视觉风格：...]`

// promptGenStoryboardSpec 单份画面提示词的字段要求（多份时每一份都要满足）
const promptGenStoryboardSpec = "景别与机位。场景描述。人物描述。环境细节。光影描述。镜头光学。构图描述。氛围描述。色彩基调。[视觉风格：...]"

// promptGenMotionSpec 运动提示词的字段要求
const promptGenMotionSpec = "起始状态：... 中间过程-阶段1（第X-X秒）：... 中间过程-阶段2（第X-X秒）：... 中间过程-阶段3（第X-X秒）：... 结束状态：... 音效与对白：... 配乐：... 负面提示：... 视觉风格：..."

// motionSpecForFrames 运动提示词的字段要求。
// 2 张（首尾帧）时额外要求起始/结束状态分别与两份画面提示词对齐 ——
// 否则视频的首帧/尾帧和用户提供的两张参考图对不上，首尾帧模式就白用了。
// imageCount<=1 时与改造前逐字一致。
func motionSpecForFrames(imageCount int) string {
	if imageCount <= 1 {
		return promptGenMotionSpec
	}
	return "起始状态（必须与画面提示词1「起始画面」完全一致，同一瞬间）：... " +
		"中间过程-阶段1（第X-X秒）：... 中间过程-阶段2（第X-X秒）：... 中间过程-阶段3（第X-X秒）：... " +
		"结束状态（必须与最后一份画面提示词「结束画面」完全一致，同一瞬间）：... " +
		"音效与对白：... 配乐：... 负面提示：... 视觉风格：..."
}

// buildMultiFrameOutputFormat 多张参考图时的输出格式：N 份画面提示词，分别对应同一镜头的不同瞬间。
// 首份=起始画面，末份=结束画面（正好对应首尾帧），中间份为过程瞬间。
func buildMultiFrameOutputFormat(imageCount int) string {
	var b strings.Builder
	fmt.Fprintf(&b, "输出格式（严格遵守，本次需要 %d 份画面提示词，分别对应同一镜头的不同瞬间）：\n", imageCount)
	for i := 1; i <= imageCount; i++ {
		label := fmt.Sprintf("（第 %d 个瞬间）", i)
		if i == 1 {
			label = "（起始画面）"
		} else if i == imageCount {
			label = "（结束画面）"
		}
		fmt.Fprintf(&b, "画面提示词%d%s：[%s]\n", i, label, promptGenStoryboardSpec)
		if i > 1 {
			fmt.Fprintf(&b, "（第 %d 份必须是同一镜头运动到该瞬间的画面：人物姿态、位置、朝向、表情与上一份明显不同，环境与光影随之变化；但角色外观、服装、场景、道具与整体视觉风格必须与第 1 份保持一致）\n", i)
		}
	}
	fmt.Fprintf(&b, "运动提示词：[%s]", motionSpecForFrames(imageCount))
	return b.String()
}

// BuildPromptGenerationSystemPrompt 按需要的画面提示词份数构建系统提示词。
// imageCount<=1 时与改造前逐字一致，保证单张提示词的既有行为不变。
func BuildPromptGenerationSystemPrompt(imageCount int) string {
	if imageCount <= 1 {
		return promptGenSystemPromptHead + "\n\n" + `输出格式（严格遵守）：
画面提示词：[` + promptGenStoryboardSpec + `]
运动提示词：[` + promptGenMotionSpec + `]`
	}
	return promptGenSystemPromptHead + "\n\n" + buildMultiFrameOutputFormat(imageCount)
}

// ---- 提示词生成相关函数 ----

// BuildPromptGenerationUserMessage 构建提示词生成的用户消息
func BuildPromptGenerationUserMessage(
	shotData ShotDataForGeneration,
	characters []AssetReference,
	scenes []AssetReference,
	props []AssetReference,
	imageCount int,
) string {
	// 需要多张参考图时，明确要求几份画面提示词、分别表达哪一瞬间
	frameAsk := "请同时生成画面提示词和运动提示词，画面提示词中使用括号形式引用相关资产。"
	if imageCount > 1 {
		frameAsk = fmt.Sprintf("请按输出格式生成 %d 份画面提示词（第 1 份=镜头起始画面，第 %d 份=镜头结束画面，同一镜头的不同瞬间，人物姿态/位置/表情与环境光影要逐份推进变化），以及 1 份运动提示词；运动提示词的起始状态必须写第 1 份画面（起始画面）的状态、结束状态必须写第 %d 份画面（结束画面）的状态，让视频首尾帧正好接上这两张参考图；画面提示词中使用括号形式引用相关资产。", imageCount, imageCount, imageCount)
	}
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

%s格式示例：南方（@角色-南方）、水下洞穴主通道（@场景-水下洞穴主通道）。`,
		frameAsk,
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

// extractNumberedStoryboardSection 提取「画面提示词N（小标题）：」的内容段：
// 先按标记取段，再去掉紧跟在标记后的小标题（如「（起始画面）」）
func extractNumberedStoryboardSection(content, marker string, endMarkers []string) string {
	section := extractSection(content, marker, endMarkers)
	// 去掉紧跟的小标题括号（全角/半角）
	for _, open := range []string{"（", "("} {
		if strings.HasPrefix(section, open) {
			closeCh := "）"
			if open == "(" {
				closeCh = ")"
			}
			if i := strings.Index(section, closeCh); i >= 0 {
				section = section[i+len(closeCh):]
			}
			break
		}
	}
	// 小标题后面往往还跟着冒号（「（起始画面）：中景…」），统一去掉；
	// 末尾可能残留下一节标记带的 markdown 星号（「…蹲着\n**画面提示词2…」），也一并去掉
	return strings.TrimSpace(strings.Trim(strings.TrimLeft(section, "：:** \t\r\n"), "*：: \t\r\n"))
}

// parsePromptResponse 解析 LLM 响应，提取画面提示词（imageCount 份）和运动提示词。
// imageCount<=1 时走原有单份逻辑，行为不变。
func parsePromptResponse(content string, imageCount int) ([]string, string) {
	if imageCount <= 1 {
		// 单份走原有逻辑（含标记都找不到时的兜底分割），保证既有行为完全不变
		storyboardPrompt, motionPrompt := parseSinglePromptResponse(content)
		return []string{storyboardPrompt}, motionPrompt
	}

	storyboardPrompts := make([]string, 0, imageCount)
	for i := 1; i <= imageCount; i++ {
		endMarkers := []string{"运动提示词"}
		if i < imageCount {
			endMarkers = []string{fmt.Sprintf("画面提示词%d", i+1), "运动提示词"}
		}
		storyboardPrompts = append(storyboardPrompts, extractNumberedStoryboardSection(content, fmt.Sprintf("画面提示词%d", i), endMarkers))
	}
	motionPrompt := extractSection(content, "运动提示词", nil)
	return storyboardPrompts, motionPrompt
}

// parseSinglePromptResponse 单份提示词解析（原逻辑，含兜底分割）
func parseSinglePromptResponse(content string) (string, string) {
	storyboardPrompt := extractSection(content, "画面提示词", []string{"运动提示词"})
	motionPrompt := extractSection(content, "运动提示词", nil)

	// 如果两个标记都没找到，尝试简单分割（兼容旧格式）
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

// extractSection 提取标记后的内容段，截止到下一个标记。
// 兼容各种输出变体：标记单独成行（内容在后续行）、markdown 加粗（**画面提示词：**）、半角/全角冒号
func extractSection(content, marker string, endMarkers []string) string {
	idx := strings.Index(content, marker)
	if idx < 0 {
		return ""
	}
	rest := content[idx+len(marker):]
	// 去掉标记后的冒号/星号/空白/换行（标记单独成行时内容从下一行开始）
	rest = strings.TrimLeft(rest, "：:** \t\r\n")
	// 截止到下一个标记出现的位置
	end := len(rest)
	for _, em := range endMarkers {
		if i := strings.Index(rest, em); i >= 0 && i < end {
			end = i
		}
	}
	return strings.TrimSpace(rest[:end])
}

// 视图要求块的开头标记。脚本节点给资产描述追加的要求（【角色四视图】/【场景四视图】/
// 【道具六视图】，以及历史版本用过的【三视图要求】等）只对"用资产描述去生成资产设定图"有意义。
var viewRequirementHead = regexp.MustCompile(`^【(?:角色三视图|角色四视图|场景四视图|道具六视图|三视图要求|四视图要求|六视图要求)】`)

// stripViewRequirementBlocks 去掉资产描述里的"视图要求"块（从【…视图】那一行起，
// 到下一个【…】小节或结尾为止）。
//
// 为什么必须去掉：生成分镜帧提示词时会把资产描述整段塞给 LLM（见 formatAssetList），
// 里面若带着"生成四视图…2×2 四宫格…各宫格等比等分、格与格之间只留极窄的浅灰间隙"
// （以及内联的 styleLockBlock / viewRebuildBlock 等），模型会把这套宫格要求与视图风格
// 抄进**单帧**画面提示词里，出图就变成设定图宫格（或按多视图风格画成一格线稿）而不是一个镜头。
// 外观、空间、材质这些描述必须保留，它才是帧提示词要用的信息。
//
// 边界规则（改文案时必须一起守住）：视图要求块以「【…视图】开头的行」起、以「下一行以【开头」
// 或结尾止。所以视图块内部除首行外不允许出现以【开头的新行，视图块后面的公共片段
// （styleLockBlock 以【彩色立体渲染】开头）只能内联拼接在同一行里 —— 见上面常量区的说明。
func stripViewRequirementBlocks(description string) string {
	lines := strings.Split(description, "\n")
	out := make([]string, 0, len(lines))
	skipping := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if viewRequirementHead.MatchString(trimmed) {
			skipping = true
			continue
		}
		// 遇到下一个【…】小节就结束跳过（视图要求块本身可能是多行）
		if skipping && strings.HasPrefix(trimmed, "【") {
			skipping = false
		}
		if skipping {
			continue
		}
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
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
		// 视图要求块不进帧提示词（否则宫格要求会被抄进单帧画面）
		result += fmt.Sprintf("%s（%s）", asset.Name, stripViewRequirementBlocks(asset.Description))
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
  - duration: 时长（秒），建议5-15秒（与下游视频生成模型的单镜头时长限制对齐）
  - visual: 画面内容的详细描述，要讲清细节，场景
  - shotSize: 镜别（特写/近景/中景/全景/远景/大远景）
  - cameraMovement: 运镜方式（机位方位+俯仰角度+运镜关键词组合，如："过肩机位俯视缓慢向前推"、"正面机位平视环绕"、"斜侧机位平视轨道跟移"）
  - dialogue: 角色对白或旁白
  - soundEffect: 音效描述
  - lightingAtmosphere: 光影氛围（使用专业布光语言，如："低键光"、"伦勃朗光"、"轮廓光/逆光"、"实用光源（台灯/霓虹/烛光）"、"黄金时刻"、"蓝调时刻"、"柔和自然光"）
  - toneHint: 基调风格提示词

## 字段说明

- **scriptContent**: 完整的 Markdown 格式剧本，包含场景标题、动作描述、对白
- **characters**: 剧本中出现的所有角色（2-6个），每个角色的 description 必须是完整的角色文生图提示词，**末尾必须包含角色四视图要求和宫格布局**：
  【基本外貌】年龄约XX岁，性别，身高约XXXcm，体型（苗条/健壮/丰满等）
  【面部特征】发型（具体描述），发色，眼睛颜色，肤色，面部特征（如：圆脸、高鼻梁、薄唇等）
  【服装细节】上装（颜色、款式、材质），下装（颜色、款式、材质），鞋子（颜色、款式），配饰（如有）
  【性格气质】表情（如：温柔、严肃、活泼等），姿态特点，整体气质风格
  【角色四视图】生成这个角色的四视图（同一个人物、同一套服装、同一套光照，画面本身就是彩色的立体成品图，不是线稿、不是设定线画、不是白模），从左到右依次为：①正脸脸部特写（占据较大区域，约1/3）：正脸端正平视镜头、正投影（不要透视畸变），完整展示头顶、发型、五官、妆容、耳部、肩颈、锁骨与上胸服装；②正面全身：镜头平视、正投影（不要透视畸变），人物完全正对镜头，表情中性、站姿端正，双臂自然下垂但略向外张15~30度（手臂不要紧贴躯干、不要遮住身体侧面的剪裁结构），双脚自然分开站立；③标准侧面全身：头部与身体完全90度侧身（不要3/4视角），清晰展示鼻梁、下巴、后脑、发长以及服装侧面的剪裁与层次；④背面全身：严格180度背面，清晰展示后脑发型、服装背面结构与鞋跟。右侧三个全身视图是同一个人：身高与头身比一致、脚底踩在同一条水平线上、三格画面比例相同，头顶到鞋底完整入画、不要裁切；脸部一比一还原左侧特写，服装完全一致，不要换脸、不要换装、不要改变年龄感与画风。背景为中性浅灰的无缝影棚背景（不要死白、不要大面积纯白留白），柔和主光加辅助光、明暗过渡清晰；不要投影在地上的硬阴影，但体积感与材质高光必须保留。` + styleLockBlock + viewRebuildBlock + viewSheetRulesBlock + asset3DBlock + `
  这些详细描述是后续AI生图的关键输入，确保角色在不同镜头中保持视觉一致性
- **scenes**: 剧本涉及的所有主要场景（1-5个），每个场景的 description 必须是完整的场景文生图提示词，**末尾必须包含场景四视图要求和宫格布局**：
  【空间布局】场景的整体空间结构，主要区域划分、出入口位置、关键陈设位置、空间纵深关系（前景-中景-背景层次）
  【环境氛围】光线条件（自然光/人造光/混合光，明确光源方向与色温）、色调倾向（暖色/冷色/中性）、时段与天气（如适用）、空气质感（雾气/尘埃/通透度）
  【主要元素】场景中的核心物体、家具、装饰，每个元素的位置、外观与材质，元素之间的比例关系
  【风格特征】建筑风格、时代背景、文化元素、整体视觉风格、电影场景质感
  【尺度参照】通过人物或常见参照物体现空间的真实尺度，避免空间大小失真
  【场景四视图】生成该场景的四视图设定图（同一场景、同一时刻、同一光照），以2×2四宫格展示，四格各一种制图视角：①左上为俯视平面图（镜头垂直向下正俯视，正投影、不要透视变形，画清墙体的位置与厚度、门窗位置、主要家具以及地面材质的平面关系与相互距离）；②右上为正面立面图（镜头正对主墙，正投影、无透视畸变，地平线水平，这一面的墙、门窗、家具与陈设完整呈现且互不遮挡）；③左下为侧面立面图（相机正对侧墙、镜头轴线水平（平视，相机高度约1.5米）、与正立面方向成90度，正投影、无透视畸变，与正立面保持同一地平线与同一层高）；④右下为斜四分之三透视图（相机高度约1.6米（人眼高度）、镜头轴线水平，机位在房间一角、与两面墙各约45度斜向看，表现空间纵深、体量与光影层次）。四格必须是同一个场景：光源方向、时段与天气一致，墙面与地面的材质、颜色一致，陈设的数量、位置与相对比例各视图一一对应；用门高、层高、常见家具作为统一尺度参照，不要把同一面墙重复画成不同视图。画面中不要出现人物。` + viewSheetRulesBlock + styleLockBlock + viewRebuildBlock + asset3DBlock + `
  这些详细描述是后续AI生图的关键输入，确保场景在不同镜头中保持视觉一致性
- **props**: 剧本中出现的关键道具（1-8个），每个道具的 description 必须是完整的道具文生图提示词，**末尾必须包含道具六视图要求和宫格布局**：
  【基本外观】物品类型、整体尺寸（大/中/小，用常见参照物说明实际尺寸）、主要颜色、材质质感（金属度/粗糙度/反光特性等物理属性）
  【细节特征】表面纹理、装饰图案、特殊标记、磨损痕迹（如有）、做工精细度
  【功能提示】使用状态、发光部件、活动部件、技术细节（如适用）
  【风格调性】时代风格、设计风格、品质感、文化属性
  【道具六视图】生成该道具的六视图设定图，以2×3六宫格展示，六个视角均为正交投影（正投影，不要透视畸变、不要3/4视角），逐格内容为：①左上·正视图：相机位于物品正前方、镜头轴线水平正对正面；②中上·背视图：相机绕到物品正后方、镜头轴线水平正对背面；③右上·左视图：相机位于物品左侧、镜头轴线水平（正90度侧视）；④左下·右视图：相机位于物品右侧、镜头轴线水平（正90度侧视）；⑤中下·俯视图：相机位于物品正上方、镜头轴线垂直向下（正90度俯视，同时看到顶面与四周侧壁）；⑥右下·仰视图：相机位于物品正下方、镜头轴线垂直向上（正90度仰视，同时看到底面与四周侧壁）。六格是同一件物品，并严格遵守正交投影的对齐关系：正视图与背视图等高等宽、左视图与右视图等高等宽、俯视图与仰视图等大，且长对正、高平齐、宽相等；整体比例、颜色、材质、纹样、磨损痕迹一比一一致，各视图都居中、四周留白一致。背景为中性浅灰的无缝摄影棚背景（不要死白），柔和主光加辅助光、明暗过渡清晰；不要投影在地上的硬阴影，但体积感与材质高光必须保留；画面中不要出现手、人物或其他参照物。` + styleLockBlock + viewRebuildBlock + viewSheetRulesBlock + asset3DBlock + `
  这些详细描述是后续AI生图的关键输入，确保道具在不同镜头中保持视觉一致性
- **shots**: 分镜列表，每个分镜包含：
  - **cameraMovement**: 运镜方式字段需融合机位方位、俯仰角度和运动方式，格式为"机位方位+俯仰角度+运镜关键词"，如"过肩机位俯视缓慢向前推"、"斜侧机位平视轨道跟移"。` + cameraMovementKeywordBlock + `。` + cameraPositionKeywordBlock + `
  - **lightingAtmosphere**: 光影氛围，描述画面的光线特性，如光源类型、光线强度、阴影形态、色调倾向等
  - shotNumber: 镜头序号（从1开始递增）
  - duration: 时长（秒），建议5-15秒
  - visual: **最重要的字段**，详细描述画面内容、构图、光影、色调
  - shotSize: 镜别（特写/近景/中景/全景/远景/大远景）
  - dialogue: 该镜头的对白或旁白（可为空字符串）
  - soundEffect: 音效（可为空字符串）
  - cameraMovement: 运镜方式（机位方位+俯仰角度+运镜关键词组合）
  - toneHint: 基调风格提示词

## 创作原则

1. 根据文本内容自动拆分为合理的镜头数量（一般5-15个镜头）
2. 每个镜头的 visual 要足够详细，包含：主体、环境、光线、色彩、构图、氛围、镜头光学（焦距感、景深控制）
3. 角色描述必须按照提示词格式详细描述，包含：基本外貌（年龄、性别、身高、体型）、面部特征（发型、发色、眼睛、肤色、五官）、服装细节（上装、下装、鞋子、配饰）、性格气质（表情、姿态、风格）、角色四视图要求
4. 场景描述必须按照提示词格式详细描述，包含：空间布局、环境氛围、主要元素、风格特征、场景四视图要求
5. 道具描述必须按照提示词格式详细描述，包含：基本外观、细节特征、功能提示、风格调性、道具六视图要求
6. 镜别和运镜要多样化，避免单调
7. 对白自然，符合角色性格
8. 整体节奏要有起伏，开头吸引人，中间有冲突，结尾有余韵
9. 分镜连贯性：遵守180°轴线原则（机位不要无故越轴），对话戏采用正反打结构，景别按叙事递进（如全景交代环境→中景推进关系→特写放大情绪），运镜服务叙事而非炫技
10. 全片统一胶片电影质感基调，` + filmLookBlock + `，toneHint 应体现这一基调

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
