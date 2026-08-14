package handler

import (
	"bytes"
	"fmt"
	"image"
	_ "image/gif"  // ✅ 只导入副作用：自动注册 GIF 解码器
	_ "image/jpeg" // ✅ 只导入副作用：自动注册 JPEG 解码器
	_ "image/png"  // ✅ 只导入副作用：自动注册 PNG 解码器
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"
	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
)

// UploadHandler 上传处理器（支持MinIO降级）
type UploadHandler struct {
	storage           storage.Storage
	fileUploadService *service.FileUploadService
	transcodeService  *service.TranscodeService
}

// NewUploadHandler 创建上传处理器
func NewUploadHandler(s storage.Storage, fileUploadService *service.FileUploadService, transcodeService *service.TranscodeService) *UploadHandler {
	return &UploadHandler{storage: s, fileUploadService: fileUploadService, transcodeService: transcodeService}
}

// UploadVideo 上传视频（哈希去重，按项目ID分文件夹，TS自动转MP4）
func (h *UploadHandler) UploadVideo(c *gin.Context) {
	_, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	// 目录选择：有项目ID存到 canvas/<projectID>/，否则存到 videos/
	dir := "videos"
	if projectID != "" {
		dir = "canvas"
	}

	result, err := h.fileUploadService.UploadVideoWithTranscode(header, service.UploadOptions{
		Dir:       dir,
		ProjectID: projectID,
	}, h.transcodeService)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	// 同步完成（含命中去重）
	if !result.AsyncTranscode {
		msg := "上传成功"
		if result.Cached {
			msg = "上传成功（已存在）"
		}
		response.OKWithMsg(c, msg, gin.H{
			"url":          result.URL,
			"storage_type": result.StorageType,
			"filename":     result.ObjectName,
			"cached":       result.Cached,
			"compressed":   result.Compressed,
		})
		return
	}

	// 异步转码中
	response.OKWithMsg(c, "上传成功，正在转码", gin.H{
		"url":        "",
		"task_id":    result.TaskID,
		"filename":   result.ObjectName,
		"compressed": false,
	})
}

// UploadCanvas 上传画布图片（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadCanvas(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "canvas",
		ProjectID:      projectID,
		DefaultExt:     ".png",
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
	})
}

// UploadImage 通用图片上传（哈希去重）
// 如果传递 project_id 参数，存储到 canvas/项目ID/ 目录
// 如果不传递 project_id，存储到 images/ 目录
func (h *UploadHandler) UploadImage(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	// ✅ 读取图片数据到 buffer，用于解码获取尺寸
	imageData, err := io.ReadAll(file)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "读取文件失败")
		return
	}

	// ✅ 解码图片获取实际尺寸
	var width, height int
	imgConfig, format, err := image.DecodeConfig(bytes.NewReader(imageData))
	if err != nil {
		// 解码失败时记录错误，使用默认尺寸（不应该影响上传流程）
		log.Printf("[UploadImage] 图片解码失败: filename=%s size=%d bytes err=%v, 使用默认尺寸 1024×1024", header.Filename, len(imageData), err)
		width = 1024
		height = 1024
	} else {
		width = imgConfig.Width
		height = imgConfig.Height
		log.Printf("[UploadImage] 图片解码成功: filename=%s format=%s size=%d bytes dimensions=%d×%d", header.Filename, format, len(imageData), width, height)
	}

	// 没有项目ID时存到 images/，有项目ID时存到 canvas/项目ID/
	dir := "images"
	if projectID != "" {
		dir = "canvas"
	}

	// ✅ 使用 bytes.NewReader 重新创建 reader（因为前面的 ReadAll 已经读完了）
	result, err := h.fileUploadService.UploadFromReader(bytes.NewReader(imageData), int64(len(imageData)), header.Filename, service.UploadOptions{
		Dir:            dir,
		ProjectID:      projectID,
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	// ✅ 返回图片尺寸信息，统一数据格式
	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
		"width":        width,  // ✅ 图片宽度
		"height":       height, // ✅ 图片高度
	})
}

// UploadAvatar 上传当前登录用户的头像（哈希去重）
// 存储到用户专属目录 users/<userID>/avatar/，不再占用公共 images/ 目录
// （用户存储目录约定：users/<userID>/avatar/ 头像；users/<userID>/assets/ 用户资产）
func (h *UploadHandler) UploadAvatar(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "users/" + userID + "/avatar",
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
	})
}

// UploadAudio 上传音频文件（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadAudio(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "获取文件失败")
		return
	}

	projectID := c.PostForm("project_id")

	// 有项目ID时存到 canvas/项目ID/，否则存到 audio/
	dir := "audio"
	if projectID != "" {
		dir = "canvas"
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:        dir,
		ProjectID:  projectID,
		DefaultExt: ".mp3",
		AllowedExts: map[string]bool{
			".mp3": true, ".wav": true, ".ogg": true, ".m4a": true, ".flac": true,
		},
		ContentTypeFor: service.ContentTypeForAudio,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.OKWithMsg(c, "上传成功", gin.H{
		"url":          result.URL,
		"storage_type": result.StorageType,
		"filename":     result.ObjectName,
		"cached":       result.Cached,
	})
}

