package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"libtv/internal/service"
)

/**
 * 元素编辑（局部重绘）：用户在图片节点上框/点出选区，写一句短提示词，只重画选区里的内容。
 *
 * 前端在节点 data 上写一次性指令 elementEdit{baseUrl,maskUrl,prompt}
 * （web/src/components/canvas/imageops/ElementEditOverlay.tsx 的 submitElementEdit）：
 *   - baseUrl：生成前这张图的地址（= 节点当时的 imageUrl），既是"要改的原图"也是参考图；
 *   - maskUrl：选区蒙版，白色（亮）= 允许改，黑色 = 必须保持原样；
 *   - prompt：用户那一句短提示词。
 *
 * 这里还负责"把选区裁出来当参考图"（见 elementCropRect）：上游接口没有蒙版入参，
 * 只喂整张图时模型会把整张图重画一遍，我们从重画结果里抠出选区 —— 抠到的是"另一次重绘的碎片"，
 * 内容和周边对不上、也不一定是用户要的改动。裁出"选区+一圈周边"再喂，模型的这一次重绘
 * 天然就是"只重画这一块"，贴回来才对得上。
 *
 * 为什么指令放在节点 data 的独立字段上，而不是复用埋点/mentions：
 *  1. "节点给自己当参考图"没有别的表达方式 —— 参考图靠上游边或 @ 引用，而给自己的边
 *     会被 Validate 的环检测直接判成 cycle，执行计划都建不起来；
 *  2. 上游接口没有蒙版入参（llm/image.go 只有 model/prompt/size/n/image），
 *     "只改选区"必须由我们在生成后把结果贴回原图，这一步需要知道原图与蒙版在哪。
 */

// elementEditSpec 元素编辑指令（前端写的字段名用小驼峰，与画布 JSON 一致）
type elementEditSpec struct {
	BaseURL string `json:"baseUrl"`
	MaskURL string `json:"maskUrl"`
	Prompt  string `json:"prompt"`
	// Target 点选识别出来的物体名（如"自动售货机"）。
	// 有它，指令里的"这个"才有指代：模型看到的是"把「自动售货机」去掉"，
	// 而不是"把这个去掉"——后者只能靠猜，线上实测会变成"原样重画一遍"。
	Target string `json:"target"`
	// MoveTo 可选：把选区里的东西**移动**到这个位置（归一化 0~1，指的是目标位置的**中心**）。
	// 用户点"移动"后在图上点一下落点，前端就把它写进来。为空 = 普通局部重绘（原地改）。
	//
	// 为什么非要单独一个字段：移动的"改动区域"是**两块**（原位置补背景 + 新位置画上物体），
	// 裁剪框必须同时罩住两块，模型才可能把东西搬过去；只喂源区域时它会以为你只是要改这一块。
	MoveTo *elementMoveTo `json:"moveTo"`
}

// elementMoveTo 移动目标（归一化中心点）
type elementMoveTo struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// parseElementEdit 解析节点上的元素编辑指令。缺字段就当作"没开元素编辑"返回 nil：
// 宁可退回普通生成，也不要因为一个坏字段把整次生成弄失败。
func parseElementEdit(raw json.RawMessage) *elementEditSpec {
	if len(raw) == 0 {
		return nil
	}
	var spec elementEditSpec
	if err := json.Unmarshal(raw, &spec); err != nil {
		log.Printf("[ImageExecutor] elementEdit 解析失败，按普通生成处理: err=%v raw=%s", err, truncateForLog(string(raw), 200))
		return nil
	}
	spec.BaseURL = strings.TrimSpace(spec.BaseURL)
	spec.MaskURL = strings.TrimSpace(spec.MaskURL)
	spec.Prompt = strings.TrimSpace(spec.Prompt)
	spec.Target = strings.TrimSpace(spec.Target)
	if spec.BaseURL == "" || spec.MaskURL == "" {
		log.Printf("[ImageExecutor] elementEdit 缺 baseUrl/maskUrl，按普通生成处理: baseUrl=%q maskUrl=%q", spec.BaseURL, spec.MaskURL)
		return nil
	}
	return &spec
}

