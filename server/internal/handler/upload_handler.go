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

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	uploadDir string
	videoDir  string
}

func NewUploadHandler(uploadDir, videoDir string) *UploadHandler {
	return &UploadHandler{uploadDir: uploadDir, videoDir: videoDir}
}

// UploadImage 上传图片到本地 canvas/ 目录，按项目 ID 分文件夹存储，相同内容不重复存储
func (h *UploadHandler) UploadImage(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	// 校验文件类型
	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}
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

// UploadVideo 独立上传视频文件到 videos/ 目录，不依赖 show ID
// >=50MB 的文件会自动用 ffmpeg 压缩（H.264 + AAC, CRF=23）
func (h *UploadHandler) UploadVideo(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择视频文件"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".mp4": true, ".webm": true, ".mov": true, ".avi": true, ".mkv": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不支持的视频格式，支持 mp4/webm/mov/avi/mkv"})
		return
	}

	if file.Size > 1024*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "视频大小不能超过 1GB"})
		return
	}

	if err := os.MkdirAll(h.videoDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建目录失败"})
		return
	}

	// 第一步：先算原始文件的哈希，用于查重
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
	savePath := filepath.Join(h.videoDir, filename)

	// 文件已存在 → 直接返回 URL（避免重复存储）
	if _, err := os.Stat(savePath); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"url":        "/media/videos/" + filename,
				"compressed": false,
				"cached":     true,
			},
		})
		return
	}

	// 第二步：新文件，先保存到临时路径
	tmpPath := filepath.Join(h.videoDir, ".tmp_"+file.Filename)
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

	finalPath := tmpPath
	compressed := false

	// 第三步：>=50MB 自动压缩
	if file.Size >= 50*1024*1024 {
		compressedPath := filepath.Join(h.videoDir, ".compressed_"+file.Filename)
		cmd := exec.Command("ffmpeg",
			"-i", tmpPath,
			"-c:v", "libx264", "-crf", "23", "-preset", "fast",
			"-c:a", "aac", "-b:a", "128k",
			"-movflags", "+faststart",
			"-y",
			compressedPath,
		)
		if err := cmd.Run(); err == nil {
			os.Remove(tmpPath)
			finalPath = compressedPath
			compressed = true
		}
	}

	// 第四步：移动到最终位置
	if err := os.Rename(finalPath, savePath); err != nil {
		os.Remove(finalPath)
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "保存失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"url":        "/media/videos/" + filename,
			"compressed": compressed,
			"cached":     false,
		},
	})
}
