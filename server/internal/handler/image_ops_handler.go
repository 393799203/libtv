package handler

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"
)

// ImageOpsHandler 画布图片的派生处理接口：宫格切分 / 尺寸放大 / 蒙版擦除 / 视频截帧。
//
// 为什么不做成前端 canvas 处理、以及为什么裁切放服务端，见 service.ImageOpsService
// 的注释。这里只负责：入参校验（含图片域名白名单）、拼落盘目录、把结果按统一格式回给前端。
//
// 落盘目录与画布图片上传保持一致（users/<userID>/canvas/<projectID>/），
// 这样项目清理时"按目录前缀删除"的逻辑天然会带走这些派生图。
type ImageOpsHandler struct {
	ops *service.ImageOpsService
}

func NewImageOpsHandler(ops *service.ImageOpsService) *ImageOpsHandler {
	return &ImageOpsHandler{ops: ops}
}

// storageOpts 构造派生图片的落盘选项
func (h *ImageOpsHandler) storageOpts(c *gin.Context, projectID string) service.UploadOptions {
	dir := "canvas"
	if uid := middleware.GetUserID(c); uid != "" {
		dir = "users/" + uid + "/canvas"
	}
	return service.UploadOptions{
		Dir:            dir,
		ProjectID:      strings.TrimSpace(projectID),
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	}
}

// checkSrc 预校验图片地址：非空 + 域名白名单。
// 白名单是防 SSRF 的关键（本服务会按用户给的 URL 去下载图片），详见 NewImageOpsService。
func (h *ImageOpsHandler) checkSrc(c *gin.Context, urls ...string) bool {
	return h.checkSrcAs(c, "图片", urls...)
}

// checkSrcAs 同 checkSrc，但可指定称谓 —— 视频截帧走同一条白名单，
// 只是报错文案不该说"图片"（用户传的是视频，说图片只会让人以为点错了）。
func (h *ImageOpsHandler) checkSrcAs(c *gin.Context, kind string, urls ...string) bool {
	for _, u := range urls {
		if strings.TrimSpace(u) == "" {
			response.Fail(c, http.StatusBadRequest, "缺少"+kind+"地址")
			return false
		}
		if !h.ops.HostAllowed(u) {
			response.Fail(c, http.StatusBadRequest, kind+"来源域名不在白名单内（仅允许本站对象存储域名）")
			return false
		}
	}
	return true
}

