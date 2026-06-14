package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
)

// UploadHandler 上传处理器（支持MinIO降级）
type UploadHandler struct {
	storage storage.Storage
}

// NewUploadHandler 创建上传处理器
func NewUploadHandler(s storage.Storage) *UploadHandler {
	return &UploadHandler{storage: s}
}

// ========== 视频异步转码任务管理 ==========

type VideoTaskStatus string

const (
	TaskStatusProcessing VideoTaskStatus = "processing" // 转码中
	TaskStatusDone       VideoTaskStatus = "done"       // 完成
	TaskStatusFailed     VideoTaskStatus = "failed"     // 失败
)

type VideoTask struct {
	Status     VideoTaskStatus `json:"status"`
	URL        string          `json:"url,omitempty"`
	Compressed bool            `json:"compressed"`
	Error      string          `json:"error,omitempty"`
	CreatedAt  time.Time       `json:"created_at"`
}

var (
	videoTasks   = make(map[string]*VideoTask)
	videoTasksMu sync.RWMutex
)

// ========== 视频格式转换（独立函数） ==========

// findFFmpeg 返回 ffmpeg 路径
// 本地开发环境使用 Homebrew 完整版，线上 Docker 使用系统自带
func findFFmpeg() string {
	localPath := "/usr/local/Cellar/ffmpeg/8.1.1/bin/ffmpeg"
	if _, err := os.Stat(localPath); err == nil {
		return localPath
	}
	return "ffmpeg"
}

// ConvertVideoConfig 视频转码配置
type ConvertVideoConfig struct {
	InputPath  string            // 输入文件路径
	OutputPath string            // 输出文件路径
	Format     string            // 输出格式，如 "mp4"
	VideoCodec string            // 视频编码，如 "libx264"
	AudioCodec string            // 音频编码，如 "aac"
	ExtraArgs  []string          // 额外 ffmpeg 参数
	OnProgress func(percent int) // 进度回调（可选）
}

// ConvertVideo 使用 ffmpeg 将视频文件转换为指定格式
// 这是一个纯函数，不涉及存储/网络，只负责本地文件转换
func ConvertVideo(cfg ConvertVideoConfig) error {
	args := []string{"-y", "-i", cfg.InputPath}
	if cfg.VideoCodec != "" {
		args = append(args, "-c:v", cfg.VideoCodec)
	}
	if cfg.AudioCodec != "" {
		args = append(args, "-c:a", cfg.AudioCodec)
	}
	if len(cfg.ExtraArgs) > 0 {
		args = append(args, cfg.ExtraArgs...)
	}
	args = append(args, cfg.OutputPath)

	cmd := exec.Command(findFFmpeg(), args...)
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// NeedConvert 判断扩展名是否需要转码为 MP4
func NeedConvert(ext string) bool {
	switch ext {
	case ".ts", ".flv", ".m3u8", ".mkv", ".avi", ".wmv":
		return true
	default:
		return false
	}
}

// UploadVideo 上传视频（哈希去重，按项目ID分文件夹，TS自动转MP4）
func (h *UploadHandler) UploadVideo(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "获取文件失败"})
		return
	}

	projectID := c.PostForm("project_id")

	// 第一步：计算哈希用于去重
	hasher := sha256.New()
	io.Copy(hasher, file)
	file.Close()
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".mp4"
	}
	filename := fileHash[:12] + ext

	var objectName string
	if projectID != "" {
		objectName = "canvas/" + projectID + "/" + filename
	} else {
		objectName = "videos/" + filename
	}

	// 检查文件是否已存在（含已转码的 MP4 版本）
	mp4ObjectName := strings.TrimSuffix(objectName, filepath.Ext(objectName)) + ".mp4"
	_, err = h.storage.StatObject(mp4ObjectName)
	if err == nil {
		url := h.storage.GetURL(mp4ObjectName)
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "上传成功（已存在）",
			"data": gin.H{
				"url":          url,
				"storage_type": h.storage.GetType(),
				"filename":     mp4ObjectName,
				"cached":       true,
			},
		})
		return
	}

	// 重新打开文件
	src2, err := header.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src2.Close()

	// 判断是否需要转码
	if !NeedConvert(ext) {
		// === 不需要转码：直接存储原文件 ===
		err = h.storage.PutObject(objectName, src2, header.Size, "video/mp4")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "上传失败"})
			return
		}
		url := h.storage.GetURL(objectName)
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "上传成功",
			"data": gin.H{
				"url":          url,
				"storage_type": h.storage.GetType(),
				"filename":     objectName,
			},
		})
		return
	}

	// === 需要转码：保存到临时目录，异步 ffmpeg 转 MP4 ===
	tmpDir := "/tmp/libtv_convert"
	os.MkdirAll(tmpDir, 0755)
	tmpPath := tmpDir + "/" + filename

	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建临时文件失败"})
		return
	}
	io.Copy(tmpFile, src2)
	tmpFile.Close()

	taskID := fileHash[:16]
	videoTasksMu.Lock()
	videoTasks[taskID] = &VideoTask{Status: TaskStatusProcessing}
	videoTasksMu.Unlock()

	go h.convertAndUpload(taskID, tmpPath, mp4ObjectName)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功，正在转码",
		"data": gin.H{
			"url":      "",
			"task_id":  taskID,
			"filename": mp4ObjectName,
		},
	})
}

