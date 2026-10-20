package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os/exec"
	"sort"
	"strings"
	"time"
)

// ImageOpsService 画布图片的派生处理：宫格切分 / 尺寸放大 / 蒙版擦除。
//
// 为什么这些活放在服务端而不是浏览器里画 canvas：
//  1. 线上单张原图实测 4.3MB（4K PNG）。16 宫格若在前端做，等于拉一次 4.3MB 再上传 16 次；
//     服务端做则是拉一次、切完直接落对象存储，前端只有一次往返。
//  2. 切分产物必须顺手补一张 640px webp 缩略图——画布渲染的是 thumbUrl，
//     不补的话画布会去加载 9~16 张原图。缩略图管线本来就在服务端（thumbnail.go）。
//  3. 不依赖 CDN 的 CORS：它只回**具体 origin**（实测 `Access-Control-Allow-Origin:
//     https://manwa.yunqueai.cloud`），换域名或本地开发立刻失效。
//
// 实现分工：
//   - 裁切 / 放大 → 镜像里已有的 ffmpeg，走 stdin/stdout 管道（与 thumbnail.go 同一套路）
//   - 蒙版擦除   → Go 标准库逐像素混合。按蒙版**亮度**做 alpha 混合，蒙版边缘自带羽化，
//     既不需要 ffmpeg 的 maskedmerge（要额外 fd 传第二路输入），也不用引第三方图像库。
type ImageOpsService struct {
	upload *FileUploadService
	http   *http.Client
	// allowedHosts 允许抓取的图片域名白名单。
	//
	// 为什么必须有：这个服务会按请求里的 URL 去下载图片，等于给登录用户开了一个
	// "让服务器替我访问任意地址"的口子（SSRF）。所以只放行对象存储的公网域名
	// （从 storage 推导）+ 运维显式配置的额外域名（IMAGE_OPS_ALLOWED_HOSTS）。
	// 同时 http.Client 不跟随跳转，避免用 302 绕过白名单。
	allowedHosts map[string]bool
}

