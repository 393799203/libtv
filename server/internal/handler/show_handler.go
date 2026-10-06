package handler

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image/jpeg"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/repository"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type ShowHandler struct {
	showService       *service.ShowService
	fileUploadService *service.FileUploadService
	projectRepo       repository.ProjectRepo
}

func NewShowHandler(showService *service.ShowService, fileUploadService *service.FileUploadService, projectRepo repository.ProjectRepo) *ShowHandler {
	return &ShowHandler{showService: showService, fileUploadService: fileUploadService, projectRepo: projectRepo}
}

// ========== 公开接口：首页展示 ==========

// ListCategories 获取所有分类（公开）
func (h *ShowHandler) ListCategories(c *gin.Context) {
	cats, err := h.showService.ListCategories(c.Request.Context())
	if err != nil {
		response.FailWith(c, err)
		return
	}

	type CatWithCount struct {
		model.ShowCategory
		ShowCount int64 `json:"show_count"`
		// HiddenCount 该分类下后台看不到的历史视频数（status 为空，视频管理/待审核两处列表都不列）。
		// 删除这个标签时会连带清掉它们，所以先告诉前端，让确认框能把后果说清楚。
		HiddenCount int64 `json:"hidden_count"`
	}

	// 一次 GROUP BY 取回所有分类的历史条数，避免每个分类多查一次
	hiddenCounts, err := h.showService.CountHiddenShowsByCategory(c.Request.Context())
	if err != nil {
		hiddenCounts = nil
	}

	var result []CatWithCount
	for _, cat := range cats {
		var count int64
		// 通过 service 获取每个分类下的视频数
		_, count, _ = h.showService.ListShows(c.Request.Context(), cat.ID, "", 1, 1)
		result = append(result, CatWithCount{
			ShowCategory: *cat,
			ShowCount:    count,
			HiddenCount:  hiddenCounts[cat.ID],
		})
	}

	response.OK(c, result)
}

// ListShows 获取视频列表（公开，支持按分类筛选 + 关键词搜索）
func (h *ShowHandler) ListShows(c *gin.Context) {
	categoryID := c.Query("category_id")
	keyword := c.Query("keyword")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if pageSize > 100 {
		pageSize = 100
	}

	shows, total, err := h.showService.ListShows(c.Request.Context(), categoryID, keyword, page, pageSize)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{
		"items":     shows,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetShow 获取单个视频详情（公开）
func (h *ShowHandler) GetShow(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, show)
}

// LikeShow 点赞视频（需登录）
func (h *ShowHandler) LikeShow(c *gin.Context) {
	id := c.Param("id")
	// 从 JWT 获取用户 ID
	userID, exists := c.Get("user_id")
	if !exists {
		response.Fail(c, 401, "请先登录")
		return
	}

	likes, isLiked, err := h.showService.LikeShow(c.Request.Context(), userID.(string), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"likes": likes, "is_liked": isLiked})
}

// UnlikeShow 取消点赞（需登录）
func (h *ShowHandler) UnlikeShow(c *gin.Context) {
	id := c.Param("id")
	// 从 JWT 获取用户 ID
	userID, exists := c.Get("user_id")
	if !exists {
		response.Fail(c, 401, "请先登录")
		return
	}

	likes, isLiked, err := h.showService.UnlikeShow(c.Request.Context(), userID.(string), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"likes": likes, "is_liked": isLiked})
}

// CheckShowLiked 检查用户是否已点赞（需登录）
func (h *ShowHandler) CheckShowLiked(c *gin.Context) {
	id := c.Param("id")
	// 从 JWT 获取用户 ID
	userID, exists := c.Get("user_id")
	if !exists {
		response.Fail(c, 401, "请先登录")
		return
	}

	isLiked, err := h.showService.IsShowLiked(c.Request.Context(), userID.(string), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"is_liked": isLiked})
}

// ========== 需登录接口：管理操作 ==========