// convertAndUpload 异步转码并上传到存储
// 职责：调用 ConvertVideo（纯转换）→ 上传结果 → 更新任务状态
func (h *UploadHandler) convertAndUpload(taskID, inputPath, outputObjectName string) {
	outputPath := inputPath + ".mp4"

	// 1. 调用独立转换函数
	err := ConvertVideo(ConvertVideoConfig{
		InputPath:  inputPath,
		OutputPath: outputPath,
		Format:     "mp4",
		VideoCodec: "libx264",
		AudioCodec: "aac",
		ExtraArgs:  []string{"-crf", "23", "-preset", "ultrafast", "-b:a", "128k", "-movflags", "+faststart"},
	})

	// 清理输入文件
	os.Remove(inputPath)

	if err != nil {
		setTaskFailed(taskID, fmt.Sprintf("ffmpeg 转码失败: %v", err))
		return
	}

	// 2. 上传到存储
	f, err := os.Open(outputPath)
	if err != nil {
		os.Remove(outputPath)
		setTaskFailed(taskID, fmt.Sprintf("打开转码后文件失败: %v", err))
		return
	}
	fi, _ := f.Stat()
	err = h.storage.PutObject(outputObjectName, f, fi.Size(), "video/mp4")
	f.Close()
	os.Remove(outputPath) // 清理输出文件

	if err != nil {
		setTaskFailed(taskID, fmt.Sprintf("上传转码后文件失败: %v", err))
		return
	}

	// 3. 完成
	url := h.storage.GetURL(outputObjectName)
	videoTasksMu.Lock()
	if task, ok := videoTasks[taskID]; ok {
		task.Status = TaskStatusDone
		task.URL = url
		task.Compressed = false
	}
	videoTasksMu.Unlock()
}

func setTaskFailed(taskID string, errMsg string) {
	videoTasksMu.Lock()
	defer videoTasksMu.Unlock()
	if task, ok := videoTasks[taskID]; ok {
		task.Status = TaskStatusFailed
		task.Error = errMsg
	}
}

