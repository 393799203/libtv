package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"unicode/utf8"
)

/**
 * 点选识别（视觉）：用户在图上的某一点点一下 → 说出"那是什么" + 它的外接框。
 *
 * 为什么要做这一步（产品原因，来自线上反馈）：
 * 上游图像接口没有蒙版入参，用户在框选处写"把这个去掉"，模型看到的只是像素，
 * 根本不知道"这个"指什么 —— 于是要么把东西原样保留（只是重画一遍），要么整块重画。
 * 先识别出「自动售货机」这样的名字，再把它当成目标写进改图指令，"这个"才有指代；
 * 识别出的外接框还能把点选的小圆圈换成物体的真实范围，用户一框就是那个东西。
 *
 * 模型选型是实测出来的（2026-10-17 用线上 4K 场景四视图实测，同一张图同一点）：
 *   电信 glm-5.3-flash        → {"label":"自动售货机","box":{x:0.17,y:0.74,w:0.06,h:0.15}}  16s
 *   电信 deepseek-v4.1-flash  → 必须给足 max_tokens：它默认先思考 400~3400 token，
 *     预算不够（例如 2500）会把预算全花在思考上、content 为空 —— 不是模型不可用，
 *     是预算不足（我一开始就是这么误判的）。补足预算 + 关思考后实测 2s 出结果。
 *   华数 doubao-seed-2.1-turbo（thinking 关闭）→ 同一结论 4.7s，reasoning_tokens=0
 */

// RecognizedCandidate 一个层级的候选：名字 + 该层级的紧致外接框。
//
// 为什么要有层级：用户点"鼻子"时，他可能想改的是鼻子，也可能是整张脸 ——
// 只给一个框就是替用户做决定。实测同一个提示词下模型能稳定给出 2~3 层
// （人像：眼睛 → 人脸 → 人物；青蛙：右眼 → 青蛙），所以一次问回全部层级，
// 由前端列出来让用户选。
type RecognizedCandidate struct {
	Label string `json:"label"`
	Box   Box2D  `json:"box"`
}

// RecognizedObject 识别结果：名字 + 归一化外接框（都可能是"没识别出"）
type RecognizedObject struct {
	Label string `json:"label"`
	Box   *Box2D `json:"box"`
	// Candidates 由具体到宽泛的候选层级；Candidates[0] 与 Label/Box 同义（最具体那个）。
	// 解析不出层级时为空数组，前端退回"只有一层"的老表现。
	Candidates []RecognizedCandidate `json:"candidates,omitempty"`
	Model      string                `json:"model"`
	Raw        string                `json:"raw,omitempty"`
	// Tokens 本次识别的 token 用量（用于成本核算：用户问"识别花了多少"，看日志这一行即可）
	PromptTokens     int `json:"promptTokens,omitempty"`
	CompletionTokens int `json:"completionTokens,omitempty"`
}

// Box2D 归一化外接框（0~1，相对整张图）
type Box2D struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	W float64 `json:"w"`
	H float64 `json:"h"`
}

// recognizeSystemPrompt 只输出 JSON，不给解释（识别结果要直接进程序）
const recognizeSystemPrompt = "你是图像标注助手。你只输出一个 JSON 对象，不输出任何解释、前后缀或 Markdown。"

// recognizeMinBoxSide 识别框太小（小于整图 1.5%）视为"没框到东西"：点选误触、模型瞎给都会落在这里
const recognizeMinBoxSide = 0.015

// recognizeMaxBoxArea 识别框太大（超过整图一半）视为"整张图"，不是某个物体
const recognizeMaxBoxArea = 0.5

// recognizeMaxBoxAreaLoose 宽泛层级（"人脸""人物"）的面积上限。
//
// 允许它盖住大半张图（这是层级的本意），但要挡住"整张图"那一档：线上实测点鼻子时
// 模型会给出 人/人物 = 满幅框（面积 1.0）。选它等于"改整张图"，而元素编辑的设计前提是
// "只改一块"——真让用户选中它，蒙版就变成整张图、裁剪也失效，等于把整图重画一遍。
// 注意这个上限比的是**外扩前**的模型原始框（cleanBox 里的检查在 padding 之前）。
const recognizeMaxBoxAreaLoose = 0.85

// recognizeMaxCandidates 最多返回几层：实测模型给 2~3 层，多了对用户是噪音
const recognizeMaxCandidates = 4