type CreateShowRequest struct {
	CategoryID  string   `json:"category_id" binding:"required"`
	Title       string   `json:"title" binding:"required"`
	Description string   `json:"description"`
	VideoURL    string   `json:"video_url"`
	Duration    int      `json:"duration"`
	AuthorID    string   `json:"author_id"`
	Tags        []string `json:"tags"`
	SortOrder   int      `json:"sort_order"`
	Status      string   `json:"status"`     // pending / published，默认 published
	ProjectID   string   `json:"project_id"` // 关联画布项目ID
}

type UpdateShowRequest struct {
	Title       *string  `json:"title"`
	Description *string  `json:"description"`
	VideoURL    *string  `json:"video_url"`
	Duration    *int     `json:"duration"`
	AuthorID    *string  `json:"author_id"`
	Tags        []string `json:"tags"`
	SortOrder   *int     `json:"sort_order"`
	CategoryID  *string  `json:"category_id"`
	Status      *string  `json:"status"`
}

// CreateShow 创建视频条目（需登录）
func (h *ShowHandler) CreateShow(c *gin.Context) {
	var req CreateShowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	tagsJSON, _ := json.Marshal(req.Tags)
	show := &model.Show{
		CategoryID:  req.CategoryID,
		Title:       req.Title,
		Description: req.Description,
		VideoURL:    req.VideoURL,
		Duration:    req.Duration,
		Tags:        tagsJSON,
		SortOrder:   req.SortOrder,
		Status:      req.Status,
		ProjectID:   req.ProjectID,
	}

	// 同一项目已存在审核通过的 show 时，禁止从画布侧重复提交审核
	if req.ProjectID != "" {
		if existing, err := h.showService.GetShowByProjectID(c.Request.Context(), req.ProjectID); err == nil && existing != nil && existing.Status == "published" {
			response.Fail(c, http.StatusForbidden, "该项目视频已审核通过，不能重复提交审核")
			return
		}
	}

	h.showService.ResolveAuthor(c.Request.Context(), show, req.AuthorID)

	if err := h.showService.CreateShow(c.Request.Context(), show); err != nil {
		response.FailWith(c, err)
		return
	}

	response.Created(c, show)
}

// UploadThumbnail 上传封面图并关联到视频记录
func (h *ShowHandler) UploadThumbnail(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "请选择文件")
		return
	}

	// 存储目录：
	// - 已发布（published）的视频换封面直接存对外 shows/ 目录（已对外展示，无需再走审核复制）
	// - 待审核/已拒绝的封面暂存用户画布目录 users/<userID>/canvas/<projectID>/，审核通过时才复制到 shows/
	// - 无项目关联时降级公共 shows/ 目录
	opts := service.UploadOptions{
		Dir:            "shows",
		AllowedExts:    service.ImageExts(),
		MaxSize:        10 * 1024 * 1024,
		ContentTypeFor: service.ContentTypeForImage,
	}
	if show.ProjectID != "" && show.Status != "published" {
		if project, err := h.projectRepo.FindByID(c.Request.Context(), show.ProjectID); err == nil && project != nil && project.UserID != "" {
			opts.Dir = "users/" + project.UserID + "/canvas"
			opts.ProjectID = show.ProjectID
		}
	}

	result, err := h.fileUploadService.Upload(file, header, opts)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.showService.UpdateThumbnail(c.Request.Context(), id, result.URL); err != nil {
		response.FailWith(c, err)
		return
	}

	// 如果 show 关联了项目，同步更新项目封面
	if show, err := h.showService.GetByID(c.Request.Context(), id); err == nil && show.ProjectID != "" {
		if project, err := h.projectRepo.FindByID(c.Request.Context(), show.ProjectID); err == nil {
			project.CoverURL = result.URL
			_ = h.projectRepo.Update(c.Request.Context(), project)
		}
	}

	response.OK(c, gin.H{"url": result.URL})
}

