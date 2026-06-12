package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	uploadDir string
	videoDir  string
}

func NewUploadHandler(uploadDir, videoDir string) *UploadHandler {
	return &UploadHandler{uploadDir: uploadDir, videoDir: videoDir}
}

// ========== 视频异步转码任务管理 ==========

type VideoTaskStatus string

const (
	TaskStatusProcessing VideoTaskStatus = "processing" // 转码中
	TaskStatusDone       VideoTaskStatus = "done"       // 完成
	TaskStatusFailed     VideoTaskStatus = "failed"     // 失败
)

type VideoTask struct {
	Status    VideoTaskStatus `json:"status"`
	URL       string          `json:"url,omitempty"`
	Compressed bool           `json:"compressed"`
	Error     string          `json:"error,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
}

var (
	videoTasks   = make(map[string]*VideoTask)
	videoTasksMu sync.RWMutex
)

// UploadImage 上传图片到本地 canvas/ 目录，按项目 ID 分文件夹存储，相同内容不重复存储
func (h *UploadHandler) UploadImage(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择图片文件"})
		return
	}

	// 校验文件类型
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webm": true, ".gif": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不支持的图片格式"})
		return
	}

	// 限制大小 10MB
	if file.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "图片大小不能超过 10MB"})
		return
	}

	// 获取项目 ID（可选参数，用于分文件夹）
	projectID := c.PostForm("project_id")

	var saveDir string
	var urlPrefix string
	if projectID != "" {
		saveDir = filepath.Join(h.uploadDir, projectID)
		urlPrefix = "/media/canvas/" + projectID + "/"
	} else {
		saveDir = h.uploadDir
		urlPrefix = "/media/canvas/"
	}

	// 确保目录存在
	if err := os.MkdirAll(saveDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建目录失败"})
		return
	}

	// 打开上传的文件计算内容哈希
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, src); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "计算哈希失败"})
		return
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	// 用哈希前12位 + 原始扩展名作为存储文件名，确保同内容去重
	filename := fileHash[:12] + ext
	savePath := filepath.Join(saveDir, filename)

	// 文件已存在则直接返回已有路径
	if _, err := os.Stat(savePath); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "ok",
			"data": gin.H{
				"url": urlPrefix + filename,
			},
		})
		return
	}

	// 需要重新打开文件来保存（io.Copy 后已读到末尾）
	src2, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src2.Close()

	dst, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建文件失败"})
		return
	}
	defer dst.Close()

	if _, err := io.Copy(dst, src2); err != nil {
		os.Remove(savePath)
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "保存失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "ok",
		"data": gin.H{
			"url": urlPrefix + filename,
		},
	})
}

// UploadVideo 异步视频上传：文件保存后立即返回 task_id，需要转码时后台执行 ffmpeg
func (h *UploadHandler) UploadVideo(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择视频文件"})
		return
	}

	projectID := c.PostForm("project_id")
	var saveDir string
	var urlPrefix string
	if projectID != "" && projectID != "." && projectID != ".." {
		saveDir = filepath.Join(h.uploadDir, projectID)
		urlPrefix = "/media/canvas/" + projectID + "/"
	} else {
		saveDir = h.videoDir
		urlPrefix = "/media/videos/"
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".mp4": true, ".webm": true, ".mov": true, ".avi": true, ".mkv": true, ".ts": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不支持的视频格式，支持 mp4/webm/mov/avi/mkv/ts"})
		return
	}

	if file.Size > 2*1024*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "视频大小不能超过 2GB"})
		return
	}

	if err := os.MkdirAll(saveDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建目录失败"})
		return
	}

	// 第一步：计算哈希用于查重
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	hasher := sha256.New()
	io.Copy(hasher, src)
	src.Close()
	fileHash := hex.EncodeToString(hasher.Sum(nil))
	filename := fileHash[:12] + ".mp4"
	savePath := filepath.Join(saveDir, filename)

	// 文件已存在 → 直接返回（无需转码）
	if _, err := os.Stat(savePath); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"url":        urlPrefix + filename,
				"task_id":    "",
				"compressed": false,
				"cached":     true,
			},
		})
		return
	}

	// 第二步：保存到临时路径
	tmpPath := filepath.Join(saveDir, ".tmp_"+file.Filename)
	src2, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		src2.Close()
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建临时文件失败"})
		return
	}
	io.Copy(tmpFile, src2)
	tmpFile.Close()
	src2.Close()

	needConvert := (ext == ".ts") || (file.Size >= 50*1024*1024)

	// 不需要转码 → 直接移动到最终位置并返回
	if !needConvert {
		if err := os.Rename(tmpPath, savePath); err != nil {
			os.Remove(tmpPath)
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "保存失败"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"url":        urlPrefix + filename,
				"task_id":    "",
				"compressed": false,
				"cached":     false,
			},
		})
		return
	}

	// 需要转码 → 创建任务，后台异步执行 ffmpeg
	taskID := fileHash[:16]
	compressedPath := filepath.Join(saveDir, ".compressed_"+filename)

	task := &VideoTask{
		Status:     TaskStatusProcessing,
		URL:        "",
		Compressed: false,
		Error:      "",
		CreatedAt:  time.Now(),
	}

	videoTasksMu.Lock()
	videoTasks[taskID] = task
	videoTasksMu.Unlock()

	// 异步执行 ffmpeg 转码
	go func() {
		cmd := exec.Command("/usr/local/Cellar/ffmpeg/8.1.1/bin/ffmpeg",
			"-i", tmpPath,
			"-f", "mp4",
			"-c:v", "libx264", "-crf", "23", "-preset", "ultrafast",
			"-c:a", "aac", "-b:a", "128k",
			"-movflags", "+faststart",
			"-y",
			compressedPath,
		)
		if err := cmd.Run(); err == nil {
			os.Remove(tmpPath)
			// 移动到最终位置
			if err := os.Rename(compressedPath, savePath); err != nil {
				os.Remove(compressedPath)
				videoTasksMu.Lock()
				task.Status = TaskStatusFailed
				task.Error = "保存转码结果失败"
				videoTasksMu.Unlock()
				return
			}
			videoTasksMu.Lock()
			task.Status = TaskStatusDone
			task.URL = urlPrefix + filename
			task.Compressed = true
			videoTasksMu.Unlock()
		} else if ext == ".ts" {
			os.Remove(tmpPath)
			videoTasksMu.Lock()
			task.Status = TaskStatusFailed
			task.Error = "TS 视频转码失败，请确认 ffmpeg 已安装"
			videoTasksMu.Unlock()
		} else {
			// 非TS 格式压缩失败 → 使用原始文件
			if err := os.Rename(tmpPath, savePath); err != nil {
				os.Remove(tmpPath)
				videoTasksMu.Lock()
				task.Status = TaskStatusFailed
				task.Error = "转码失败且原始文件也无法保存"
				videoTasksMu.Unlock()
				return
			}
			videoTasksMu.Lock()
			task.Status = TaskStatusDone
			task.URL = urlPrefix + filename
			task.Compressed = false
			videoTasksMu.Unlock()
		}

		// 清理残留临时文件
		files, _ := os.ReadDir(saveDir)
		for _, f := range files {
			if strings.HasPrefix(f.Name(), "ts_segment") {
				os.Remove(filepath.Join(saveDir, f.Name()))
			}
		}
	}()

	// 立即返回任务 ID，前端轮询状态
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"url":        "", // 转码完成后通过 status 接口获取
			"task_id":    taskID,
			"compressed": false,
			"cached":     false,
		},
	})
}

// GetVideoStatus 查询视频转码任务状态
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

// DeleteCanvasDir 删除指定项目的 canvas 文件夹
func (h *UploadHandler) DeleteCanvasDir(c *gin.Context) {
	projectID := c.Param("projectId")
	if projectID == "" || projectID == "." || projectID == ".." {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "无效的项目 ID"})
		return
	}

	dir := filepath.Join(h.uploadDir, projectID)
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "目录不存在，无需删除"})
		return
	}

	if err := os.RemoveAll(dir); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "删除失败: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "已删除"})
}