// elementFetchMaxBytes 原图/蒙版下载上限。4K PNG 实测 4~5MB，给足余量但必须有上限
// （这两个地址来自画布 JSON，不能无限读）。
const elementFetchMaxBytes = 64 << 20

// elementFetchTimeout 拉原图+蒙版的整体上限。它们是本站对象存储的地址，正常几百毫秒。
const elementFetchTimeout = 60 * time.Second

/**
 * 裁剪给模型看的那一块时，选区四周留的周边比例（相对选区尺寸）。
 * 比例小一点更好：目标在画面里占得越大，模型越容易认准"改的是它"。
 * 必须留：模型要靠周边的光线/材质/透视才知道这块怎么画，只给一小块孤立区域，
 * 它容易画出"贴上去的物体"（边缘突兀、光不对）。
 */
const elementCropMarginRatio = 0.22

// elementCropMinMargin 周边像素下限：选区很小（点选那种）时也得有上下文
const elementCropMinMargin = 48

// elementCropSkipAreaRatio 裁剪框几乎覆盖整张原图就不裁了：没有收益，还白多一次上传
const elementCropSkipAreaRatio = 0.9

// fetchElementImage 下载一张完整的图（字节级）。
// 站内相对路径走本机后端 —— 与 llm 包 ConvertLocalImageToBase64、image_size.go 同一约定。
func fetchElementImage(ctx context.Context, url string) ([]byte, error) {
	fullURL := url
	if strings.HasPrefix(url, "/") {
		fullURL = fmt.Sprintf("http://localhost:8080%s", url)
	}
	reqCtx, cancel := context.WithTimeout(ctx, elementFetchTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}
	resp, err := (&http.Client{Timeout: elementFetchTimeout}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载失败: HTTP %d", resp.StatusCode)
	}
	// 多读 1 字节：能区分"刚好等于上限"和"超了"
	data, err := io.ReadAll(io.LimitReader(resp.Body, elementFetchMaxBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取内容失败: %w", err)
	}
	if len(data) > elementFetchMaxBytes {
		return nil, fmt.Errorf("图片超过 %dMB，拒绝处理", elementFetchMaxBytes>>20)
	}
	if len(data) == 0 {
		return nil, errors.New("图片内容为空")
	}
	return data, nil
}

// elementCompositor 本次执行的"贴回"工序：原图与蒙版只拉一次，本次生成的多张结果共用。
type elementCompositor struct {
	spec *elementEditSpec
	base []byte
	mask []byte
	w, h int
	/** 选区外接框（原图像素坐标）：既用来算裁剪框，也用来写"改哪里"那句方位说明 */
	selection image.Rectangle
	/** 送给模型的裁剪框（原图像素坐标）；零值 = 不裁剪（选区几乎占满整张图） */
	crop image.Rectangle
	/** 羽化半径（原图像素）：按选区大小算，见 elementFeatherRadius */
	feather int
	/** 点选识别出来的物体名（可为空）：写进改图指令，补上"这个"的指代 */
	target string
	/** 移动目标中心（原图像素坐标）；moveDest = 落点 + 与选区同尺寸的框。仅移动模式下有效 */
	moveTo   image.Point
	moveDest image.Rectangle
}

// clamp01 把归一化坐标夹进 [0,1]（前端理论上已经夹过，这里是防御）
func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// moving 本次是否是"把选区里的东西搬到别处"
func (c *elementCompositor) moving() bool { return !c.moveDest.Empty() }

// cropped 本次是否只把"选区+周边"裁出来送模型（而不是整张原图）
func (c *elementCompositor) cropped() bool { return !c.crop.Empty() }

// scopeName 日志里的人话名字：这次模型到底"画的是哪一块"
func elementEditScopeName(c *elementCompositor) string {
	if c.cropped() {
		return "裁剪图"
	}
	return "原图"
}

// newElementCompositor 拉取原图与蒙版并量出原图尺寸。
//
// 这里失败**必须让整次执行失败**，不能悄悄退回普通生成：那样会整图重画一遍、
// 白扣一次积分，用户看到的是"我只让他改一个杯子，结果整张图都变了"。
// 调用点在扣费之前，所以这条错误不会产生费用。
func newElementCompositor(ctx context.Context, spec *elementEditSpec) (*elementCompositor, error) {
	c := &elementCompositor{spec: spec}
	var err error
	if c.base, err = fetchElementImage(ctx, spec.BaseURL); err != nil {
		return nil, fmt.Errorf("元素编辑：下载原图失败（%s）: %w", spec.BaseURL, err)
	}
	if c.mask, err = fetchElementImage(ctx, spec.MaskURL); err != nil {
		return nil, fmt.Errorf("元素编辑：下载蒙版失败（%s）: %w", spec.MaskURL, err)
	}
	w, h, ok := aspectRatioOfImageHeader(c.base)
	if !ok {
		// 标准库只认 PNG/JPEG/GIF（WebP 等要额外依赖，见 go.mod），所以这里把范围写进报文里：
		// 用户看到的必须是"换个格式再来"，而不是一句无从下手的"处理失败"。
		return nil, errors.New("元素编辑：这张图的格式无法处理（仅支持 PNG/JPEG）；" +
			"WebP/HEIC 等格式请先转成 PNG/JPEG 再编辑（例如先用「画质提升」导出一次）")
	}
	c.w, c.h = w, h

	// 选区外接框：直接从蒙版亮部算（前端只上传蒙版，框选/点选、几处选区都已经在里面）
	selection, serr := service.MaskBounds(c.mask)
	if serr != nil {
		return nil, fmt.Errorf("元素编辑：解析选区蒙版失败: %w", serr)
	}
	if selection.Empty() {
		// 蒙版全是黑的 = 用户没框到任何东西。这里必须拦住：
		// 放过去就是白扣一次积分、还生成一张和原图一样的图。
		return nil, errors.New("元素编辑：蒙版里没有选区，请先在图上框选或点选要修改的内容")
	}
	// 蒙版尺寸理论上等于原图（前端按原图尺寸渲染），万一不等就按比例换算，
	// 否则裁剪框会落错位置 —— 那种错法从结果上看是"改错了地方"，很难猜。
	if mw, mh, ok := aspectRatioOfImageHeader(c.mask); ok && mw > 0 && mh > 0 && (mw != c.w || mh != c.h) {
		x0 := selection.Min.X * c.w / mw
		y0 := selection.Min.Y * c.h / mh
		x1 := selection.Max.X * c.w / mw
		y1 := selection.Max.Y * c.h / mh
		if x1 <= x0 {
			x1 = x0 + 1
		}
		if y1 <= y0 {
			y1 = y0 + 1
		}
		selection = image.Rect(x0, y0, x1, y1)
	}
	c.selection = selection
	// 移动模式：把"落点 + 与选区同尺寸的框"算出来，并让裁剪框同时罩住源与目标 ——
	// 只裁源区域的话，模型画布上根本没有落点，它只会把原处重画一遍。
	if spec.MoveTo != nil {
		mx := int(math.Round(clamp01(spec.MoveTo.X) * float64(c.w)))
		my := int(math.Round(clamp01(spec.MoveTo.Y) * float64(c.h)))
		if mx < 0 {
			mx = 0
		}
		if my < 0 {
			my = 0
		}
		c.moveTo = image.Pt(mx, my)
		c.moveDest = image.Rect(mx-selection.Dx()/2, my-selection.Dy()/2,
			mx-selection.Dx()/2+selection.Dx(), my-selection.Dy()/2+selection.Dy()).
			Intersect(image.Rect(0, 0, c.w, c.h))
	}
	// 落点也并进蒙版：前端会画，但"搬过去的东西能不能贴回来"不能押在前端画得准上
	if c.moving() {
		if merged, merr := service.MaskUnionRect(c.mask, c.moveDest); merr == nil {
			c.mask = merged
		} else {
			log.Printf("[ImageExecutor] ⚠️ 元素编辑：落点并入蒙版失败（仍按原蒙版继续）: %v", merr)
		}
	}
	c.crop = elementCropRect(c.regionForCrop(), c.w, c.h)
	c.feather = elementFeatherRadius(selection, c.w)
	c.target = spec.Target

	moveInfo := ""
	if c.moving() {
		moveInfo = fmt.Sprintf(" 移动=(%d,%d) 目标框=%v", c.moveTo.X, c.moveTo.Y, c.moveDest)
	}
	log.Printf("[ImageExecutor] 🖌️ 元素编辑：原图 %dx%d（%d 字节）mask=%d 字节 选区=[%d,%d %d,%d] 裁剪=%v（%dx%d）目标=%q%s",
		c.w, c.h, len(c.base), len(c.mask),
		selection.Min.X, selection.Min.Y, selection.Max.X, selection.Max.Y,
		c.cropped(), c.crop.Dx(), c.crop.Dy(), c.target, moveInfo)
	return c, nil
}

// elementCropRect 由选区外接框算出"送给模型的裁剪框"：四周各留一圈上下文，并夹在原图范围内。
// 选区几乎覆盖整张图时返回零值（不裁剪）。
func elementCropRect(selection image.Rectangle, w, h int) image.Rectangle {
	if selection.Empty() || w <= 0 || h <= 0 {
		return image.Rectangle{}
	}
	mx := int(float64(selection.Dx()) * elementCropMarginRatio)
	my := int(float64(selection.Dy()) * elementCropMarginRatio)
	if mx < elementCropMinMargin {
		mx = elementCropMinMargin
	}
	if my < elementCropMinMargin {
		my = elementCropMinMargin
	}
	r := image.Rect(selection.Min.X-mx, selection.Min.Y-my, selection.Max.X+mx, selection.Max.Y+my).
		Intersect(image.Rect(0, 0, w, h))
	if r.Empty() {
		return image.Rectangle{}
	}
	if float64(r.Dx()*r.Dy()) >= elementCropSkipAreaRatio*float64(w*h) {
		return image.Rectangle{}
	}
	return r
}

/**
 * elementFeatherRadius 选区边缘的羽化半径（原图像素）。
 *
 * 原来固定按图宽取千分之四（4K 约 15px），对小选区偏硬：模型重画的那块与周边之间
 * 只有十几像素的过渡，边界上还是能看出"贴了一块"。改成按**选区尺寸**取（十二分之一，
 * 上下限 6~图宽/60），选区越小过渡相对越柔，同时不会把改动糊进周边太远。
 */
func elementFeatherRadius(selection image.Rectangle, imgW int) int {
	if selection.Empty() {
		return 0
	}
	minSide := selection.Dx()
	if selection.Dy() < minSide {
		minSide = selection.Dy()
	}
	r := minSide / 12
	if r < 6 {
		r = 6
	}
	if max := imgW / 60; max > 0 && r > max {
		r = max
	}
	return r
}

// regionForCrop 裁剪要罩住的区域：普通模式就是选区；移动模式是**源与目标的并集**
// （两块都要能画到，否则搬不过去）。
func (c *elementCompositor) regionForCrop() image.Rectangle {
	if !c.moving() {
		return c.selection
	}
	return c.selection.Union(c.moveDest)
}

// cropBytes 裁出送给模型的局部图。未裁剪时返回 nil, "", nil。
// 格式跟着原图走（原图是 JPEG 就出 JPEG：选区一般是照片，PNG 会大好几倍）。
func (c *elementCompositor) cropBytes() ([]byte, string, error) {
	if !c.cropped() {
		return nil, "", nil
	}
	baseImg, err := service.DecodeImageAny(c.base)
	if err != nil {
		return nil, "", fmt.Errorf("解码原图失败: %w", err)
	}
	dst := image.NewRGBA(image.Rect(0, 0, c.crop.Dx(), c.crop.Dy()))
	draw.Draw(dst, dst.Bounds(), baseImg, c.crop.Min, draw.Src)

	ext, contentType := service.DetectImageExt(c.base)
	var buf bytes.Buffer
	if ext == ".jpg" || ext == ".jpeg" {
		if err := jpeg.Encode(&buf, dst, &jpeg.Options{Quality: 92}); err != nil {
			return nil, "", fmt.Errorf("编码裁剪图失败: %w", err)
		}
	} else {
		if err := png.Encode(&buf, dst); err != nil {
			return nil, "", fmt.Errorf("编码裁剪图失败: %w", err)
		}
	}
	return buf.Bytes(), contentType, nil
}

// size 原图的像素尺寸（用于按原图长宽比出图）
func (c *elementCompositor) size() (int, int) {
	return c.w, c.h
}

// apply 把模型结果按蒙版贴回原图，返回合成结果（选区外是原图字节）。
// 裁剪模式下，模型结果是"裁剪图"的重绘，先摆回裁剪原位再按蒙版混合。
func (c *elementCompositor) apply(generated []byte) ([]byte, error) {
	return service.CompositeElementEdit(c.base, generated, c.mask, c.crop, c.feather)
}

// aspectRatioString 出图的长宽比，形如 "4:3"（拿不到就给空串，调用方退回默认）。
// 裁剪模式下用**裁剪图**的比例：模型这次要产出的是那一块，尺寸跟着它才不会有形变。
func (c *elementCompositor) aspectRatioString() string {
	if c.cropped() {
		return fmt.Sprintf("%d:%d", c.crop.Dx(), c.crop.Dy())
	}
	if c.w <= 0 || c.h <= 0 {
		return ""
	}
	return fmt.Sprintf("%d:%d", c.w, c.h)
}

/**
 * buildRequestPrompt 元素编辑的完整请求话术。
 *
 * 为什么不能沿用图生图的通用话术（buildImageToImagePrompt 的参考图分支）：
 * 那句是"**请保持参考图中的主体结构、细节特征和整体风格**，只进行用户指定的修改"，
 * 对元素编辑来说是**反话** —— 用户要的恰恰是把那一处的东西去掉/换掉/挪走，
 * 模型收到"保持主体结构"就老老实实把东西留在原处。线上实测（用户反馈"选块内的东西
 * 并没有修改"）就是这个现象：像素确实换了（模型重绘了一遍），但东西还在。
 *
 * 这段话术必须由后端拼，不能由前端拼：裁剪之后"画面下方左侧"这种全图方位描述就错了，
 * 而且只有后端知道这次裁没裁、选区落在参考图里的哪个位置。
 */
func (c *elementCompositor) buildRequestPrompt(userPrompt string) string {
	sel := c.selection
	if sel.Empty() {
		sel = image.Rect(0, 0, c.w, c.h)
	}
	// 方位要按"模型实际看到的画面"来说：未裁剪 = 整张原图；裁剪 = 那张裁剪图
	// （用户原话里的"画面下方"指的是整图，裁剪后照搬会让模型在局部图里找错地方）
	frame := image.Rect(0, 0, c.w, c.h)
	if c.cropped() {
		frame = c.crop
	}
	scene := "这张图"
	if c.cropped() {
		scene = "下面这张局部图（它是从原图里裁出来的待修改区域，含周边一小圈上下文）"
	}
	// 目标是识别出来的物体名时点明"就是它"：模型对"这个"没有指代，对"自动售货机"有
	target := "（用户框选的就是它）"
	if strings.TrimSpace(c.target) != "" {
		// 识别出名字时点明"就是它"：模型对"这个"没有指代，对"自动售货机"有
		target = fmt.Sprintf("（「%s」，用户框选的就是它）", strings.TrimSpace(c.target))
	}
	user := strings.TrimSpace(userPrompt)
	if c.moving() {
		// 移动：源与目标都按"模型看到的画面"描述方位。要说清三件事，缺一件模型就会乱来：
		//   ① 搬的是什么、搬到哪（两块位置都点明）；
		//   ② 原位置要**补全**（不说的话它会留个空洞或残影）；
		//   ③ 大小朝向不变（不说的话它会顺手缩放/旋转）。
		srcPos := relativePositionText(sel, frame)
		dstPos := relativePositionText(c.moveDest, frame)
		moveLine := fmt.Sprintf(
			"图像编辑任务：把%s%s的目标%s整体**移动到%s**（这就是它的新位置，大小、朝向、外观保持不变）。",
			scene, srcPos, target, dstPos)
		// 用户如果还写了要求（例如"顺便换成红色"），一并带上；没写就只描述移动
		extra := ""
		if user != "" {
			extra = fmt.Sprintf("另外，用户对它的要求是：「%s」。\n", user)
		}
		return fmt.Sprintf(
			"%s\n"+
				"%s"+
				"原位置（%s）必须用周围的背景/内容自然补全，不要留下空洞、残影或明显的拼接痕迹；"+
				"新位置要画出这个目标本身，不要只画一个轮廓或影子。\n"+
				"画面其他部分（构图、光线、其他物体及其位置）必须保持完全不变，请直接输出修改后的图像。",
			moveLine, extra, srcPos)
	}
	return fmt.Sprintf(
		"图像编辑任务：%s的%s就是要修改的目标%s。用户的要求是：「%s」。\n"+
			"请按这个要求直接修改该处：把目标去掉、换成别的东西、或按用户说的改动它本身；"+
			"不要只是把它重画一遍，也不要保留它原来的样子。\n"+
			"画面其他部分（构图、背景、光线、其他物体及其位置）必须保持完全不变，请直接输出修改后的图像。",
		scene, relativePositionText(sel, frame), target, user)
}

// relativePositionText 用方位词描述选区在整帧里的位置（"下方左侧"/"正中央"）。
// 模型对"只改这一处"的服从度，很大程度取决于它能否定位到那一处；
// 只给蒙版坐标它读不懂，所以这里说人话。
func relativePositionText(sel, frame image.Rectangle) string {
	if sel.Empty() || frame.Empty() || frame.Dx() <= 0 || frame.Dy() <= 0 {
		return "中间"
	}
	// 占了大半张图就别再说方位了：说"下方"反而会让模型只动下半张
	if float64(sel.Dx()*sel.Dy()) >= 0.6*float64(frame.Dx()*frame.Dy()) {
		return "大部分区域"
	}
	// 必须按 frame 的**起点与边长**换算，不能除以 frame.Max：
	// 未裁剪时 frame 从 (0,0) 起，两者等价；裁剪模式下 frame 从裁剪框左上角开始，
	// 除 Max 会把选区一律算成"偏右下"（实测裁到 260x260 的小图里，正中央的选区被说成"下方右侧"）。
	cx := float64((sel.Min.X+sel.Max.X)/2-frame.Min.X) / float64(frame.Dx())
	cy := float64((sel.Min.Y+sel.Max.Y)/2-frame.Min.Y) / float64(frame.Dy())
	vertical := ""
	switch {
	case cy < 0.4:
		vertical = "上方"
	case cy > 0.6:
		vertical = "下方"
	}
	horizontal := ""
	switch {
	case cx < 0.4:
		horizontal = "左侧"
	case cx > 0.6:
		horizontal = "右侧"
	}
	if vertical == "" && horizontal == "" {
		return "正中央"
	}
	return vertical + horizontal
}

/**
 * uploadElementCrop 把裁剪出来的局部图落一次对象存储，返回它的公网地址。
 *
 * 为什么必须落盘：上游的图像接口只接受 URL（llm.ImageRequest.Image 是地址数组），
 * 没有"直接传字节"的入口 —— 裁剪图只有引擎手里有，所以要过一次上传。
 * 命名跟生成结果同一个目录（画布目录/项目），方便按项目清理；
 * 结尾带纳秒时间戳，避免同一节点连改两次时命中对象存储的去重缓存、
 * 拿到上一版裁剪图（那种错最阴：模型看到的是旧图，结果"改了但没变化"）。
 */
func (i *ImageExecutor) uploadElementCrop(c *elementCompositor, canvasDir, projectID string) (string, error) {
	data, contentType, err := c.cropBytes()
	if err != nil {
		return "", err
	}
	if len(data) == 0 {
		return "", errors.New("裁剪图为空")
	}
	if i.fileUploadService == nil {
		return "", errors.New("文件服务不可用")
	}
	ext := ".png"
	if contentType == "image/jpeg" {
		ext = ".jpg"
	}
	name := fmt.Sprintf("element-crop-%d%s", time.Now().UnixNano(), ext)
	result, err := i.fileUploadService.UploadFromReader(bytes.NewReader(data), int64(len(data)), name, service.UploadOptions{
		Dir:            canvasDir,
		ProjectID:      projectID,
		DefaultExt:     ext,
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		return "", err
	}
	log.Printf("[ImageExecutor] 🖌️ 元素编辑：裁剪图已上传 %s（%dx%d %d 字节）", result.URL, c.crop.Dx(), c.crop.Dy(), len(data))
	return result.URL, nil
}

// truncateForLog 只给日志用：避免把整段画布 JSON 打进日志。
// 按 rune 截断，否则会把一个多字节汉字切成半个（日志里出现乱码）
func truncateForLog(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