// UploadVideo 上传视频文件到MinIO
func (h *ShowHandler) UploadVideo(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "请选择文件")
		return
	}

	// URL 走代理路由 /media/videos/<filename>（与历史路径兼容）
	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "videos",
		AllowedExts:    service.VideoExts(),
		MaxSize:        1024 * 1024 * 1024,
		ContentTypeFor: service.ContentTypeForVideo,
		URLFor: func(objectName string) string {
			// objectName 形如 "videos/<hash>.mp4"
			return "/media/" + objectName
		},
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	show.VideoURL = result.URL
	if err := h.showService.UpdateShow(c.Request.Context(), show); err != nil {
		// P2-17 修复：原代码漏掉了 UpdateShow 的错误检查
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{"url": result.URL})
}

// UpdateShow 更新视频信息（需登录）
func (h *ShowHandler) UpdateShow(c *gin.Context) {
	id := c.Param("id")

	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	var req UpdateShowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Title != nil {
		show.Title = *req.Title
	}
	if req.Description != nil {
		show.Description = *req.Description
	}
	if req.VideoURL != nil {
		show.VideoURL = *req.VideoURL
	}
	if req.Duration != nil {
		show.Duration = *req.Duration
	}
	if req.AuthorID != nil {
		h.showService.ResolveAuthor(c.Request.Context(), show, *req.AuthorID)
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(req.Tags)
		show.Tags = tagsJSON
	}
	if req.SortOrder != nil {
		show.SortOrder = *req.SortOrder
	}
	if req.CategoryID != nil {
		show.CategoryID = *req.CategoryID
	}
	if req.Status != nil {
		// 已审核通过（published）的 show 不允许被改回待审核，避免画布侧重复提交绕过审核
		if show.Status == "published" && *req.Status != "published" {
			response.Fail(c, http.StatusForbidden, "该视频已审核通过，不能重新提交审核")
			return
		}
		show.Status = *req.Status
	}

	if err := h.showService.UpdateShow(c.Request.Context(), show); err != nil {
		response.FailWith(c, err)
		return
	}

	// 刷新关联数据
	show, _ = h.showService.GetByID(c.Request.Context(), id)
	response.OK(c, show)
}

