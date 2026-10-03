package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"strings"
)

// PrevizAnalyzeSystemPrompt 白模场景分析系统提示词：
// 让视觉模型把参考图的空间结构近似成几何体布局，输出严格 JSON
const PrevizAnalyzeSystemPrompt = `你是一个 3D 白模场景搭建助手。用户会给你一张参考图（实景照片、剧照、绘画或视频帧），请把图中的空间结构近似成简单几何体布局，用于影视预演（previz）的白模场景。

输出严格 JSON（不要输出任何其他文字、不要用 markdown 代码块包裹）：
{"objects":[...], "description":"场景一句话概述"}

objects 数组中每个对象的字段：
- type：元素类型，共 39 种，按分类如下（只能用这些）：
  - 基础几何：box=块状物（家具/箱体等）、cylinder=柱状物（柱子/杆）、sphere=球体/球形装饰、plane=水平面（地面/桌面）、wall=竖直薄板（墙体/隔断）
  - 建筑结构：stairs=楼梯/台阶（沿 -z 方向上行）、house=房屋/建筑（自带屋顶，不要再拆成 box+屋顶）、fence=栅栏/围栏/护栏、ramp=斜坡/坡道、platform=平台/高台/舞台、door=门、window=窗、arch=拱门/门洞、railing=栏杆
  - 街道设施：road=街道/路面/跑道（薄长条）、streetlamp=路灯/灯杆、bench=长椅/座椅、signboard=招牌/广告牌、sidewalk=人行道、utilitypole=电线杆
  - 家具：table=桌子、chair=椅子/凳子、sofa=沙发、bed=床、cabinet=柜子/衣柜/书架、screen=屏幕/电视/显示器
  - 载具：car=轿车/车辆、truck=卡车/货车、motorcycle=摩托车、bicycle=自行车/单车
  - 自然：tree=树木/绿植、rock=岩石/石头、bush=灌木/草丛、water=水面/泳池/河流、hill=土坡/山丘、pool=游泳池（水体+池沿）、mountain=山（尖顶山体）、fountain=喷泉、bridge=桥
- name：中文名称（如"桌子""承重柱""东墙""住宅楼"）
- position：元素中心坐标 [x, y, z]
- rotation：弧度欧拉角 [rx, ry, rz]，一般给 [0,0,0]，墙体/房屋/车辆可给绕 y 的旋转
- scale：元素三轴实际尺寸米数 [sx, sy, sz]（各类型内部比例已内置，scale 即实际米数；典型值：楼梯 [2,1.5,3]、房子 [6,4,6]、路面 [4,1,12]、树 [2,3,2]、栅栏 [2,1,1]、轿车 [4.5,1.6,1.8]、卡车 [6,2.6,2.2]、桌子 [1.6,0.75,0.9]、沙发 [2,0.85,0.9]、路灯 [1,3.5,1]、电线杆 [1,6,1]、游泳池 [5,0.7,3]、山 [6,4,6]、喷泉 [1.6,0.9,1.6]、桥 [4,0.8,8]）

坐标系约定：
- y 轴向上，地面为 y=0；x 向右；z 朝向观察者
- box/cylinder/sphere/wall 的 y = 半高（即 scale[1]/2）；其余落地组件（stairs/house/road/tree/fence/car 等）y 直接给 0（几何从地面起建）；window 挂在墙上，y 给窗底离地高度
- 整个场景限制在 20x20 米范围内（x、z 大致在 -10 到 10 之间）

要求：
- 对象数量 5-30 个，宁简勿繁，只抓主要空间结构和大型物体，忽略小物件和装饰细节
- 室内场景至少给出地面 plane + 墙体围出空间边界，家具用对应的家具类型（table/sofa/bed 等）而不是 box
- 街道场景要包含 road + sidewalk + 两侧 house/wall + tree/streetlamp 等层次
- 只输出 JSON，不要输出任何解释文字`

// PrevizSceneObject AI 解析出的白模场景对象（清洗后返回给前端）
type PrevizSceneObject struct {
	Type     string     `json:"type"`
	Name     string     `json:"name"`
	Position [3]float64 `json:"position"`
	Rotation [3]float64 `json:"rotation"`
	Scale    [3]float64 `json:"scale"`
}

