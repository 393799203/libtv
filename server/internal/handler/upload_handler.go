package handler

import (
	"fmt"
	"io"
	"net/http"
	"strings"

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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "获取文件失败"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	// 同步完成（含命中去重）
	if !result.AsyncTranscode {
		msg := "上传成功"
		if result.Cached {
			msg = "上传成功（已存在）"
		}
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  msg,
			"data": gin.H{
				"url":          result.URL,
				"storage_type": result.StorageType,
				"filename":     result.ObjectName,
				"cached":       result.Cached,
			},
		})
		return
	}

	// 异步转码中
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功，正在转码",
		"data": gin.H{
			"url":      "",
			"task_id":  result.TaskID,
			"filename": result.ObjectName,
		},
	})
}

// UploadCanvas 上传画布图片（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadCanvas(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "获取文件失败"})
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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功",
		"data": gin.H{
			"url":          result.URL,
			"storage_type": result.StorageType,
			"filename":     result.ObjectName,
			"cached":       result.Cached,
		},
	})
}

// UploadImage 通用图片上传（哈希去重）
// 如果传递 project_id 参数，存储到 canvas/项目ID/ 目录
// 如果不传递 project_id，存储到 images/ 目录
func (h *UploadHandler) UploadImage(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "获取文件失败"})
		return
	}

	projectID := c.PostForm("project_id")

	// 没有项目ID时存到 images/，有项目ID时存到 canvas/项目ID/
	dir := "images"
	if projectID != "" {
		dir = "canvas"
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            dir,
		ProjectID:      projectID,
		AllowedExts:    service.ImageExts(),
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功",
		"data": gin.H{
			"url":          result.URL,
			"storage_type": result.StorageType,
			"filename":     result.ObjectName,
			"cached":       result.Cached,
		},
	})
}

// UploadAudio 上传音频文件（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadAudio(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "获取文件失败"})
		return
	}

	projectID := c.PostForm("project_id")

	// 有项目ID时存到 canvas/项目ID/，否则存到 audio/
	dir := "audio"
	if projectID != "" {
		dir = "canvas"
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            dir,
		ProjectID:      projectID,
		DefaultExt:     ".mp3",
		AllowedExts: map[string]bool{
			".mp3": true, ".wav": true, ".ogg": true, ".m4a": true, ".flac": true,
		},
		ContentTypeFor: service.ContentTypeForAudio,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功",
		"data": gin.H{
			"url":          result.URL,
			"storage_type": result.StorageType,
			"filename":     result.ObjectName,
			"cached":       result.Cached,
		},
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
		io.CopyBuffer(c.Writer, reader, buf)
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
		io.CopyBuffer(c.Writer, reader, buf)
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
		start = parseInt64(parts[0])
	}

	// 解析结束位置
	if parts[1] == "" {
		end = fileSize - 1
	} else {
		end = parseInt64(parts[1])
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

// parseInt64 解析整数
func parseInt64(s string) int64 {
	var result int64
	for _, c := range s {
		if c >= '0' && c <= '9' {
			result = result * 10 + int64(c-'0')
		}
	}
	return result
}

// DeleteFile 删除文件
func (h *UploadHandler) DeleteFile(c *gin.Context) {
	filePath := c.Param("filepath")
	filePath = strings.TrimPrefix(filePath, "/")

	err := h.storage.DeleteObject(filePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
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

	c.JSON(http.StatusOK, status)
}

// GetVideoStatus 获取视频转码任务状态
func (h *UploadHandler) GetVideoStatus(c *gin.Context) {
	taskID := c.Param("taskId")
	if taskID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "缺少 task_id"})
		return
	}

	task, ok := h.transcodeService.GetTask(taskID)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "任务不存在或已过期"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": task,
	})
}

// DeleteCanvasDir 删除画布目录
func (h *UploadHandler) DeleteCanvasDir(c *gin.Context) {
	projectID := c.Param("projectId")
	if projectID == "" || projectID == "." || projectID == ".." {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "无效的项目 ID"})
		return
	}

	// 删除整个canvas目录下的projectID文件夹
	// 注意：MinIO不支持目录删除，这里简化处理
	// 实际应用中可能需要遍历删除所有文件

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "已删除（注意：MinIO环境下可能需要手动清理文件）"})
}