// DeleteShow 删除视频（需登录），同时清理关联的缩略图和视频文件
func (h *ShowHandler) DeleteShow(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.DeleteShow(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}

// GetShowByProjectID 按项目ID查询关联的 show（需登录）
func (h *ShowHandler) GetShowByProjectID(c *gin.Context) {
	projectID := c.Param("projectId")
	show, err := h.showService.GetShowByProjectID(c.Request.Context(), projectID)
	if err != nil {
		response.OK(c, nil)
		return
	}
	response.OK(c, show)
}

// ========== 待审核视频管理（需登录）==========

// ListPendingShows 获取待审核视频列表
func (h *ShowHandler) ListPendingShows(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if pageSize > 100 {
		pageSize = 100
	}

	shows, total, err := h.showService.ListPendingShows(c.Request.Context(), page, pageSize)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{
		"items":     shows,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// ApproveShow 审核通过视频（将 status 改为 published）
func (h *ShowHandler) ApproveShow(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.ApproveShow(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "已审核通过", nil)
}

// RejectShow 审核不通过视频（将 status 改为 rejected）
func (h *ShowHandler) RejectShow(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.RejectShow(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "已标记不通过", nil)
}

// ========== 分类管理（需登录）==========

type CreateShowCategoryRequest struct {
	Name      string `json:"name" binding:"required"`
	SortOrder int    `json:"sort_order"`
}

type UpdateShowCategoryRequest struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
}

// CreateCategory 创建分类（需登录）
func (h *ShowHandler) CreateCategory(c *gin.Context) {
	var req CreateShowCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	cat := &model.ShowCategory{
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}
	if err := h.showService.CreateCategory(c.Request.Context(), cat); err != nil {
		response.FailWith(c, err)
		return
	}
	response.Created(c, cat)
}

// UpdateCategory 更新分类（需登录）
func (h *ShowHandler) UpdateCategory(c *gin.Context) {
	id := c.Param("id")

	var req UpdateShowCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	cat, err := h.showService.GetCategoryByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	if req.Name != nil {
		cat.Name = *req.Name
	}
	if req.SortOrder != nil {
		cat.SortOrder = *req.SortOrder
	}

	if err := h.showService.UpdateCategory(c.Request.Context(), cat); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, cat)
}

// DeleteCategory 删除分类（需登录）
func (h *ShowHandler) DeleteCategory(c *gin.Context) {
	id := c.Param("id")
	cleaned, err := h.showService.DeleteCategory(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	// 带上清理条数：删标签时可能顺带清掉几条后台看不到的历史数据，操作者应该知道
	response.OKWithMsg(c, "deleted", gin.H{"cleaned_hidden_shows": cleaned})
}

// ========== 服务端抽帧生成封面 ==========

// CaptureCoverRequest 抽帧请求
type CaptureCoverRequest struct {
	// VideoURL 视频地址（只接受本站存储域名，详见 CaptureCoverFromVideo 的安全说明）
	VideoURL string `json:"video_url"`
	// Time 抽帧时间点（秒），可选；默认取第 1 秒，取不到再退回第 0 帧
	Time float64 `json:"time"`
}

// CaptureCoverFromVideo 从视频里抽一帧当封面：POST /api/shows/capture-cover
//
// 为什么需要服务端抽帧：浏览器 canvas 取帧必须让视频以 crossOrigin=anonymous 加载
// （否则画布被"污染"，toDataURL 直接抛 SecurityError），而这要求对象存储返回
// Access-Control-Allow-Origin。天翼云 ZOS 目前**不返回任何 CORS 头** → 浏览器判定视频
// 加载失败，后台就报"视频加载失败"，封面自然也截不出来（视频本身是好的：200 + video/mp4）。
// 所以改成服务端 ffmpeg 抽帧再传回存储，彻底绕开浏览器跨域限制：
//   - 上传本地文件：前端优先用本地 File 截帧（不用下载、无跨域）；
//   - 粘贴 URL / 给老作品换封面：走这个接口。
//
// 安全：**只接受本站存储域名**的地址。否则本接口就成了"让服务器替你抓任意 URL"的
// SSRF 入口（能探内网服务、能打云元数据地址）。
func (h *ShowHandler) CaptureCoverFromVideo(c *gin.Context) {
	var req CaptureCoverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求参数不合法")
		return
	}
	videoURL := strings.TrimSpace(req.VideoURL)
	if videoURL == "" {
		response.Fail(c, http.StatusBadRequest, "缺少视频地址")
		return
	}
	u, err := url.Parse(videoURL)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		response.Fail(c, http.StatusBadRequest, "视频地址不合法")
		return
	}
	if host := h.storageHost(); host != "" && !strings.EqualFold(u.Host, host) {
		response.Fail(c, http.StatusBadRequest, "只支持本站存储的视频地址（其他来源请手动上传封面图）")
		return
	}

	frame, usedTime, err := extractVideoFrame(c.Request.Context(), videoURL, req.Time)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	// 直接把这一帧以 data URL 返回，由前端转成 File 走**既有的**封面上传流程。
	// 为什么不在这里直接传存储：一是提交时前端本来就会上传封面（走 /shows/:id/thumbnail
	// 与审核目录规则），服务端再传一次会多一份没人引用的孤儿对象；二是老作品换封面、
	// 新作品提交的目录规则不同（待审核进画布目录、已发布进 shows/），放前端统一处理更稳。
	// 同时回传实际使用的时间点：前端可以提示"用的是第几秒画面"，排查时也能对上账
	response.OK(c, gin.H{
		"data_url": "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(frame),
		"time":     usedTime,
	})
}