// GetFile 获取文件（代理MinIO，支持Range请求）
func (h *UploadHandler) GetFile(c *gin.Context) {
	filePath := c.Param("filepath")
	filePath = strings.TrimPrefix(filePath, "/")

	// 获取文件信息
	info, err := h.storage.StatObject(filePath)
	if err != nil {
		c.Status(http.StatusNotFound)
		return
	}

	// 设置响应头
	c.Header("Content-Type", info.ContentType)
	c.Header("Accept-Ranges", "bytes")
	c.Header("Cache-Control", "public, max-age=31536000") // 缓存1年

	// 处理Range请求
	rangeHeader := c.GetHeader("Range")
	if rangeHeader != "" {
		// 解析Range请求（如 "bytes=0-1023"）
		start, end := parseRange(rangeHeader, info.Size)
		length := end - start + 1

		c.Header("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, info.Size))
		c.Header("Content-Length", fmt.Sprintf("%d", length))
		c.Status(http.StatusPartialContent)

		// 获取文件指定范围
		reader, err := h.storage.GetObjectRange(filePath, start, end)
		if err != nil {
			c.Status(http.StatusInternalServerError)
			return
		}
		defer reader.Close()

		buf := make([]byte, 32*1024)
		_, _ = io.CopyBuffer(c.Writer, reader, buf)
	} else {
		// 完整文件请求
		c.Header("Content-Length", fmt.Sprintf("%d", info.Size))
		c.Status(http.StatusOK)

		reader, err := h.storage.GetObject(filePath)
		if err != nil {
			c.Status(http.StatusNotFound)
			return
		}
		defer reader.Close()

		buf := make([]byte, 32*1024)
		_, _ = io.CopyBuffer(c.Writer, reader, buf)
	}
}

// parseRange 解析Range请求头
func parseRange(rangeHeader string, fileSize int64) (start, end int64) {
	// 格式: "bytes=0-1023" 或 "bytes=0-"
	if !strings.HasPrefix(rangeHeader, "bytes=") {
		return 0, fileSize - 1
	}

	rangeStr := strings.TrimPrefix(rangeHeader, "bytes=")
	parts := strings.Split(rangeStr, "-")
	if len(parts) != 2 {
		return 0, fileSize - 1
	}

	// 解析起始位置
	if parts[0] == "" {
		start = 0
	} else {
		// P2-14 改用 strconv.ParseInt 替代自造 parseInt64
		if v, err := strconv.ParseInt(parts[0], 10, 64); err == nil {
			start = v
		}
	}

	// 解析结束位置
	if parts[1] == "" {
		end = fileSize - 1
	} else {
		if v, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
			end = v
		}
	}

	// 确保范围有效
	if start < 0 {
		start = 0
	}
	if end >= fileSize {
		end = fileSize - 1
	}
	if start > end {
		start = 0
		end = fileSize - 1
	}

	return start, end
}

// DeleteFile 删除文件
func (h *UploadHandler) DeleteFile(c *gin.Context) {
	filePath := c.Param("filepath")
	filePath = strings.TrimPrefix(filePath, "/")

	if err := h.storage.DeleteObject(filePath); err != nil {
		response.Fail(c, http.StatusInternalServerError, "删除失败")
		return
	}

	response.OKWithMsg(c, "删除成功", nil)
}

// GetStorageStatus 获取存储状态
func (h *UploadHandler) GetStorageStatus(c *gin.Context) {
	status := map[string]interface{}{
		"type":      h.storage.GetType(),
		"available": h.storage.IsAvailable(),
	}

	// 如果是降级存储，获取详细信息
	if fallback, ok := h.storage.(*storage.FallbackStorage); ok {
		status = fallback.GetStatus()
	}

	response.OK(c, status)
}

// GetVideoStatus 获取视频转码任务状态
func (h *UploadHandler) GetVideoStatus(c *gin.Context) {
	taskID := c.Param("taskId")
	if taskID == "" {
		response.Fail(c, http.StatusBadRequest, "缺少 task_id")
		return
	}

	task, ok := h.transcodeService.GetTask(taskID)
	if !ok {
		response.Fail(c, http.StatusNotFound, "任务不存在或已过期")
		return
	}

	response.OK(c, task)
}

// DeleteCanvasDir 删除画布目录
func (h *UploadHandler) DeleteCanvasDir(c *gin.Context) {
	projectID := c.Param("projectId")
	if projectID == "" || projectID == "." || projectID == ".." {
		response.Fail(c, http.StatusBadRequest, "无效的项目 ID")
		return
	}

	// 删除整个canvas目录下的projectID文件夹
	prefix := "canvas/" + projectID + "/"
	if err := h.storage.DeleteObjectsByPrefix(prefix); err != nil {
		response.Fail(c, http.StatusInternalServerError, fmt.Sprintf("删除目录失败: %v", err))
		return
	}

	response.OKWithMsg(c, "目录已删除", nil)
}