// recognizePadRatio 识别框外扩比例：模型给的是紧致框，贴边太死会把物体切掉一圈，
// 稍微放宽一点给改图留出边缘（实测模型框比用户手框小 1~2 个百分点）
const recognizePadRatio = 0.06

// ContainsPoint 判断框是否罩住了这个点（判定容差 tol，归一化）。
//
// 为什么要这个判断：deepseek 关思考时速度快一个量级（2~3s），但实测会把**别处**的物体
// 名字安到用户点的地方 —— 点 (0.35,0.30) 它回了"自动售货机"、框却在 {0.175,0.135,0.065,0.135}
// （右侧差 0.11、下方差 0.03，都不在容差内）。框没罩住点击处，就说明这次认的不是用户指的东西，
// 调用方据此"带思考再问一遍"。
//
// 容差 0.02（长边的 2%，4K 图上约 77px）：用户点在物体边缘、模型框略紧都不该误判。
func (b Box2D) ContainsPoint(x, y, tol float64) bool {
	return x >= b.X-tol && x <= b.X+b.W+tol && y >= b.Y-tol && y <= b.Y+b.H+tol
}

// FoundObject 这次识别是否给出了东西（"无"= 模型明确回答这里没物体，属合法答案）
func (o *RecognizedObject) FoundObject() bool {
	return o != nil && o.Box != nil && o.Label != ""
}

// RecognizeRequest 点选识别的入参。
//
// 用结构体而不是七个位置参数：调用方要传的东西（模型 / 预算 / 关思考）还会长，
// 位置参数一多，调用点就读不出哪个是哪个（之前 disableThinking 就靠 bool 位置传）。
type RecognizeRequest struct {
	Model        string
	ImageDataURI string
	X, Y, Radius float64
	// DisableThinking 关掉思考：实测从 5~28s 降到 2s，且框更紧（思考越多它越爱"再想想"）。
	// 参数被上游拒绝时会自动摘掉重试（见 isThinkingRejected）。
	DisableThinking bool
	// MaxTokens 模型输出预算；0 = 用 recognizeDefaultMaxTokens
	MaxTokens int
}

// recognizeDefaultMaxTokens 未指定预算时的兜底（与 models.yaml 的默认额度一致）
const recognizeDefaultMaxTokens = 8192

// isThinkingRejected 判断错误是不是"上游不认 thinking 参数"。
// 各渠道网关对未知参数的处理不同：有的直接 400 + InvalidParameter，有的静默忽略。
func isThinkingRejected(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	for _, kw := range []string{"invalidparameter", "invalid parameter", "unknown parameter", "unsupported parameter", "unrecognized"} {
		if strings.Contains(msg, kw) {
			return true
		}
	}
	return false
}