// Split 宫格切分：POST /api/images/split
// body: { imageUrl, rows, cols, trimPx, cutsX, cutsY, cells, projectId }
// cutsX/cutsY 是图上用户拖出来的归一化切割位置（0~1）；传了就以切割线条数为准。
// cells 只切选中的几格（空=全切）。只裁不放大：高清由前端为每格提交一次图像模型 4K 重生成。
func (h *ImageOpsHandler) Split(c *gin.Context) {
	var req struct {
		ImageURL  string    `json:"imageUrl"`
		Rows      int       `json:"rows"`
		Cols      int       `json:"cols"`
		CutsX     []float64 `json:"cutsX"`
		CutsY     []float64 `json:"cutsY"`
		TrimPx    int       `json:"trimPx"`
		Cells     []int     `json:"cells"`
		ProjectID string    `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrc(c, req.ImageURL) {
		return
	}

	// 上层给 30s：切 8×8=64 格是一串 ffmpeg 调用，32 格实测秒级，留足余量。
	tiles, err := h.ops.Split(c.Request.Context(), req.ImageURL, req.Rows, req.Cols, req.CutsX, req.CutsY, req.TrimPx, req.Cells, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OKWithMsg(c, "切分成功", gin.H{
		"tiles": tiles,
		"count": len(tiles),
	})
}

// Scale 尺寸放大：POST /api/images/scale
// body: { imageUrl, targetShort, projectId }
func (h *ImageOpsHandler) Scale(c *gin.Context) {
	var req struct {
		ImageURL    string `json:"imageUrl"`
		TargetShort int    `json:"targetShort"`
		ProjectID   string `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrc(c, req.ImageURL) {
		return
	}

	tile, err := h.ops.Scale(c.Request.Context(), req.ImageURL, req.TargetShort, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	msg := "已放大约 2 倍"
	if tile.Skipped {
		msg = "原图已不小于目标尺寸，无需放大"
	}
	response.OKWithMsg(c, msg, gin.H{"tile": tile})
}

// Erase 蒙版擦除：POST /api/images/erase
// body: { imageUrl, maskUrl, mode: blur|mosaic|solid, strength, projectId }
func (h *ImageOpsHandler) Erase(c *gin.Context) {
	var req struct {
		ImageURL  string `json:"imageUrl"`
		MaskURL   string `json:"maskUrl"`
		Mode      string `json:"mode"`
		Strength  int    `json:"strength"`
		ProjectID string `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrc(c, req.ImageURL, req.MaskURL) {
		return
	}

	tile, err := h.ops.Erase(c.Request.Context(), req.ImageURL, req.MaskURL, req.Mode, req.Strength, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OKWithMsg(c, "已应用擦除", gin.H{"tile": tile})
}

// Filmstrip 缩略图条：POST /api/videos/filmstrip
// body: { videoUrl, count?, projectId }
//
// 给「片段选择条」当底图用：一次 ffmpeg tile 出整条视频的 N 张缩略拼图。
// 前端自己抽帧不行 —— 线上视频跨域且不回 CORS 头，canvas 会被污染、toDataURL 抛 SecurityError。
func (h *ImageOpsHandler) Filmstrip(c *gin.Context) {
	var req struct {
		VideoURL  string `json:"videoUrl"`
		Count     int    `json:"count"`
		ProjectID string `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrcAs(c, "视频", req.VideoURL) {
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	strip, err := h.ops.FilmstripVideo(ctx, req.VideoURL, req.Count, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	response.OK(c, strip)
}

// TrimVideo 视频裁剪：POST /api/videos/trim
// body: { videoUrl, start, end, projectId }
//
// 「片段重拍」用：用户先在片段条上拖出区间，点确认后**真的把这一段裁成一个新视频**
// （重编码，不是 -c copy，否则会从关键帧切、和用户选的区间对不上），
// 前端拿到 url 直接建一个视频节点 —— 那个节点显示的就是这一段。
func (h *ImageOpsHandler) TrimVideo(c *gin.Context) {
	var req struct {
		VideoURL  string  `json:"videoUrl"`
		Start     float64 `json:"start"`
		End       float64 `json:"end"`
		ProjectID string  `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrcAs(c, "视频", req.VideoURL) {
		return
	}

	// 下载 + 重编码：5~30 秒的片段实测秒级到十几秒，给足余量
	ctx, cancel := context.WithTimeout(c.Request.Context(), 300*time.Second)
	defer cancel()

	clip, err := h.ops.TrimVideo(ctx, req.VideoURL, req.Start, req.End, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	msg := fmt.Sprintf("已裁出 %.1f 秒片段", clip.Duration)
	if service.ClipShorterThanRequested(clip) {
		msg = fmt.Sprintf("已裁出 %.1f 秒（你选的区间超出了片尾，只裁到片尾为止）", clip.Duration)
	}
	response.OKWithMsg(c, msg, clip)
}

// DemuxVideo 音视频分离：POST /api/videos/demux
// body: { videoUrl, projectId }
//
// 把一条视频拆成「无声视频」和「音频」两份产物：前端拿到两个 url 直接建两个节点
// （无声视频节点 + 音频节点），源节点不动 —— 和「片段重拍」「截取画面」的派生惯例一致。
// 无声视频走流拷贝（画面零损失、秒出），音轨重编码成 AAC/m4a（浏览器能直接播）。
// 本机 ffmpeg 干活、不调上游模型，所以不扣积分。
func (h *ImageOpsHandler) DemuxVideo(c *gin.Context) {
	var req struct {
		VideoURL  string `json:"videoUrl"`
		ProjectID string `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrcAs(c, "视频", req.VideoURL) {
		return
	}

	// 下载（有缓存则命中）+ 两条流处理：给足余量，冷启动要拉一次源文件
	ctx, cancel := context.WithTimeout(c.Request.Context(), 300*time.Second)
	defer cancel()

	out, err := h.ops.DemuxVideo(ctx, req.VideoURL, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	msg := fmt.Sprintf("已分离：音频 %.1f 秒（%.0f KB）+ 无声视频（%.1f MB）",
		out.Duration, float64(out.AudioSize)/1024, float64(out.SilentSize)/1024/1024)
	response.OKWithMsg(c, msg, out)
}

// CaptureFrame 视频截帧：POST /api/videos/frame
// body: { videoUrl, mode: "first"|"last"|"at", time?: 秒, projectId }
//
// 取到的一帧按派生图落盘（同一目录 + 640px webp 缩略图），前端拿到 url/thumb_url 后
// 直接建一个**图片节点** —— 这样首/尾帧可以立刻接去图生视频，不用先下载再上传一遍。
// 本机 ffmpeg 干活、不调上游模型，所以不扣积分。
func (h *ImageOpsHandler) CaptureFrame(c *gin.Context) {
	var req struct {
		VideoURL  string  `json:"videoUrl"`
		Mode      string  `json:"mode"`
		Time      float64 `json:"time"`
		ProjectID string  `json:"projectId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数解析失败")
		return
	}
	if !h.checkSrcAs(c, "视频", req.VideoURL) {
		return
	}

	// 下载 + 取帧：视频要落临时文件再 seek，给足时间（大视频首尾帧实测秒级，几十 MB 的给余量）
	ctx, cancel := context.WithTimeout(c.Request.Context(), 120*time.Second)
	defer cancel()

	tile, err := h.ops.CaptureVideoFrame(ctx, req.VideoURL, service.VideoFrameMode(req.Mode), req.Time, h.storageOpts(c, req.ProjectID))
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	what := "画面"
	switch service.VideoFrameMode(req.Mode) {
	case service.VideoFrameFirst:
		what = "首帧"
	case service.VideoFrameLast:
		what = "尾帧"
	case service.VideoFrameAt:
		what = "当前帧"
	}
	// 与 /images/scale 同一形状（{tile: ...}）：前端 imageOpsApi 就是这么解包的
	response.OKWithMsg(c, "已截取"+what, gin.H{"tile": tile})
}