// previzSceneObjectRaw 模型原始返回（数组长度/数值可能不合法，需清洗）
type previzSceneObjectRaw struct {
	Type     string    `json:"type"`
	Name     string    `json:"name"`
	Position []float64 `json:"position"`
	Rotation []float64 `json:"rotation"`
	Scale    []float64 `json:"scale"`
}

// 合法元素类型（与前端 PrevizObjectType 一致，共 39 种）
var previzObjectTypes = map[string]bool{
	// 基础几何
	"box": true, "cylinder": true, "sphere": true, "plane": true, "wall": true,
	// 建筑结构
	"stairs": true, "house": true, "fence": true, "ramp": true, "platform": true,
	"door": true, "window": true, "arch": true, "railing": true,
	// 街道设施
	"road": true, "streetlamp": true, "bench": true, "signboard": true, "sidewalk": true, "utilitypole": true,
	// 家具
	"table": true, "chair": true, "sofa": true, "bed": true, "cabinet": true, "screen": true,
	// 载具
	"car": true, "truck": true, "motorcycle": true, "bicycle": true,
	// 自然
	"tree": true, "rock": true, "bush": true, "water": true, "hill": true,
	"pool": true, "mountain": true, "fountain": true, "bridge": true,
}

// 数值钳制
func clampFloat(v, min, max float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return min
	}
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

// 归一化三元数组：长度不合法时用默认值补齐/截断，逐值钳制
func normalizeVec3(raw []float64, def [3]float64, min, max float64) [3]float64 {
	out := def
	for i := 0; i < 3 && i < len(raw); i++ {
		out[i] = clampFloat(raw[i], min, max)
	}
	return out
}

// sanitizePrevizObject 防御性清洗单个对象；类型未知返回 false（丢弃）
func sanitizePrevizObject(raw previzSceneObjectRaw) (PrevizSceneObject, bool) {
	objType := strings.ToLower(strings.TrimSpace(raw.Type))
	if !previzObjectTypes[objType] {
		return PrevizSceneObject{}, false
	}
	name := strings.TrimSpace(raw.Name)
	if name == "" {
		name = objType
	}
	return PrevizSceneObject{
		Type:     objType,
		Name:     name,
		Position: normalizeVec3(raw.Position, [3]float64{0, 0.5, 0}, -50, 50),
		Rotation: normalizeVec3(raw.Rotation, [3]float64{0, 0, 0}, -math.Pi*2, math.Pi*2),
		Scale:    normalizeVec3(raw.Scale, [3]float64{1, 1, 1}, 0.05, 50),
	}, true
}

// salvageTruncatedJSON 抢救被 max_tokens 截断的输出。
// 实测形态：{"objects":[{"type":"plane",...},{"type":"pool","scale  ← 断在对象中间。
// 做法：扫描 objects 数组，记录最后一个"完整对象"的结束位置，然后补上 ]} 收口。
// 这样前半段已经完整描述出来的几何体不会白丢，用户能直接得到可用场景。
func salvageTruncatedJSON(s string) (string, bool) {
	key := strings.Index(s, `"objects"`)
	if key < 0 {
		return "", false
	}
	open := strings.Index(s[key:], "[")
	if open < 0 {
		return "", false
	}
	open += key
	depth, inStr, esc := 0, false, false
	lastComplete := -1
	for i := open; i < len(s); i++ {
		ch := s[i]
		if inStr {
			switch {
			case esc:
				esc = false
			case ch == '\\':
				esc = true
			case ch == '"':
				inStr = false
			}
			continue
		}
		switch ch {
		case '"':
			inStr = true
		case '{', '[':
			depth++
		case '}':
			depth--
			if depth == 1 {
				lastComplete = i // objects 数组里某个对象刚好结束
			}
		case ']':
			depth--
		}
	}
	if lastComplete < 0 {
		return "", false
	}
	return s[:lastComplete+1] + "]}", true
}