// RecognizeObjectAt 在 (x,y)（归一化 0~1）处识别物体。
// imageDataURI 建议传缩过的图（长边 ≤1024 的 base64 data URI）：
// 实测 4K 原图直传上游 prompt_tokens=8135、识别 59s；缩到 1024 后 905 tokens、16s，识别精度不变
// （外接框是归一化坐标，与图片分辨率无关）。
func (c *Client) RecognizeObjectAt(ctx context.Context, req RecognizeRequest) (*RecognizedObject, error) {
	model, imageDataURI := req.Model, req.ImageDataURI
	x, y, radius, disableThinking := req.X, req.Y, req.Radius, req.DisableThinking
	if imageDataURI == "" {
		return nil, fmt.Errorf("缺少图片数据")
	}
	x = clamp01(x)
	y = clamp01(y)
	// 话术要点（都是实测踩出来的）：
	//  1. 用户是"点在物体上"的，但会点偏（点到边缘、背景）——所以问"这一片里最显眼的东西"，
	//     而不是断言"这个点上有物体"（后者会得到"无"，线上已经见过一次）；
	//  2. 明确说点选范围（半径），模型才知道参照物多大；
	//  3. 明确"没有就不要编"：宁可返回无，也不能把背景当物体框出来。
	area := ""
	if radius > 0 {
		area = fmt.Sprintf("，用户点选的范围约是整图宽度的 %.0f%%", radius*200)
	}
	userText := fmt.Sprintf(
		"用户在一张图上点选了一处%s：点选中心在归一化坐标 x=%.3f, y=%.3f（左上角为 (0,0)，右下角为 (1,1)）。"+
			"请给出**由具体到宽泛的 2~3 个层级**的物体，每一个都必须是包含这个点选位置的物体："+
			"① 最具体的局部（例如\"鼻子\"\"眼睛\"\"按钮\"\"车轮\"）；"+
			"② 包含它的整体对象（例如\"人脸\"\"人\"\"机器\"）；"+
			"③ 如果还能再宽一级（例如\"人物\"），再给一个；给不出就给 2 个，不要硬凑。"+
			"（用户点得可能略微偏，按中心附近最突出的物体判断。）"+
			"只输出：{\"objects\":[{\"label\":\"最具体的名字\",\"box\":{\"x\":0,\"y\":0,\"w\":0,\"h\":0}},"+
			"{\"label\":\"包含它的整体\",\"box\":{\"x\":0,\"y\":0,\"w\":0,\"h\":0}}]}。"+
			"label 用中文短语（不超过 10 个字）；box 是该物体在整张图里的紧致外接框"+
			"（归一化 0~1：x,y 为左上角，w,h 为宽高）。"+
			"如果中心附近确实没有任何明确的物体（例如点在纯背景、天空、空白处），"+
			"只输出 {\"objects\":[]} —— 不要为了给答案而把背景算成物体。",
		area, x, y)

	// max_tokens 用模型自己配置的额度（models.yaml 的 max_tokens，通常 8192）。
	// 这里**不能**写小：deepseek 系模型会先思考 400~3400 个 token，预算不够时
	// finish_reason=length、content 为空 —— 看起来像"模型不可用"，其实是预算不足。
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = recognizeDefaultMaxTokens
	}
	opts := []Option{WithTemperature(0.1), WithMaxTokens(maxTokens)}
	if disableThinking {
		opts = append(opts, WithThinkingDisabled())
	}
	resp, err := c.ChatWithImages(ctx, model, recognizeSystemPrompt, userText, []string{imageDataURI}, opts...)
	if err != nil && disableThinking && isThinkingRejected(err) {
		// 关思考是"加速开关"：个别渠道/模型不认这个参数（会回 InvalidParameter）。
		// 不认就摘掉重试一次 —— 宁可慢一点，也不能因为一个可选优化把识别打死。
		log.Printf("[LLM] 点选识别: model=%s 不接受 thinking 参数，摘掉重试: %v", model, err)
		opts = []Option{WithTemperature(0.1), WithMaxTokens(maxTokens)}
		resp, err = c.ChatWithImages(ctx, model, recognizeSystemPrompt, userText, []string{imageDataURI}, opts...)
	}
	if err != nil {
		return nil, err
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("视觉模型返回空响应")
	}
	msg := resp.Choices[0].Message
	content := msg.Content
	if strings.TrimSpace(content) == "" {
		// 推理模型：还没吐出正式回答就先撞上 token 上限时，content 是空的
		content = msg.ReasoningContent
	}
	candidates := parseRecognizeCandidates(content)
	if len(candidates) == 0 {
		// 两种情况都落到这里，但对前端是同一件事：保留用户自己画的圈，别弹错。
		//  · 模型明确回了"无"（点在背景上）—— 这是**合法答案**，不是失败；
		//  · 模型输出没法解析（偶发）。
		// 之前把"无"当成解析失败抛错，用户看到一个红色错误框（线上反馈过），没有任何意义。
		log.Printf("[LLM] 点选识别未认出物体: model=%s 点=(%.3f,%.3f) tokens=%d+%d raw=%s",
			model, x, y, resp.Usage.PromptTokens, resp.Usage.CompletionTokens, truncateForLog(content, 200))
		return &RecognizedObject{
			Label: "", Box: nil, Model: model, Raw: truncateForLog(content, 400),
			PromptTokens: resp.Usage.PromptTokens, CompletionTokens: resp.Usage.CompletionTokens,
		}, nil
	}
	primary := candidates[0]
	out := &RecognizedObject{
		Label: primary.Label, Box: boxPtr(primary.Box), Candidates: candidates,
		Model: model, Raw: truncateForLog(content, 400),
		PromptTokens: resp.Usage.PromptTokens, CompletionTokens: resp.Usage.CompletionTokens,
	}
	log.Printf("[LLM] 点选识别: model=%s 点=(%.3f,%.3f) 半径=%.3f → %d 层 %s tokens=%d+%d",
		model, x, y, radius, len(candidates), candidatesForLog(candidates), out.PromptTokens, out.CompletionTokens)
	return out, nil
}