// UploadCanvas 上传画布图片（哈希去重，按项目ID分文件夹）
func (h *UploadHandler) UploadCanvas(c *gin.Context) {
	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "获取文件失败"})
		return
	}

	// 获取项目ID（可选参数，用于分文件夹）
	projectID := c.PostForm("project_id")

	// 第一步：计算哈希用于去重
	hasher := sha256.New()
	io.Copy(hasher, file)
	file.Close()
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	// 用哈希前12位 + 扩展名作为文件名
	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".png"
	}
	filename := fileHash[:12] + ext

	// 根据项目ID确定存储路径
	var objectName string
	if projectID != "" {
		objectName = "canvas/" + projectID + "/" + filename
	} else {
		objectName = "canvas/" + filename
	}

	// 检查文件是否已存在（通过StatObject）
	_, err = h.storage.StatObject(objectName)
	if err == nil {
		// 文件已存在，直接返回已有路径
		url := h.storage.GetURL(objectName)
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "上传成功（已存在）",
			"data": gin.H{
				"url":          url,
				"storage_type": h.storage.GetType(),
				"filename":     objectName,
				"cached":       true,
			},
		})
		return
	}

	// 第二步：重新打开文件进行上传
	src2, err := header.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src2.Close()

	// 判断Content-Type
	contentType := "image/png"
	if strings.ToLower(ext) == ".jpg" || strings.ToLower(ext) == ".jpeg" {
		contentType = "image/jpeg"
	}

	// 上传到存储（自动降级）
	err = h.storage.PutObject(objectName, src2, header.Size, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "上传失败"})
		return
	}

	// 返回URL（标准响应格式）
	url := h.storage.GetURL(objectName)
	storageType := h.storage.GetType()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功",
		"data": gin.H{
			"url":          url,
			"storage_type": storageType,
			"filename":     objectName,
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

	// 获取项目ID（可选参数，用于画布上传）
	projectID := c.PostForm("project_id")

	// 第一步：计算哈希用于去重
	hasher := sha256.New()
	io.Copy(hasher, file)
	file.Close()
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	// 用哈希前12位 + 扩展名作为文件名
	ext := filepath.Ext(header.Filename)
	filename := fileHash[:12] + ext

	// 根据项目ID确定存储路径
	var objectName string
	if projectID != "" {
		// 有项目ID：存储到 canvas/项目ID/ 目录（画布上传）
		objectName = "canvas/" + projectID + "/" + filename
	} else {
		// 无项目ID：存储到 images/ 目录（通用图片上传）
		objectName = "images/" + filename
	}

	// 检查文件是否已存在（通过StatObject）
	_, err = h.storage.StatObject(objectName)
	if err == nil {
		// 文件已存在，直接返回已有路径
		url := h.storage.GetURL(objectName)
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "上传成功（已存在）",
			"data": gin.H{
				"url":          url,
				"storage_type": h.storage.GetType(),
				"filename":     objectName,
				"cached":       true,
			},
		})
		return
	}

	// 第二步：重新打开文件进行上传
	src2, err := header.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src2.Close()

	// 判断Content-Type
	contentType := "image/png"
	if strings.ToLower(ext) == ".jpg" || strings.ToLower(ext) == ".jpeg" {
		contentType = "image/jpeg"
	} else if strings.ToLower(ext) == ".gif" {
		contentType = "image/gif"
	} else if strings.ToLower(ext) == ".webp" {
		contentType = "image/webp"
	}

	// 上传到存储（自动降级）
	err = h.storage.PutObject(objectName, src2, header.Size, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "上传失败"})
		return
	}

	// 返回URL（标准响应格式）
	url := h.storage.GetURL(objectName)
	storageType := h.storage.GetType()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功",
		"data": gin.H{
			"url":          url,
			"storage_type": storageType,
			"filename":     objectName,
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

	hasher := sha256.New()
	io.Copy(hasher, file)
	file.Close()
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	ext := filepath.Ext(header.Filename)
	if ext == "" {
		ext = ".mp3"
	}
	filename := fileHash[:12] + ext

	var objectName string
	if projectID != "" {
		objectName = "canvas/" + projectID + "/" + filename
	} else {
		objectName = "audio/" + filename
	}

	_, err = h.storage.StatObject(objectName)
	if err == nil {
		url := h.storage.GetURL(objectName)
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "上传成功（已存在）",
			"data": gin.H{
				"url":          url,
				"storage_type": h.storage.GetType(),
				"filename":     objectName,
				"cached":       true,
			},
		})
		return
	}

	src2, err := header.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src2.Close()

	contentType := "audio/mpeg"
	switch strings.ToLower(ext) {
	case ".wav":
		contentType = "audio/wav"
	case ".ogg":
		contentType = "audio/ogg"
	case ".m4a":
		contentType = "audio/mp4"
	case ".flac":
		contentType = "audio/flac"
	}

	err = h.storage.PutObject(objectName, src2, header.Size, contentType)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "上传失败"})
		return
	}

	url := h.storage.GetURL(objectName)
	storageType := h.storage.GetType()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "上传成功",
		"data": gin.H{
			"url":          url,
			"storage_type": storageType,
			"filename":     objectName,
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

	videoTasksMu.RLock()
	task, ok := videoTasks[taskID]
	videoTasksMu.RUnlock()

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