// storageHost 本站存储的公网域名（用于白名单校验），取不到时返回空串（不限制）
func (h *ShowHandler) storageHost() string {
	if h.fileUploadService == nil {
		return ""
	}
	u, err := url.Parse(h.fileUploadService.ObjectURL("probe.jpg"))
	if err != nil {
		return ""
	}
	return u.Host
}

// extractVideoFrame 用 ffmpeg 从视频里抽一帧，返回 JPEG 字节。
//
// 两种模式：
//   - at > 0：用户明确指定了时间点（前端"截取当前帧"），照办；抽不到再自动挑。
//   - at <= 0：自动挑一帧"能用的画面"。
//
// 为什么要自动挑，而不是固定取第 1 秒：很多视频开头是黑场/淡入。实测线上一条 208 秒的视频
// 第 1 秒的平均亮度只有 49/255（JPEG 28KB，几乎纯黑）、第 10 秒更黑（6.7KB）—— 用它当封面
// 等于没有封面（用户反馈"截取了还是没用"就是这个）。所以按时长取多个候选点，按
// "亮度是否正常 + 画面细节是否丰富"打分，选最好的一帧。
func extractVideoFrame(ctx context.Context, videoURL string, at float64) ([]byte, float64, error) {
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	dir, err := os.MkdirTemp("", "show-cover")
	if err != nil {
		return nil, 0, errors.New("服务端抽帧不可用（临时目录创建失败）")
	}
	defer os.RemoveAll(dir)

	// ① 用户指定的时间点
	if at > 0 {
		if b, err := extractFrameAt(ctx, dir, videoURL, at); err == nil && len(b) > 0 {
			return b, at, nil
		}
	}

	// ② 自动挑帧：候选点并行抽小图再按分数取胜者。
	// 单次 ffmpeg 起进程 + HTTP Range 取帧要几百毫秒，串行 8 个候选要 4~6 秒，
	// 用户点完按钮后界面迟迟没反馈，会以为"按钮没用"。并行后总耗时 ≈ 最慢的那个（约 2 秒）。
	cands := candidateTimestamps(ctx, videoURL)
	type candScore struct {
		ts    float64
		score float64
	}
	scored := make(chan candScore, len(cands))
	sem := make(chan struct{}, 6) // 限制并发进程数，避免候选多时压垮小机器
	var wg sync.WaitGroup
	for _, ts := range cands {
		wg.Add(1)
		go func(ts float64) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			small, err := extractFrameSized(ctx, dir, videoURL, ts, 160)
			if err != nil || len(small) == 0 {
				return
			}
			scored <- candScore{ts: ts, score: scoreFrame(small)}
		}(ts)
	}
	wg.Wait()
	close(scored)

	var bestTS float64
	bestScore := math.Inf(-1)
	for c := range scored {
		if c.score > bestScore {
			bestScore, bestTS = c.score, c.ts
		}
	}
	if bestTS > 0 {
		if b, err := extractFrameAt(ctx, dir, videoURL, bestTS); err == nil && len(b) > 0 {
			return b, bestTS, nil
		}
	}

	// ③ 兜底：第 1 秒 → 第 0 帧（短视频、直播切片用）
	var lastErr string
	for _, ts := range []float64{1, 0} {
		b, err := extractFrameAt(ctx, dir, videoURL, ts)
		if err == nil && len(b) > 0 {
			return b, ts, nil
		}
		if err != nil {
			lastErr = err.Error()
		}
	}
	if lastErr == "" {
		lastErr = "未取到画面"
	}
	return nil, 0, errors.New("从该视频抽帧失败（视频可能损坏或格式不支持）: " + truncateErr(lastErr))
}