/**
 * parseRecognizeOutput 解析模型输出，返回清洗后的名字与外接框。
 *
 * 为什么不能直接 json.Unmarshal：实测模型偶尔会套 Markdown 代码块、或在 JSON 前后
 * 加一句"好的，这是结果"，所以先剥壳再截取第一个 JSON 对象。
 * 名字为空/无意义、或框明显不合理（太小 / 占满整图）时，对应字段返回空值 ——
 * 调用方据此退回"只给名字不给框"或"什么都没识别出来"，绝不把坏框画到用户脸上。
 */
// parseRecognizeCandidates 解析模型输出为**由具体到宽泛**的候选层级。
//
// 兼容三种形态：{objects:[{label,box},…]}（当前提示词）、{label,box}（老提示词 /
// 模型自己简化了输出）、以及"无"/无法解析（返回空切片，调用方按"没认出来"处理）。
// 另外按面积升序排一次：模型偶发会把层级写反，面积小的才是"更具体"的那个。
func parseRecognizeCandidates(content string) []RecognizedCandidate {
	raw := stripCodeFence(content)
	if raw == "" {
		return nil
	}
	var multi struct {
		Objects []struct {
			Label string          `json:"label"`
			Name  string          `json:"name"`
			Box   json.RawMessage `json:"box"`
			BBox  json.RawMessage `json:"bbox"`
		} `json:"objects"`
	}
	out := []RecognizedCandidate{}
	if err := json.Unmarshal([]byte(extractJSONObject(raw)), &multi); err == nil {
		for _, o := range multi.Objects {
			label := sanitizeLabel(o.Label)
			if label == "" {
				label = sanitizeLabel(o.Name)
			}
			box := sanitizeBoxCapped(o.Box, recognizeMaxBoxAreaLoose)
			if box == nil {
				box = sanitizeBoxCapped(o.BBox, recognizeMaxBoxAreaLoose)
			}
			if label == "" || box == nil {
				continue
			}
			out = append(out, RecognizedCandidate{Label: label, Box: *box})
		}
	}
	if len(out) == 0 {
		// 单框格式（老提示词 / 模型简化输出）
		label, box := parseRecognizeOutput(raw)
		if label != "" && box != nil {
			out = append(out, RecognizedCandidate{Label: label, Box: *box})
		}
	}
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].Box.W*out[i].Box.H < out[j].Box.W*out[j].Box.H
	})
	// 排序后最具体的那个（面积最小）仍要过主层级的严格上限：
	// 连最小的框都盖住半张图，说明这次没框到具体物体（老行为：整条答案作废 → 触发带思考补问）
	if len(out) > 0 && out[0].Box.W*out[0].Box.H > recognizeMaxBoxArea {
		return nil
	}
	out = dedupeCandidates(out)
	if len(out) > recognizeMaxCandidates {
		out = out[:recognizeMaxCandidates]
	}
	return out
}

// dedupeCandidates 去掉几乎重合的层级（模型偶尔把同一个框给两遍，只是名字不同）
func dedupeCandidates(in []RecognizedCandidate) []RecognizedCandidate {
	out := make([]RecognizedCandidate, 0, len(in))
	for _, c := range in {
		dup := false
		for _, k := range out {
			if math.Abs(k.Box.X-c.Box.X) < 0.01 && math.Abs(k.Box.Y-c.Box.Y) < 0.01 &&
				math.Abs(k.Box.W-c.Box.W) < 0.02 && math.Abs(k.Box.H-c.Box.H) < 0.02 {
				dup = true
				break
			}
		}
		if !dup {
			out = append(out, c)
		}
	}
	return out
}

// candidatesForLog 日志用：label(面积) 一行看完，别把整个 JSON 打进去
func candidatesForLog(cs []RecognizedCandidate) string {
	parts := make([]string, 0, len(cs))
	for _, c := range cs {
		parts = append(parts, fmt.Sprintf("%s(%.2f)", c.Label, c.Box.W*c.Box.H))
	}
	return strings.Join(parts, " > ")
}

// boxPtr 取地址（Box2D 值语义转指针，保持 RecognizedObject.Box 的旧字段可用）
func boxPtr(b Box2D) *Box2D { return &b }

func parseRecognizeOutput(content string) (string, *Box2D) {
	raw := stripCodeFence(content)
	if raw == "" {
		return "", nil
	}
	var parsed struct {
		Label string          `json:"label"`
		Name  string          `json:"name"`
		Box   json.RawMessage `json:"box"`
		BBox  json.RawMessage `json:"bbox"`
	}
	if err := json.Unmarshal([]byte(extractJSONObject(raw)), &parsed); err != nil {
		return "", nil
	}
	label := sanitizeLabel(parsed.Label)
	if label == "" {
		label = sanitizeLabel(parsed.Name)
	}
	box := sanitizeBox(parsed.Box)
	if box == nil {
		box = sanitizeBox(parsed.BBox)
	}
	return label, box
}