// extractJSONObject 从模型输出里尽力抠出最外层的 JSON 对象。
// 背景：模型经常在 JSON 前后带说明文字、或留下尾随逗号，直接 Unmarshal 会整体失败，
// 用户白跑一次生成（虽然会自动退费，但体验很差）。这里做两层容错：
//  1. 定位最外层 {}（正确跳过字符串与转义，嵌套对象不会被提前截断）
//  2. 去掉对象/数组结尾前多余逗号
//
// 若括号不闭合（通常是 max_tokens 截断），原样返回，交由上层报错。
func extractJSONObject(raw string) string {
	start := strings.Index(raw, "{")
	if start < 0 {
		return raw
	}
	depth := 0
	inStr, esc, end := false, false, -1
	for i := start; i < len(raw); i++ {
		ch := raw[i]
		if inStr {
			switch {
			case esc:
				esc = false
			case ch == '\\':
				esc = true
			case ch == '"':
				inStr = false
			}
			continue
		}
		switch ch {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				end = i
			}
		}
		if end >= 0 {
			break
		}
	}
	if end < 0 {
		// 括号不闭合 —— 基本就是被 max_tokens 截断了，尽力抢救完整的那部分
		if fixed, ok := salvageTruncatedJSON(raw[start:]); ok {
			return stripTrailingCommas(fixed)
		}
		return raw
	}
	return stripTrailingCommas(raw[start : end+1])
}

// stripTrailingCommas 去掉 } 或 ] 之前多余的逗号（模型很爱加，严格 JSON 不允许）。
func stripTrailingCommas(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	inStr, esc := false, false
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if inStr {
			b.WriteByte(ch)
			switch {
			case esc:
				esc = false
			case ch == '\\':
				esc = true
			case ch == '"':
				inStr = false
			}
			continue
		}
		if ch == '"' {
			inStr = true
			b.WriteByte(ch)
			continue
		}
		if ch == ',' {
			j := i + 1
			for j < len(s) && (s[j] == ' ' || s[j] == '\n' || s[j] == '\t' || s[j] == '\r') {
				j++
			}
			if j < len(s) && (s[j] == '}' || s[j] == ']') {
				continue
			}
		}
		b.WriteByte(ch)
	}
	return b.String()
}

// AnalyzeSceneImage 调用视觉模型分析参考图，返回清洗后的几何体布局 + 场景概述
func (c *Client) AnalyzeSceneImage(ctx context.Context, model, imageURL string) ([]PrevizSceneObject, string, error) {
	resp, err := c.ChatWithImages(
		ctx, model,
		PrevizAnalyzeSystemPrompt,
		"请分析这张参考图的空间结构，输出白模场景的几何体布局 JSON。",
		[]string{imageURL},
		WithTemperature(0.2),
		WithMaxTokens(8192),
	)
	if err != nil {
		return nil, "", err
	}
	if len(resp.Choices) == 0 {
		return nil, "", fmt.Errorf("LLM 返回空响应")
	}

	content := resp.Choices[0].Message.Content
	// 推理模型：content 为空时回退 reasoning_content
	if content == "" && resp.Choices[0].Message.ReasoningContent != "" {
		content = resp.Choices[0].Message.ReasoningContent
	}

	var parsed struct {
		Objects     []previzSceneObjectRaw `json:"objects"`
		Description string                 `json:"description"`
	}
	if err := json.Unmarshal([]byte(extractJSONObject(cleanJSONMarkdown(content))), &parsed); err != nil {
		preview := content
		if len(preview) > 500 {
			preview = preview[:500]
		}
		tail := ""
		if len(content) > 300 {
			tail = content[len(content)-300:]
		}
		// 带上长度与尾部：长度顶到 max_tokens 附近基本就是被截断，而不是模型乱写
		log.Printf("[Previz] 场景解析 JSON 反序列化失败: %v 总长=%d raw头=%s raw尾=%s", err, len(content), preview, tail)
		return nil, "", fmt.Errorf("场景解析结果格式有误")
	}

	objects := make([]PrevizSceneObject, 0, len(parsed.Objects))
	for _, raw := range parsed.Objects {
		if obj, ok := sanitizePrevizObject(raw); ok {
			objects = append(objects, obj)
		}
	}
	if len(objects) == 0 {
		log.Printf("[Previz] 场景解析结果为空（清洗后无合法对象）: raw=%s", content)
		return nil, "", fmt.Errorf("场景解析结果为空，请换一张更清晰的参考图")
	}

	return objects, parsed.Description, nil
}