// NewImageOpsService 构造。（额外放行域名由调用方从配置读取后传入。）
func NewImageOpsService(upload *FileUploadService, extraAllowedHosts []string) *ImageOpsService {
	hosts := map[string]bool{}
	for _, h := range extraAllowedHosts {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			hosts[h] = true
		}
	}
	return &ImageOpsService{
		upload:       upload,
		allowedHosts: hosts,
		// 源图可能来自 CDN，超时给足；上限见 imageOpsMaxSourceBytes
		http: &http.Client{
			Timeout: 90 * time.Second,
			// 不跟随 302：否则可以先把请求指向白名单域名再跳去内网
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

// HostAllowed 暴露给 handler 做入参预校验（错误信息更早、更明确）
func (s *ImageOpsService) HostAllowed(rawURL string) bool {
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	return s.allowedHosts[strings.ToLower(u.Hostname())]
}

const (
	imageOpsMaxSourceBytes = 64 << 20 // 单张源图最大 64MB（线上 4K PNG 约 4.3MB，留足余量）
	imageOpsMaxTiles       = 64       // 一次切分最多 64 格（8×8），防止有人传 1000×1000
	imageOpsMinTileEdge    = 64       // 每格最小边（再小就没有使用价值，多半是参数写错了）
	imageOpsMaxTargetEdge  = 6000     // 放大目标上限，与上游模型 300~6000px 的要求对齐
)

// Tile 一个派生图片结果。URL 给节点用，ThumbURL 给画布用（可为空）。
type Tile struct {
	URL      string `json:"url"`
	ThumbURL string `json:"thumb_url"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
	// Skipped=true 表示无需处理，URL 就是入参原图（例如放大目标小于等于原尺寸）
	Skipped bool `json:"skipped,omitempty"`
	// 切分结果专用：这一格在宫格里的序号（0 起，从左到右、从上到下）与行列号。
	// 前端靠它把每张图对应回图上被选中的那个格子（否则只能按返回顺序猜）。
	CellIndex int `json:"cell_index,omitempty"`
	CellRow   int `json:"cell_row,omitempty"`
	CellCol   int `json:"cell_col,omitempty"`
}

// ========== 源图读取 ==========

// fetchImage 下载源图。只接受 http(s) 绝对地址（同源相对路径请先由前端补全）。
func (s *ImageOpsService) fetchImage(ctx context.Context, url string) ([]byte, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil, errors.New("图片地址为空")
	}
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return nil, fmt.Errorf("只支持 http(s) 图片地址: %s", url)
	}
	if !s.HostAllowed(url) {
		return nil, fmt.Errorf("图片来源域名不在白名单内: %s（如需放行，在 IMAGE_OPS_ALLOWED_HOSTS 里追加）", url)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, fmt.Errorf("构造请求失败: %w", err)
	}
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("下载图片失败: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("下载图片失败: HTTP %d", resp.StatusCode)
	}

	// 多读 1 字节：能区分"刚好等于上限"和"超了"
	data, err := io.ReadAll(io.LimitReader(resp.Body, imageOpsMaxSourceBytes+1))
	if err != nil {
		return nil, fmt.Errorf("读取图片失败: %w", err)
	}
	if len(data) > imageOpsMaxSourceBytes {
		return nil, fmt.Errorf("图片超过 %dMB，拒绝处理", imageOpsMaxSourceBytes>>20)
	}
	if len(data) == 0 {
		return nil, errors.New("图片内容为空")
	}
	return data, nil
}

// decodeConfig 只读图片头拿尺寸（不解码像素，4K 图也很快）
func decodeConfig(data []byte) (int, int, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0, fmt.Errorf("无法识别图片格式（仅支持 PNG/JPEG）: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return 0, 0, errors.New("图片尺寸异常")
	}
	return cfg.Width, cfg.Height, nil
}

// ========== ffmpeg 管道处理 ==========

// runFFmpegFilter 用 ffmpeg 做一次滤镜处理，输入输出都走管道（不落临时文件）。
// 与 thumbnail.go 的 GenerateImageThumbnail 保持一致的做法：pipe:0 → pipe:1。
func runFFmpegFilter(src []byte, filter string, codec string) ([]byte, error) {
	args := []string{
		"-hide_banner", "-loglevel", "error",
		"-i", "pipe:0",
		"-vf", filter,
		"-frames:v", "1",
	}
	switch codec {
	case "png":
		args = append(args, "-f", "image2pipe", "-vcodec", "png")
	case "mjpeg":
		// q:v 2 ≈ JPEG 质量 95，切分/放大都是有损链路里的一次中间编码，不必用 1
		args = append(args, "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "2")
	case "webp":
		args = append(args, "-f", "webp", "-q:v", "80")
	default:
		return nil, fmt.Errorf("不支持的输出编码: %s", codec)
	}
	args = append(args, "pipe:1")

	cmd := exec.Command("ffmpeg", args...)
	cmd.Stdin = bytes.NewReader(src)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return nil, fmt.Errorf("ffmpeg 处理失败: %w: %s", err, msg)
	}
	if out.Len() == 0 {
		return nil, errors.New("ffmpeg 输出为空")
	}
	return out.Bytes(), nil
}

// ToPNG 把任意 ffmpeg 认得的格式转成 PNG 字节（调用方保证 NeedsTranscode 为真时才用）。
func ToPNG(src []byte) ([]byte, error) {
	out, err := runFFmpegFilter(src, "null", "png")
	if err != nil {
		return nil, err
	}
	return out, nil
}

// decodeAny 解码任意常见图片格式：先走标准库，解不动再用 ffmpeg 转成 PNG 后解码。
//
// 为什么必须兜住：线上真实翻车过 —— 画布会给每张图配一个 .thumb.webp 缩略图，
// 用户在这些节点上点选识别，标准库只有 png/jpeg/gif，直接 "image: unknown format"，
// 识别整条链路 502（2026-10-17 13:07~13:08 连续 3 次）。容器里本来就装了 ffmpeg
// （缩略图/切分/放大都在用），它还能顺带覆盖 avif/heic/bmp/tiff，比引一个新依赖划算。
// 输入输出都走管道，不落临时文件（与 runFFmpegFilter 同一套做法）。
func DecodeImageAny(src []byte) (image.Image, error) { return decodeImageAny(src) }

// DecodeConfigAny 读图片尺寸（带 ffmpeg 兜底）。
// 元素编辑、图生图自适应都靠它量原图长宽比：标准库读不了 WebP 时以前直接判"格式不支持"，
// 用户点生成就整条失败（线上 2026-10-17 13:24 / 13:36 两次）。
func DecodeConfigAny(src []byte) (int, int, bool) {
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(src)); err == nil && cfg.Width > 0 && cfg.Height > 0 {
		return cfg.Width, cfg.Height, true
	}
	img, err := decodeImageAny(src)
	if err != nil {
		return 0, 0, false
	}
	b := img.Bounds()
	if b.Dx() <= 0 || b.Dy() <= 0 {
		return 0, 0, false
	}
	return b.Dx(), b.Dy(), true
}

// NeedsTranscode 这个格式标准库认不了吗（WebP/AVIF/HEIC…）。
// 上游只吃 URL 时用得到：认不了就先转成 PNG 再上传，别指望上游能读我们的格式。
func NeedsTranscode(src []byte) bool {
	if len(src) == 0 {
		return false
	}
	_, _, err := image.DecodeConfig(bytes.NewReader(src))
	return err != nil
}

func decodeImageAny(src []byte) (image.Image, error) {
	img, _, err := image.Decode(bytes.NewReader(src))
	if err == nil {
		return img, nil
	}
	firstErr := err

	pngData, ferr := runFFmpegFilter(src, "null", "png")
	if ferr != nil {
		return nil, fmt.Errorf("解码图片失败（标准库: %v；ffmpeg: %v）", firstErr, ferr)
	}
	converted, _, cerr := image.Decode(bytes.NewReader(pngData))
	if cerr != nil {
		return nil, fmt.Errorf("解码图片失败（标准库: %v；ffmpeg 转码后仍无法解码: %v）", firstErr, cerr)
	}
	log.Printf("[ImageOps] 标准库解不出的图片已用 ffmpeg 转码解码成功（源 %d 字节 → PNG %d 字节）", len(src), len(pngData))
	return converted, nil
}

// codecForSource 按源图格式选输出编码：PNG 保持无损，JPEG 继续用 JPEG。
// 不做 alpha 探测——源图是什么链路就延续什么链路，避免把 PNG 素材悄悄变成有损。
func codecForSource(data []byte) string {
	_, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err == nil && format == "jpeg" {
		return "mjpeg"
	}
	return "png"
}

// ========== 落存储 ==========

// saveDerived 保存派生图片并生成缩略图。filename 只用于取扩展名（存储名是内容哈希）。
func (s *ImageOpsService) saveDerived(data []byte, filename string, opts UploadOptions) (*Tile, error) {
	result, err := s.upload.UploadFromReader(bytes.NewReader(data), int64(len(data)), filename, opts)
	if err != nil {
		return nil, fmt.Errorf("保存派生图片失败: %w", err)
	}

	width, height, _ := decodeConfig(data) // 失败不阻断：宽高回 0，前端会退回原图实测

	tile := &Tile{URL: result.URL, Width: width, Height: height}

	// 缩略图失败不阻断主流程（与 UploadImage 的策略一致）
	if thumb, terr := GenerateImageThumbnail(data); terr == nil {
		thumbObject := ThumbnailObjectName(result.ObjectName)
		if perr := s.upload.PutBytes(thumbObject, thumb, "image/webp"); perr == nil {
			tile.ThumbURL = s.upload.ObjectURL(thumbObject)
		}
	}
	return tile, nil
}

// ========== 宫格切分 ==========

// Split 把一张宫格图切成 rows×cols 张单图。
//
// trimPx 是**每格四边各内缩的像素数**：宫格图里格与格之间那条缝隙会落在每格边缘，
// 不内缩就会带着邻格的边。视图模板现在要求"只留极窄的浅灰间隙、不要画白色分割线"，
// 但模型画出来的往往仍是一道接近白的细缝（宽度也不严格），所以这个值必须用户可调
// （前端给了滑杆与预览），不能写死成 0。
// SplitRect 一格的裁切区域（像素坐标，已含内缩）
type SplitRect struct {
	Row, Col int
	X, Y     int
	W, H     int
}

// cutsMinGap 相邻切割线的最小间距（归一化）。比这更近的一刀没有意义，
// 还会切出几像素宽的碎条，直接把后一刀丢掉。
const cutsMinGap = 0.02

// normalizeCuts 清洗切割位置：限制在 (0,1)，升序排列，去掉与前一刀过近的。
// 返回空表示"没有有效切割线"，调用方回退到等分。
func normalizeCuts(cuts []float64) []float64 {
	if len(cuts) == 0 {
		return nil
	}
	sorted := make([]float64, 0, len(cuts))
	for _, c := range cuts {
		if c <= cutsMinGap || c >= 1-cutsMinGap {
			continue
		}
		sorted = append(sorted, c)
	}
	sort.Float64s(sorted)

	out := make([]float64, 0, len(sorted))
	for _, c := range sorted {
		if len(out) > 0 && c-out[len(out)-1] < cutsMinGap {
			continue
		}
		out = append(out, c)
	}
	return out
}

// boundaries 把切割线转成 [0, c1, c2 …, 1] 的边界列表
func boundaries(cuts []float64) []float64 {
	b := make([]float64, 0, len(cuts)+2)
	b = append(b, 0)
	b = append(b, cuts...)
	b = append(b, 1)
	return b
}

// computeSplitRects 计算每格裁切区域（行优先，顺序与前端摆节点一致）。
//
// cutsX/cutsY 是**归一化切割位置**（0~1），来自弹层里用户拖动的那几条分割线；
// 传空则等分。有切割线时以切割线条数为准（列数 = len(cutsX)+1），
// 这样前端只要拖了线就不必再同步行列数，少一处可能对不上的状态。
//
// 内缩 trimPx 在这里统一施加：每格四边各内缩，用来吃掉宫格之间那道浅灰/发白的缝隙。
func computeSplitRects(width, height, rows, cols int, cutsX, cutsY []float64, trimPx int) ([]SplitRect, error) {
	if trimPx < 0 {
		trimPx = 0
	}
	nx := normalizeCuts(cutsX)
	ny := normalizeCuts(cutsY)
	if len(nx) > 0 {
		cols = len(nx) + 1
	}
	if len(ny) > 0 {
		rows = len(ny) + 1
	}
	if rows < 1 || cols < 1 {
		return nil, errors.New("切分行列数必须大于 0")
	}
	if rows > 8 || cols > 8 || rows*cols > imageOpsMaxTiles {
		return nil, fmt.Errorf("一次最多切 8×8 共 %d 格（当前 %d 行 × %d 列）", imageOpsMaxTiles, rows, cols)
	}

	// 没有自定义切割线的方向按行列等分。注意必须补出内部边界：
	// boundaries() 只负责首尾补 0/1，没有内部切割线时它会返回 [0,1]，
	// 后面按下标取 xs[c+1] 就会越界。
	if len(nx) == 0 {
		for i := 1; i < cols; i++ {
			nx = append(nx, float64(i)/float64(cols))
		}
	}
	if len(ny) == 0 {
		for i := 1; i < rows; i++ {
			ny = append(ny, float64(i)/float64(rows))
		}
	}

	xs := boundaries(nx)
	ys := boundaries(ny)

	rects := make([]SplitRect, 0, rows*cols)
	for r := 0; r < rows; r++ {
		y0 := int(math.Round(ys[r] * float64(height)))
		y1 := int(math.Round(ys[r+1] * float64(height)))
		for c := 0; c < cols; c++ {
			x0 := int(math.Round(xs[c] * float64(width)))
			x1 := int(math.Round(xs[c+1] * float64(width)))

			w := (x1 - x0) - 2*trimPx
			h := (y1 - y0) - 2*trimPx
			if w < imageOpsMinTileEdge || h < imageOpsMinTileEdge {
				return nil, fmt.Errorf(
					"第 %d 行第 %d 列切出来只有 %d×%d 像素，小于 %d 的下限：请减少行列数、减小内缩，或把这几条分割线拖开一点（原图 %d×%d）",
					r+1, c+1, w, h, imageOpsMinTileEdge, width, height)
			}
			rects = append(rects, SplitRect{
				Row: r, Col: c,
				X: x0 + trimPx, Y: y0 + trimPx,
				W: w, H: h,
			})
		}
	}
	return rects, nil
}

// splitCellTarget 一格的目标产物：裁剪矩形 + 它在宫格里的序号。
//
// 单独抽成纯函数是为了能直接测"选了哪几格"的算法 —— 走 ffmpeg 的路径没法在单测里跑（需要存储）。
type splitCellTarget struct {
	Index int
	Rect  SplitRect
}

// splitCellTargets 从所有格子里挑出要切的那几格。
//
// cells 是格号（0 起，从左到右、从上到下），空表示全切；越界的格号直接忽略。
// 这里刻意不做任何放大：**"高清"一律走图像模型重生成**（前端会为每格建一个
// 以该格为参考的 4K 节点并扣积分），本机只负责裁准。
// 曾经在这里做过 lanczos 插值放大，但那样"高清"就有了两个含义（免费插值 vs 模型补细节），
// 同一个按钮位置出现两种语义最容易误导用户，所以去掉了。
func splitCellTargets(rects []SplitRect, cells []int) []splitCellTarget {
	wanted := make(map[int]bool, len(cells))
	for _, c := range cells {
		wanted[c] = true
	}

	out := make([]splitCellTarget, 0, len(rects))
	for i, rect := range rects {
		if len(wanted) > 0 && !wanted[i] {
			continue
		}
		out = append(out, splitCellTarget{Index: i, Rect: rect})
	}
	return out
}

// Split 把一张宫格图切成 rows×cols 张单图。
//
// trimPx 是**每格四边各内缩的像素数**：宫格图里格与格之间那条缝隙会落在每格边缘，
// 不内缩就会带着邻格的边。视图模板现在要求"只留极窄的浅灰间隙、不要画白色分割线"，
// 但模型画出来的往往仍是一道接近白的细缝（宽度也不严格），所以这个值必须用户可调
// （前端给了滑杆与预览），不能写死成 0。
// SplitRect 一格的裁切区域（像素坐标，已含内缩）
// cells 只切选中的几格（空=全切）。这里只裁不放大："高清"由前端为每格提交一次
// 图像模型 4K 重生成（扣积分、会补细节），本机不拿插值冒充。
func (s *ImageOpsService) Split(ctx context.Context, srcURL string, rows, cols int, cutsX, cutsY []float64, trimPx int, cells []int, opts UploadOptions) ([]Tile, error) {
	src, err := s.fetchImage(ctx, srcURL)
	if err != nil {
		return nil, err
	}
	width, height, err := decodeConfig(src)
	if err != nil {
		return nil, err
	}

	rects, err := computeSplitRects(width, height, rows, cols, cutsX, cutsY, trimPx)
	if err != nil {
		return nil, err
	}
	targets := splitCellTargets(rects, cells)
	if len(targets) == 0 {
		return nil, fmt.Errorf("没有选中任何宫格")
	}

	codec := codecForSource(src)
	ext := ".png"
	if codec == "mjpeg" {
		ext = ".jpg"
	}

	tiles := make([]Tile, 0, len(targets))
	for _, t := range targets {
		rect := t.Rect
		filter := fmt.Sprintf("crop=%d:%d:%d:%d", rect.W, rect.H, rect.X, rect.Y)
		out, ferr := runFFmpegFilter(src, filter, codec)
		if ferr != nil {
			return nil, fmt.Errorf("切第 %d 行第 %d 列失败: %w", rect.Row+1, rect.Col+1, ferr)
		}

		tile, serr := s.saveDerived(out, fmt.Sprintf("split-r%dc%d%s", rect.Row+1, rect.Col+1, ext), opts)
		if serr != nil {
			return nil, serr
		}
		// 尺寸已由 computeSplitRects 算出，省一次解码
		tile.Width, tile.Height = rect.W, rect.H
		tile.CellIndex = t.Index
		tile.CellRow, tile.CellCol = rect.Row, rect.Col
		tiles = append(tiles, *tile)
	}
	return tiles, nil
}

// ========== 给视觉模型看的缩略图 ==========

/**
 * FetchForVision 取原图并缩成"给视觉模型看的小图"（长边 ≤ maxEdge），返回 JPEG 字节。
 *
 * 为什么要缩（实测，2026-10-17 线上 4K 场景四视图）：
 *   4K 原图（3840×2160）直传上游 → prompt_tokens=8135，点选识别要 59s；
 *   缩到长边 1024 → prompt_tokens=905，识别 16s，结论完全一致（同一个物体、框差 1~2 个百分点）。
 * 识别结果里的外接框是**归一化坐标**，与图片分辨率无关，所以缩图不影响精度。
 * 另外这里由我们取图再传 base64，省掉上游自己去公网拉图的等待。
 */
func (s *ImageOpsService) FetchForVision(ctx context.Context, url string, maxEdge int) ([]byte, error) {
	if maxEdge < 256 {
		maxEdge = 1024
	}
	src, err := s.fetchImage(ctx, url)
	if err != nil {
		return nil, err
	}
	img, err := decodeImageAny(src)
	if err != nil {
		return nil, err
	}
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("图片尺寸异常")
	}
	long := w
	if h > long {
		long = h
	}
	if long > maxEdge {
		scale := float64(maxEdge) / float64(long)
		nw, nh := int(float64(w)*scale+0.5), int(float64(h)*scale+0.5)
		if nw < 1 {
			nw = 1
		}
		if nh < 1 {
			nh = 1
		}
		img = resampleToSize(img, nw, nh)
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 88}); err != nil {
		return nil, fmt.Errorf("编码缩略图失败: %w", err)
	}
	return buf.Bytes(), nil
}

// ========== 尺寸放大 ==========

// Scale 按短边放大图片（lanczos）。用途有两个：
//  1. 素材尺寸不足被上游拒收（实测有 280×125 的图触发 InvalidParameter.WidthTooSmall）
//  2. 用户想把小图铺满更大的节点
//
// 只放大、不缩小：目标短边小于等于原尺寸时直接返回原图（Skipped=true），
// 避免"点了画质提升反而变糊"。
func (s *ImageOpsService) Scale(ctx context.Context, srcURL string, targetShort int, opts UploadOptions) (*Tile, error) {
	if targetShort < imageOpsMinTileEdge || targetShort > imageOpsMaxTargetEdge {
		return nil, fmt.Errorf("放大目标短边需在 %d~%d 之间", imageOpsMinTileEdge, imageOpsMaxTargetEdge)
	}

	src, err := s.fetchImage(ctx, srcURL)
	if err != nil {
		return nil, err
	}
	width, height, err := decodeConfig(src)
	if err != nil {
		return nil, err
	}

	short := width
	if height < short {
		short = height
	}
	if short >= targetShort {
		return &Tile{URL: srcURL, Width: width, Height: height, Skipped: true}, nil
	}

	// 等比缩放到目标短边，且宽高都取偶数（部分编码器对奇数尺寸会加黑边）
	scale := float64(targetShort) / float64(short)
	tw := int(float64(width)*scale + 0.5)
	th := int(float64(height)*scale + 0.5)
	tw += tw % 2
	th += th % 2

	codec := codecForSource(src)
	ext := ".png"
	if codec == "mjpeg" {
		ext = ".jpg"
	}

	out, err := runFFmpegFilter(src, fmt.Sprintf("scale=%d:%d:flags=lanczos", tw, th), codec)
	if err != nil {
		return nil, err
	}
	tile, err := s.saveDerived(out, "scaled"+ext, opts)
	if err != nil {
		return nil, err
	}
	tile.Width, tile.Height = tw, th
	return tile, nil
}

// ========== 蒙版擦除 ==========

// EraseMode 擦除方式
const (
	EraseBlur   = "blur"   // 高斯近似（盒式模糊），适合去杂物/去轻微水印
	EraseMosaic = "mosaic" // 马赛克，适合打码
	EraseSolid  = "solid"  // 用蒙版区域的平均色填充，适合去纯色背景上的元素
)

// Erase 按蒙版擦除：蒙版里**白色（亮度高）的区域**被处理，黑色区域原样保留。
//
// 关键设计：混合系数直接用蒙版**亮度**，所以画笔边缘画成半透明就等于自动羽化，
// 不会在擦除区边缘留下硬边。strength 是模糊半径 / 马赛克块大小。
func (s *ImageOpsService) Erase(ctx context.Context, srcURL, maskURL, mode string, strength int, opts UploadOptions) (*Tile, error) {
	switch mode {
	case EraseBlur, EraseMosaic, EraseSolid:
	default:
		return nil, fmt.Errorf("不支持的擦除方式: %s", mode)
	}
	if strength <= 0 {
		strength = 16
	}
	if strength > 200 {
		strength = 200
	}

	srcData, err := s.fetchImage(ctx, srcURL)
	if err != nil {
		return nil, err
	}
	maskData, err := s.fetchImage(ctx, maskURL)
	if err != nil {
		return nil, err
	}

	srcImg, err := decodeImageAny(srcData)
	if err != nil {
		return nil, fmt.Errorf("解码原图失败（标准库与 ffmpeg 都读不了这个文件）: %w", err)
	}
	maskImg, err := decodeImageAny(maskData)
	if err != nil {
		return nil, fmt.Errorf("解码蒙版失败（蒙版必须是 PNG）: %w", err)
	}

	bounds := srcImg.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	maskAt := maskSampler(maskImg, w, h)

	// 先把原图归一化成 RGBA，后面所有处理都在这个副本上做
	srcRGBA := normalizeToRGBA(srcImg, w, h)

	// 处理图层：模糊 / 马赛克 / 纯色。只在需要时构建，避免无谓开销。
	var processed *image.RGBA
	switch mode {
	case EraseBlur:
		processed = boxBlurRGBA(srcRGBA, strength)
	case EraseMosaic:
		processed = mosaicRGBA(srcRGBA, strength)
	case EraseSolid:
		processed = solidRGBA(srcRGBA, maskAt, w, h)
	}

	out := blendWithMask(srcRGBA, processed, maskAt, w, h)

	codec := codecForSource(srcData)
	ext := ".png"
	var buf bytes.Buffer
	if codec == "mjpeg" {
		ext = ".jpg"
		if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 95}); err != nil {
			return nil, fmt.Errorf("编码 JPEG 失败: %w", err)
		}
	} else {
		if err := png.Encode(&buf, out); err != nil {
			return nil, fmt.Errorf("编码 PNG 失败: %w", err)
		}
	}
	tile, err := s.saveDerived(buf.Bytes(), "erased"+ext, opts)
	if err != nil {
		return nil, err
	}
	tile.Width, tile.Height = w, h
	return tile, nil
}

// blendWithMask 按蒙版**亮度**把 processed 混合到 src 上：out = src*(1-a) + proc*a。
//
// 亮度直接当 alpha 用，是这套擦除唯一需要的"聪明"之处：用户用软边画笔涂抹时，
// 边缘像素的蒙版亮度天然从 255 过渡到 0，于是擦除区不会出现硬邦邦的边界，
// 不需要额外做蒙版模糊，也不需要 ffmpeg 的 maskedmerge（那要额外 fd 传第二路输入）。
func blendWithMask(src, processed *image.RGBA, maskAt func(int, int) uint8, w, h int) *image.RGBA {
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			a := uint32(maskAt(x, y))
			if a == 0 {
				out.Set(x, y, src.At(x, y))
				continue
			}
			sr, sg, sb, _ := src.At(x, y).RGBA()
			pr, pg, pb, _ := processed.At(x, y).RGBA()
			blend := func(sv, pv uint32) uint8 {
				return uint8((sv*(255-a) + pv*a) / 255 >> 8)
			}
			out.Set(x, y, color.RGBA{R: blend(sr, pr), G: blend(sg, pg), B: blend(sb, pb), A: 255})
		}
	}
	return out
}

// maskSampler 把蒙版按**最近邻**对齐到目标尺寸，返回 (x,y) → 亮度（0~255）。
// 蒙版通常与原图同尺寸，但前端按缩略图比例导出时可能有 1~2 像素出入，这里兜住。
func maskSampler(maskImg image.Image, w, h int) func(int, int) uint8 {
	maskBounds := maskImg.Bounds()
	mw, mh := maskBounds.Dx(), maskBounds.Dy()
	if mw <= 0 || mh <= 0 {
		return func(int, int) uint8 { return 0 }
	}
	return func(x, y int) uint8 {
		mx := maskBounds.Min.X + x*mw/w
		my := maskBounds.Min.Y + y*mh/h
		if mx >= maskBounds.Max.X {
			mx = maskBounds.Max.X - 1
		}
		if my >= maskBounds.Max.Y {
			my = maskBounds.Max.Y - 1
		}
		// 用 RGBA() 的亮度（蒙版是黑白图，取 R 即可）
		r, _, _, a := maskImg.At(mx, my).RGBA()
		if a == 0 {
			return 0
		}
		return uint8(r >> 8)
	}
}

// normalizeToRGBA 把任意解码结果搬进 (0,0,w,h) 的 RGBA 副本，后续处理都在副本上做
func normalizeToRGBA(src image.Image, w, h int) *image.RGBA {
	bounds := src.Bounds()
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out.Set(x, y, src.At(bounds.Min.X+x, bounds.Min.Y+y))
		}
	}
	return out
}

// resampleToSize 双线性缩放到指定尺寸（尺寸相同就直接搬一份）。
//
// 为什么不用 ffmpeg：这条链路跑在执行器里，"生成结果贴回原图"不该因为镜像里
// ffmpeg 缺失/版本差异而失败；纯 Go 也能直接单测（ffmpeg 路径在单测里跑不了）。
func resampleToSize(src image.Image, w, h int) *image.RGBA {
	bounds := src.Bounds()
	sw, sh := bounds.Dx(), bounds.Dy()
	if sw == w && sh == h {
		return normalizeToRGBA(src, w, h)
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	if sw <= 0 || sh <= 0 {
		return out
	}
	// 像素中心对齐：目标像素 (x,y) 映射到源坐标 ((x+0.5)*sw/w-0.5, …)
	for y := 0; y < h; y++ {
		sy := (float64(y)+0.5)*float64(sh)/float64(h) - 0.5
		if sy < 0 {
			sy = 0
		}
		y0 := int(sy)
		if y0 > sh-1 {
			y0 = sh - 1
		}
		y1 := y0 + 1
		if y1 > sh-1 {
			y1 = sh - 1
		}
		fy := sy - float64(y0)
		for x := 0; x < w; x++ {
			sx := (float64(x)+0.5)*float64(sw)/float64(w) - 0.5
			if sx < 0 {
				sx = 0
			}
			x0 := int(sx)
			if x0 > sw-1 {
				x0 = sw - 1
			}
			x1 := x0 + 1
			if x1 > sw-1 {
				x1 = sw - 1
			}
			fx := sx - float64(x0)

			r00, g00, b00, _ := src.At(bounds.Min.X+x0, bounds.Min.Y+y0).RGBA()
			r10, g10, b10, _ := src.At(bounds.Min.X+x1, bounds.Min.Y+y0).RGBA()
			r01, g01, b01, _ := src.At(bounds.Min.X+x0, bounds.Min.Y+y1).RGBA()
			r11, g11, b11, _ := src.At(bounds.Min.X+x1, bounds.Min.Y+y1).RGBA()

			mix := func(v00, v10, v01, v11 uint32) uint8 {
				top := float64(v00)*(1-fx) + float64(v10)*fx
				bottom := float64(v01)*(1-fx) + float64(v11)*fx
				return uint8((top*(1-fy) + bottom*fy) / 257)
			}
			out.SetRGBA(x, y, color.RGBA{
				R: mix(r00, r10, r01, r11),
				G: mix(g00, g10, g01, g11),
				B: mix(b00, b10, b01, b11),
				A: 255,
			})
		}
	}
	return out
}

// featherMask 把蒙版亮度做一次可分离盒式模糊，让合成边界有过渡。
//
// 为什么必须羽化：元素编辑的选区是用户框/点出来的**硬边**（矩形、圆），
// 直接把模型结果按硬边贴回去，选区四周会出现一条肉眼可见的接缝
// （生成图的亮度/色调和原图不可能逐像素对齐）。擦除不需要这一步是因为
// 涂抹笔迹自带软边（亮度过渡），而框选没有。
func featherMask(at func(int, int) uint8, w, h, radius int) func(int, int) uint8 {
	if radius < 1 {
		return at
	}
	buf := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			buf[y*w+x] = at(x, y)
		}
	}
	tmp := make([]uint8, w*h)
	// 横向
	for y := 0; y < h; y++ {
		row := y * w
		for x := 0; x < w; x++ {
			sum, n := 0, 0
			for k := x - radius; k <= x+radius; k++ {
				if k < 0 || k >= w {
					continue
				}
				sum += int(buf[row+k])
				n++
			}
			if n == 0 {
				n = 1
			}
			tmp[row+x] = uint8(sum / n)
		}
	}
	// 纵向
	out := make([]uint8, w*h)
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			sum, n := 0, 0
			for k := y - radius; k <= y+radius; k++ {
				if k < 0 || k >= h {
					continue
				}
				sum += int(tmp[k*w+x])
				n++
			}
			if n == 0 {
				n = 1
			}
			out[y*w+x] = uint8(sum / n)
		}
	}
	return func(x, y int) uint8 { return out[y*w+x] }
}

// CompositeThroughMask 把模型重新生成的整图**按蒙版贴回原图**，这是"元素编辑"的收尾工序。
//
// 上游图像接口只有 /images/generations（model/prompt/size/n/image），**没有蒙版入参**
// （见 llm/image.go：连 guidance_scale 都会被网关 400 掉），所以"只改选区"这件事
// 只能由我们自己保证：让模型基于原图整图重画一遍（它照要求改的就是选区里那个元素），
// 再把结果**只在蒙版覆盖处**贴回来 —— 选区外的像素始终是原图字节，改动被物理限制在选区里。
//
// 三处细节：
//  1. 生成图与原图尺寸可能不同（上游按 data.resolution/aspectRatio 出图，原图可能是 4K），
//     这里把生成图缩放到原图尺寸再贴，保证"选框 ↔ 贴回位置"对得上；
//  2. 蒙版亮度当 alpha（与 Erase 同一套），并额外羽化，避免硬边接缝；
//  3. 输出编码跟随原图（PNG 保持无损 / JPEG 继续 JPEG），原图是什么链路就延续什么链路。
func CompositeThroughMask(baseData, generatedData, maskData []byte) ([]byte, error) {
	return CompositeElementEdit(baseData, generatedData, maskData, image.Rectangle{}, 0)
}

/**
 * CompositeElementEdit 元素编辑的合成入口。
 *
 * crop 为空表示模型看到的是整张原图；非空表示模型只看到了 crop 那一块（见 engine 的 elementCropRect）。
 * featherRadius <= 0 时按图宽自动取（w/250）。
 *
 * 不论哪条路，这里都会做一次**色调对齐**（matchPatchLevels）：模型重画的那块与周边原图
 * 差着几个到十几个灰阶，不校正的话贴回去边界上就能看出"贴了一块"。
 */
func CompositeElementEdit(baseData, generatedData, maskData []byte, crop image.Rectangle, featherRadius int) ([]byte, error) {
	return compositeThroughMask(baseData, generatedData, maskData, crop, featherRadius)
}

/**
 * CompositeCropThroughMask 与 CompositeThroughMask 相同，但模型只看到了原图的一块 crop 区域：
 * 生成结果是"裁剪图"的重绘，先把它缩放到 crop 的像素尺寸、贴回原图的 crop 位置，
 * 再按蒙版混合 —— 选区内的像素因此来自"模型看过上下文之后画的那一块"，而不是一张另画的整图。
 *
 * 为什么需要它：上游接口没有蒙版入参，喂整张图时模型会把整张图重画一遍，
 * 我们从重画结果里抠出选区，抠到的是"另一次重绘的碎片"（内容与周边对不上、也没按要求改），
 * 线上用户反馈的"整个图重新生成了 / 局部修改没生效"就是这么来的。
 */
func CompositeCropThroughMask(baseData, generatedData, maskData []byte, crop image.Rectangle) ([]byte, error) {
	if crop.Empty() {
		return nil, errors.New("裁剪区域为空")
	}
	return compositeThroughMask(baseData, generatedData, maskData, crop, 0)
}

// MaskBounds 蒙版里"允许改"的区域（亮部）外接框。没有选区时返回空矩形。
// 供元素编辑决定"把哪一块裁出来当参考图"，也用它的空值挡住"没框到任何东西就开生成"。
func MaskBounds(maskData []byte) (image.Rectangle, error) {
	maskImg, err := decodeImageAny(maskData)
	if err != nil {
		return image.Rectangle{}, fmt.Errorf("解码蒙版失败（蒙版必须是 PNG）: %w", err)
	}
	b := maskImg.Bounds()
	return brightBounds(maskImg, b.Dx(), b.Dy()), nil
}

// MaskUnionRect 把蒙版里某块矩形也标成"允许改"（亮），返回新的 PNG 字节。
//
// 移动模式用得到：改动区域是**两块**（原位置补背景 + 新位置画上物体）。前端会把落点
// 也画进蒙版，但"能不能贴上"不该依赖前端画得准不准 —— 这里兜一道，
// 落点框一定在允许改的范围内，否则模型搬过去的物体贴不回原图（改了等于没改）。
func MaskUnionRect(maskData []byte, rect image.Rectangle) ([]byte, error) {
	if rect.Empty() {
		return maskData, nil
	}
	img, err := decodeImageAny(maskData)
	if err != nil {
		return nil, fmt.Errorf("解码蒙版失败（蒙版必须是 PNG）: %w", err)
	}
	b := img.Bounds()
	rgba := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
	draw.Draw(rgba, rgba.Bounds(), img, b.Min, draw.Src)
	r := rect.Intersect(rgba.Bounds())
	if r.Empty() {
		return maskData, nil
	}
	draw.Draw(rgba, r, image.NewUniform(color.White), image.Point{}, draw.Src)
	var buf bytes.Buffer
	if err := png.Encode(&buf, rgba); err != nil {
		return nil, fmt.Errorf("重新编码蒙版失败: %w", err)
	}
	return buf.Bytes(), nil
}

// compositeThroughMask 解码 → 合成（可选裁剪 + 色调对齐）→ 按原图格式编码。
func compositeThroughMask(baseData, generatedData, maskData []byte, crop image.Rectangle, featherRadius int) ([]byte, error) {
	baseImg, err := decodeImageAny(baseData)
	if err != nil {
		return nil, fmt.Errorf("解码原图失败（标准库与 ffmpeg 都读不了这个文件）: %w", err)
	}
	genImg, err := decodeImageAny(generatedData)
	if err != nil {
		return nil, fmt.Errorf("解码生成图失败: %w", err)
	}
	maskImg, err := decodeImageAny(maskData)
	if err != nil {
		return nil, fmt.Errorf("解码蒙版失败（蒙版必须是 PNG）: %w", err)
	}

	w := baseImg.Bounds().Dx()
	// 羽化半径按图宽取千分之四（4K 图约 16px、1080p 约 8px），
	// 足够吃掉接缝，又不会把改动糊到选区外很远。
	if featherRadius <= 0 {
		featherRadius = w / 250
	}
	var out *image.RGBA
	if crop.Empty() {
		out, err = compositeImages(baseImg, genImg, maskImg, featherRadius)
	} else {
		out, err = compositeCropImages(baseImg, genImg, maskImg, crop, featherRadius)
	}
	if err != nil {
		return nil, err
	}

	var buf bytes.Buffer
	if codecForSource(baseData) == "mjpeg" {
		if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 95}); err != nil {
			return nil, fmt.Errorf("编码 JPEG 失败: %w", err)
		}
	} else {
		if err := png.Encode(&buf, out); err != nil {
			return nil, fmt.Errorf("编码 PNG 失败: %w", err)
		}
	}
	return buf.Bytes(), nil
}

// compositeImages 纯像素部分：把 over 按 mask 混合到 base 上（尺寸对齐 + 羽化）。
// 单独抽出来是为了能直接单测（编码/下载/上传都是外围胶水）。
func compositeImages(baseImg, overImg, maskImg image.Image, featherRadius int) (*image.RGBA, error) {
	baseBounds := baseImg.Bounds()
	w, h := baseBounds.Dx(), baseBounds.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("原图尺寸异常")
	}
	baseRGBA := normalizeToRGBA(baseImg, w, h)
	overRGBA := resampleToSize(overImg, w, h)
	matchPatchLevels(baseRGBA, overRGBA, maskImg, w, h, image.Rectangle{})
	at := featherMask(maskSampler(maskImg, w, h), w, h, featherRadius)
	return blendWithMask(baseRGBA, overRGBA, at, w, h), nil
}

/**
 * matchPatchLevels 把"模型画的那块"整体校正到周边原图的色调/明暗水平。
 *
 * 为什么必须做：模型重画出来的那块，与它紧邻的原图像素常常差几个到十几个灰阶
 * （线上实测一次：平均**暗 12~16 个灰阶**）—— 贴回去在边界上就看得出"贴了一块"，
 * 用户的原话是"你这样贴回去，不能和原图很好融合"。
 *
 * 校正量取**同一圈像素**在原图与模型结果里的均值之比：同一批像素的内容相同，
 * 所以比出来的差异是"渲染差异"，而不是"那块本来就该更暗/更亮"（后者不能被抹掉，
 * 否则"把这里涂黑"这类要求会被自动拉回原亮度）。
 * 比率太小/太大（内容与周边完全不是一回事）时夹到 ±14% 以内，避免把结果拉花。
 */
func matchPatchLevels(baseRGBA, patch *image.RGBA, maskImg image.Image, w, h int, crop image.Rectangle) {
	sel := brightBounds(maskImg, w, h)
	if sel.Empty() {
		return
	}
	// 环带宽度按选区大小取（选区越大，渲染差异的尺度也越大）
	band := sel.Dx()
	if sel.Dy() < band {
		band = sel.Dy()
	}
	band /= 8
	if band < 4 {
		band = 4
	}
	if band > 40 {
		band = 40
	}
	ring := sel.Inset(-band)
	if !crop.Empty() {
		// 只有模型真的画过的地方才比得出渲染差异：裁剪框外是原图像素（比了必然相等）
		ring = ring.Intersect(crop)
	}
	ring = ring.Intersect(image.Rect(0, 0, w, h))
	if ring.Empty() {
		return
	}

	var bR, bG, bB, pR, pG, pB, n float64
	for y := ring.Min.Y; y < ring.Max.Y; y++ {
		for x := ring.Min.X; x < ring.Max.X; x++ {
			// 选区内部不比：那里正是模型该改动的地方，内容本来就会不同
			if x >= sel.Min.X && x < sel.Max.X && y >= sel.Min.Y && y < sel.Max.Y {
				continue
			}
			b := baseRGBA.RGBAAt(x, y)
			q := patch.RGBAAt(x, y)
			bR += float64(b.R)
			bG += float64(b.G)
			bB += float64(b.B)
			pR += float64(q.R)
			pG += float64(q.G)
			pB += float64(q.B)
			n++
		}
	}
	// 环带太小（选区几乎顶到图边）就不校正：宁可不做，也不要按几十个像素乱拉色
	if n < 200 {
		return
	}
	rawR, rawG, rawB := bR/pR, bG/pG, bB/pB
	// 差异过大说明"模型画的那块和周边根本不是同一个东西"（比如用户就是要它变成纯黑/纯白，
	// 或者模型完全跑偏）—— 这种时候硬把亮度拉回原水平只会把结果弄坏，直接不校正。
	if !gainInRange(rawR) || !gainInRange(rawG) || !gainInRange(rawB) {
		log.Printf("[ImageOps] 元素编辑色调对齐跳过（内容差异过大）: 原始比率=(%.3f, %.3f, %.3f)", rawR, rawG, rawB)
		return
	}
	gR, gG, gB := clampGain(rawR), clampGain(rawG), clampGain(rawB)
	if math.Abs(gR-1) < 0.02 && math.Abs(gG-1) < 0.02 && math.Abs(gB-1) < 0.02 {
		return // 已经对得上，别动像素（也保证"模型结果本来就是对的"这种用例逐像素可比）
	}

	area := image.Rect(0, 0, w, h)
	if !crop.Empty() {
		area = crop.Intersect(image.Rect(0, 0, w, h))
	}
	for y := area.Min.Y; y < area.Max.Y; y++ {
		for x := area.Min.X; x < area.Max.X; x++ {
			c := patch.RGBAAt(x, y)
			c.R = applyGain(c.R, gR)
			c.G = applyGain(c.G, gG)
			c.B = applyGain(c.B, gB)
			patch.SetRGBA(x, y, c)
		}
	}
	log.Printf("[ImageOps] 元素编辑色调对齐: 环带像素=%d 增益=(%.3f, %.3f, %.3f)", int(n), gR, gG, gB)
}

// gainInRange 原始比率先过这一关：超出 [0.8, 1.25] 说明两边不是一回事，不校正。
// 线上实测的渲染差异在 ±10% 量级，留出这个范围足够用，又不会在异常情况下把图拉坏。
func gainInRange(g float64) bool {
	if math.IsNaN(g) || math.IsInf(g, 0) {
		return false
	}
	return g >= 0.8 && g <= 1.25
}

// clampGain 把要应用的比率夹在 ±14% 内（真实渲染差异不至于超过它）
func clampGain(g float64) float64 {
	if g < 0.86 {
		return 0.86
	}
	if g > 1.14 {
		return 1.14
	}
	return g
}

func applyGain(v uint8, g float64) uint8 {
	x := float64(v) * g
	if x < 0 {
		return 0
	}
	if x > 255 {
		return 255
	}
	return uint8(math.Round(x))
}

// brightBounds 蒙版亮部（= 选区）的外接框。蒙版尺寸可能与原图不同，按原图尺寸换算。
func brightBounds(maskImg image.Image, w, h int) image.Rectangle {
	mb := maskImg.Bounds()
	mw, mh := mb.Dx(), mb.Dy()
	minX, minY, maxX, maxY := mb.Max.X, mb.Max.Y, mb.Min.X-1, mb.Min.Y-1
	for y := mb.Min.Y; y < mb.Max.Y; y++ {
		for x := mb.Min.X; x < mb.Max.X; x++ {
			r, g, b, a := maskImg.At(x, y).RGBA()
			// 与 maskSampler 同一口径：透明像素不算选区（蒙版是前端渲染的 PNG，正常全不透明）
			if a == 0 || lumOf(r>>8, g>>8, b>>8) <= 128 {
				continue
			}
			if x < minX {
				minX = x
			}
			if y < minY {
				minY = y
			}
			if x > maxX {
				maxX = x
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	if maxX < minX || maxY < minY {
		return image.Rectangle{}
	}
	sel := image.Rect(minX, minY, maxX+1, maxY+1)
	if mw > 0 && mh > 0 && (mw != w || mh != h) {
		sel = image.Rect(sel.Min.X*w/mw, sel.Min.Y*h/mh, sel.Max.X*w/mw, sel.Max.Y*h/mh)
	}
	return sel
}

// lumOf 亮度（与 maskSampler 同一套权重，避免"哪个是亮部"出现两套口径）
func lumOf(r, g, b uint32) uint32 {
	return r*299/1000 + g*587/1000 + b*114/1000
}

// compositeCropImages 纯像素部分：模型结果是 crop 那一块的重绘 —— 先把它摆回原图的 crop 位置，
// 再按蒙版混合。crop 会先与原图求交：裁剪框来自蒙版推算，越界会让 draw.Draw 静默什么都不画。
func compositeCropImages(baseImg, overImg, maskImg image.Image, crop image.Rectangle, featherRadius int) (*image.RGBA, error) {
	baseBounds := baseImg.Bounds()
	w, h := baseBounds.Dx(), baseBounds.Dy()
	if w <= 0 || h <= 0 {
		return nil, errors.New("原图尺寸异常")
	}
	cr := crop.Intersect(image.Rect(0, 0, w, h))
	if cr.Empty() {
		return nil, errors.New("裁剪区域超出原图范围")
	}
	baseRGBA := normalizeToRGBA(baseImg, w, h)
	// 模型只见到裁剪图，所以它的输出整体对应裁剪图：先缩放回裁剪尺寸，再贴到裁剪原位
	placed := resampleToSize(overImg, cr.Dx(), cr.Dy())
	canvas := image.NewRGBA(image.Rect(0, 0, w, h))
	draw.Draw(canvas, canvas.Bounds(), baseRGBA, image.Point{}, draw.Src)
	draw.Draw(canvas, cr, placed, image.Point{}, draw.Src)
	// 色调对齐：拿选区外围那一圈（模型也画过）比出渲染差异，再把模型那块整体拉回原图水平
	matchPatchLevels(baseRGBA, canvas, maskImg, w, h, cr)
	// 再按蒙版混合：选区内用"模型画的那块"，选区外仍是原图字节
	at := featherMask(maskSampler(maskImg, w, h), w, h, featherRadius)
	return blendWithMask(baseRGBA, canvas, at, w, h), nil
}

// boxBlurRGBA 可分离盒式模糊（两趟一维滑动窗口），复杂度 O(w*h)，4K 图也在百毫秒级。
// 盒式模糊是高斯模糊的常用近似，用于"擦掉"足够自然。
//
// 注意：必须返回**新图**、不能原地改 src——Erase 里要拿"模糊后的图"和"原图"做蒙版混合，
// 两者若指向同一块内存，混合结果恒等于原图，整个擦除就静默失效了（单元测试抓到过这个 bug）。
func boxBlurRGBA(src *image.RGBA, radius int) *image.RGBA {
	if radius < 1 {
		radius = 1
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	tmp := image.NewRGBA(bounds)
	out := image.NewRGBA(bounds)
	// 横向 src → tmp
	for y := 0; y < h; y++ {
		var sumR, sumG, sumB, count int
		for x := -radius; x <= radius; x++ {
			if x >= 0 && x < w {
				c := src.RGBAAt(x, y)
				sumR += int(c.R)
				sumG += int(c.G)
				sumB += int(c.B)
				count++
			}
		}
		for x := 0; x < w; x++ {
			tmp.SetRGBA(x, y, color.RGBA{
				R: uint8(sumR / count), G: uint8(sumG / count), B: uint8(sumB / count), A: 255,
			})
			// 窗口右移：去掉左边一个、加上右边一个
			outX := x - radius
			if outX >= 0 && outX < w {
				c := src.RGBAAt(outX, y)
				sumR -= int(c.R)
				sumG -= int(c.G)
				sumB -= int(c.B)
				count--
			}
			inX := x + radius + 1
			if inX >= 0 && inX < w {
				c := src.RGBAAt(inX, y)
				sumR += int(c.R)
				sumG += int(c.G)
				sumB += int(c.B)
				count++
			}
			if count <= 0 {
				count = 1
			}
		}
	}
	// 纵向 tmp → out（不写回 src，见上面的注意）
	for x := 0; x < w; x++ {
		var sumR, sumG, sumB, count int
		for y := -radius; y <= radius; y++ {
			if y >= 0 && y < h {
				c := tmp.RGBAAt(x, y)
				sumR += int(c.R)
				sumG += int(c.G)
				sumB += int(c.B)
				count++
			}
		}
		for y := 0; y < h; y++ {
			out.SetRGBA(x, y, color.RGBA{
				R: uint8(sumR / count), G: uint8(sumG / count), B: uint8(sumB / count), A: 255,
			})
			outY := y - radius
			if outY >= 0 && outY < h {
				c := tmp.RGBAAt(x, outY)
				sumR -= int(c.R)
				sumG -= int(c.G)
				sumB -= int(c.B)
				count--
			}
			inY := y + radius + 1
			if inY >= 0 && inY < h {
				c := tmp.RGBAAt(x, inY)
				sumR += int(c.R)
				sumG += int(c.G)
				sumB += int(c.B)
				count++
			}
			if count <= 0 {
				count = 1
			}
		}
	}
	return out
}

// mosaicRGBA 块内取均值实现马赛克
func mosaicRGBA(src *image.RGBA, block int) *image.RGBA {
	if block < 2 {
		block = 2
	}
	bounds := src.Bounds()
	w, h := bounds.Dx(), bounds.Dy()
	out := image.NewRGBA(bounds)

	for by := 0; by < h; by += block {
		for bx := 0; bx < w; bx += block {
			maxX, maxY := bx+block, by+block
			if maxX > w {
				maxX = w
			}
			if maxY > h {
				maxY = h
			}
			var sumR, sumG, sumB, n int
			for y := by; y < maxY; y++ {
				for x := bx; x < maxX; x++ {
					c := src.RGBAAt(x, y)
					sumR += int(c.R)
					sumG += int(c.G)
					sumB += int(c.B)
					n++
				}
			}
			if n == 0 {
				continue
			}
			c := color.RGBA{R: uint8(sumR / n), G: uint8(sumG / n), B: uint8(sumB / n), A: 255}
			for y := by; y < maxY; y++ {
				for x := bx; x < maxX; x++ {
					out.SetRGBA(x, y, c)
				}
			}
		}
	}
	return out
}

// solidRGBA 用蒙版覆盖区域的平均色填充整张图（只在蒙版区生效，由调用方混合）
func solidRGBA(src *image.RGBA, maskAt func(int, int) uint8, w, h int) *image.RGBA {
	var sumR, sumG, sumB, n int
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			if maskAt(x, y) < 128 {
				continue
			}
			c := src.RGBAAt(x, y)
			sumR += int(c.R)
			sumG += int(c.G)
			sumB += int(c.B)
			n++
		}
	}
	fill := color.RGBA{R: 255, G: 255, B: 255, A: 255}
	if n > 0 {
		fill = color.RGBA{R: uint8(sumR / n), G: uint8(sumG / n), B: uint8(sumB / n), A: 255}
	}
	out := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			out.SetRGBA(x, y, fill)
		}
	}
	return out
}