// stripCodeFence 剥掉 Markdown 代码块外壳（模型偶尔会把 JSON 包在 ```json 里）。
// 抠 JSON 本体复用 previz.go 的 extractJSONObject（它已经能处理嵌套与尾随逗号）。
func stripCodeFence(content string) string {
	s := strings.TrimSpace(content)
	if i := strings.Index(s, "```"); i >= 0 {
		s = strings.TrimPrefix(s[i+3:], "json")
		if j := strings.Index(s, "```"); j >= 0 {
			s = s[:j]
		}
	}
	return strings.TrimSpace(s)
}

// sanitizeLabel 名字清洗：去引号/句号、截断、过滤"无"这类占位答案
func sanitizeLabel(s string) string {
	s = strings.TrimSpace(s)
	s = strings.Trim(s, "\"'“”‘’「」『』【】《》。，,、 \t\r\n")
	if s == "" {
		return ""
	}
	switch strings.ToLower(s) {
	case "无", "未知", "没有", "无法识别", "none", "null", "n/a", "unknown", "0":
		return ""
	}
	if utf8.RuneCountInString(s) > 20 {
		r := []rune(s)
		s = string(r[:20])
	}
	return s
}

// sanitizeBox 框清洗：兼容对象与数组两种写法，夹到图内、外扩一点，
// 明显不合理的（太小、占满整图、NaN）返回 nil
func sanitizeBox(raw json.RawMessage) *Box2D {
	return sanitizeBoxCapped(raw, recognizeMaxBoxArea)
}

// sanitizeBoxCapped 同上，但可指定面积上限（宽泛层级用宽松上限，见 cleanBox 注释）
func sanitizeBoxCapped(raw json.RawMessage, maxArea float64) *Box2D {
	if len(raw) == 0 {
		return nil
	}
	var box Box2D
	if err := json.Unmarshal(raw, &box); err != nil {
		// 兼容 [x, y, w, h]
		var arr []float64
		if err2 := json.Unmarshal(raw, &arr); err2 != nil || len(arr) != 4 {
			return nil
		}
		box = Box2D{X: arr[0], Y: arr[1], W: arr[2], H: arr[3]}
	}
	return cleanBox(box, maxArea)
}

// cleanBox 把原始框夹到合理范围；返回 nil 表示"这个框不能用"。
// 面积上限按 maxArea 卡：主层级（最具体那个）用 recognizeMaxBoxArea 挡住"把整张图当物体"，
// 更宽泛的层级（人脸/人物）本来就该占大半张图，用 recognizeMaxBoxAreaLoose。
func cleanBox(box Box2D, maxArea float64) *Box2D {
	for _, v := range []float64{box.X, box.Y, box.W, box.H} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil
		}
	}
	// 有的模型会给"两个角点"而不是"左上+宽高"：宽高为负或异常大时按角点还原
	if box.W < 0 || box.H < 0 {
		box.W, box.H = math.Abs(box.W), math.Abs(box.H)
	}
	if box.W <= 0 || box.H <= 0 {
		return nil
	}
	if box.W < recognizeMinBoxSide || box.H < recognizeMinBoxSide {
		return nil
	}
	if box.W*box.H > maxArea {
		return nil
	}
	// 外扩一圈（给改图留边），再夹进图内
	box.X -= box.W * recognizePadRatio
	box.Y -= box.H * recognizePadRatio
	box.W *= 1 + recognizePadRatio*2
	box.H *= 1 + recognizePadRatio*2
	box.X = clamp01(box.X)
	box.Y = clamp01(box.Y)
	if box.X+box.W > 1 {
		box.W = 1 - box.X
	}
	if box.Y+box.H > 1 {
		box.H = 1 - box.Y
	}
	if box.W < recognizeMinBoxSide || box.H < recognizeMinBoxSide {
		return nil
	}
	return &Box2D{X: round3(box.X), Y: round3(box.Y), W: round3(box.W), H: round3(box.H)}
}

func clamp01(v float64) float64 {
	if math.IsNaN(v) {
		return 0
	}
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func round3(v float64) float64 { return math.Round(v*1000) / 1000 }

// truncateForLog 日志用的短截断（中文按字符截，避免截出半个字）
func truncateForLog(s string, max int) string {
	s = strings.TrimSpace(s)
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}