// candidateTimestamps 候选抽帧时间点：按时长比例取，长短视频各自合理。
// 跳过最开头几秒，专门躲开黑场/淡入/片头。
func candidateTimestamps(ctx context.Context, videoURL string) []float64 {
	d := probeDuration(ctx, videoURL)
	if d <= 0 {
		return []float64{1, 5, 10}
	}
	if d <= 5 {
		// 很短的视频：只能在中段附近试
		return []float64{d * 0.2, d * 0.5, 0, 1}
	}
	if d <= 15 {
		return []float64{d * 0.2, d * 0.35, d * 0.5, d * 0.65, d * 0.8}
	}
	// 长视频多取几个点：黑场/淡入/转场可能在任意位置，采样越全越容易挑到好画面
	return []float64{d * 0.05, d * 0.1, d * 0.2, d * 0.3, d * 0.45, d * 0.6, d * 0.75, d * 0.9}
}

// probeDuration 用 ffprobe 读时长（秒）；失败返回 0
func probeDuration(ctx context.Context, videoURL string) float64 {
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(cctx, "ffprobe",
		"-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", videoURL).Output()
	if err != nil {
		return 0
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || d <= 0 {
		return 0
	}
	return d
}

// extractFrameAt 在指定时间点抽一帧（原始分辨率）
func extractFrameAt(ctx context.Context, dir, videoURL string, at float64) ([]byte, error) {
	return extractFrame(ctx, dir, videoURL, at, 0)
}

// extractFrameSized 抽一小帧（width>0 时等比缩到该宽度），用于打分，省带宽省 CPU
func extractFrameSized(ctx context.Context, dir, videoURL string, at float64, width int) ([]byte, error) {
	return extractFrame(ctx, dir, videoURL, at, width)
}

func extractFrame(ctx context.Context, dir, videoURL string, at float64, width int) ([]byte, error) {
	out := filepath.Join(dir, fmt.Sprintf("f_%.2f_%d.jpg", at, width))
	args := []string{"-y", "-ss", fmt.Sprintf("%.2f", at), "-i", videoURL}
	if width > 0 {
		args = append(args, "-vf", fmt.Sprintf("scale=%d:-2", width))
	}
	// -ss 放在 -i 前：让 ffmpeg 用 HTTP Range 直接跳到目标位置，不用把整个视频拉下来
	args = append(args, "-frames:v", "1", "-q:v", "3", "-f", "image2", "-update", "1", out)

	var stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, errors.New(truncateErr(strings.TrimSpace(stderr.String())))
	}
	b, err := os.ReadFile(out)
	if err != nil || len(b) == 0 {
		return nil, errors.New("未取到画面")
	}
	return b, nil
}

// scoreFrame 给一帧打分：细节（亮度标准差）为主，亮度偏离正常范围时扣分。
// 纯黑/纯白/大片纯色的帧标准差极低，会自然出局。
func scoreFrame(raw []byte) float64 {
	img, err := jpeg.Decode(bytes.NewReader(raw))
	if err != nil {
		return math.Inf(-1)
	}
	b := img.Bounds()
	var sum, sum2 float64
	var n float64
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			r, g, bl, _ := img.At(x, y).RGBA()
			// Rec.601 亮度
			l := 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(bl>>8)
			sum += l
			sum2 += l * l
			n++
		}
	}
	if n == 0 {
		return math.Inf(-1)
	}
	mean := sum / n
	variance := sum2/n - mean*mean
	if variance < 0 {
		variance = 0
	}
	score := math.Sqrt(variance) // 细节/对比度

	switch {
	case mean < 25: // 近黑（黑场/淡入）
		score *= 0.2
	case mean > 235: // 过曝（白闪）
		score *= 0.5
	}
	return score
}

// truncateErr 上游/ffmpeg 的报错可能很长，只留尾部关键信息给用户看
func truncateErr(s string) string {
	s = strings.ReplaceAll(s, "\n", " ")
	const max = 300
	if len(s) <= max {
		return s
	}
	return "..." + s[len(s)-max:]
}
