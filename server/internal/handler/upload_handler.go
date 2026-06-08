package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

type UploadHandler struct {
	uploadDir string
}

func NewUploadHandler(uploadDir string) *UploadHandler {
	return &UploadHandler{uploadDir: uploadDir}
}

// UploadImage 上传图片到本地 pic/ 目录，相同内容不重复存储
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

	// 确保目录存在
	if err := os.MkdirAll(h.uploadDir, 0755); err != nil {
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
	savePath := filepath.Join(h.uploadDir, filename)

	// 文件已存在则直接返回已有路径
	if _, err := os.Stat(savePath); err == nil {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"msg":  "ok",
			"data": gin.H{
				"url": "/pic/" + filename,
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
			"url": "/pic/" + filename,
		},
	})
}
