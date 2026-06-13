package handler

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
)

// SyncStorage 同步本地存储到MinIO
func (h *UploadHandler) SyncStorage(c *gin.Context) {
	// 只对降级存储有效
	fallback, ok := h.storage.(*storage.FallbackStorage)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "当前存储不支持同步（非降级模式）",
		})
		return
	}

	// 获取本地存储实例
	localStorage, ok := fallback.Fallback.(*storage.LocalStorage)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "降级存储的Fallback不是LocalStorage",
		})
		return
	}

	// 扫描本地文件
	files, err := localStorage.ListObjects("")
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "扫描本地文件失败: " + err.Error(),
		})
		return
	}

	log.Printf("🔄 开始同步 %d 个文件到MinIO...", len(files))

	syncResults := make([]map[string]interface{}, 0)
	successCount := 0
	failCount := 0

	for _, objectName := range files {
		// 检查MinIO是否已有该文件
		_, err := fallback.Primary.StatObject(objectName)
		if err == nil {
			log.Printf("⏭️ MinIO已有文件，跳过: %s", objectName)
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "skipped",
				"reason": "already_exists",
			})
			continue
		}

		// 从本地获取文件
		reader, err := localStorage.GetObject(objectName)
		if err != nil {
			log.Printf("❌ 本地文件不存在: %s - %v", objectName, err)
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "failed",
				"error":  err.Error(),
			})
			failCount++
			continue
		}

		// 获取文件信息
		info, err := localStorage.StatObject(objectName)
		if err != nil {
			reader.Close()
			failCount++
			continue
		}

		// 上传到MinIO
		err = fallback.Primary.PutObject(objectName, reader, info.Size, info.ContentType)
		reader.Close()

		if err != nil {
			log.Printf("❌ 同步失败: %s - %v", objectName, err)
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "failed",
				"error":  err.Error(),
			})
			failCount++
		} else {
			log.Printf("✅ 同步成功: %s", objectName)
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "success",
				"size":   info.Size,
			})
			successCount++
		}
	}

	log.Printf("🔄 同步完成: 成功 %d, 失败 %d, 跳过 %d",
		successCount, failCount, len(files)-successCount-failCount)

	c.JSON(http.StatusOK, gin.H{
		"total_files":   len(files),
		"success_count": successCount,
		"fail_count":    failCount,
		"skip_count":    len(files) - successCount - failCount,
		"results":       syncResults,
	})
}

// SyncFromVolume 从Docker volume同步文件（管理员专用）
func (h *UploadHandler) SyncFromVolume(c *gin.Context) {
	volumePath := c.Query("volume_path")
	if volumePath == "" {
		volumePath = "/var/lib/docker/volumes/libtv_public-data/_data"
	}

	// 检查目录是否存在
	if _, err := os.Stat(volumePath); os.IsNotExist(err) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "volume目录不存在: " + volumePath,
		})
		return
	}

	// 扫描volume目录
	files := make([]string, 0)
	err := filepath.Walk(volumePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() {
			// 获取相对路径
			relPath := strings.TrimPrefix(path, volumePath)
			relPath = strings.TrimPrefix(relPath, "/")
			files = append(files, relPath)
		}

		return nil
	})

	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "扫描volume失败: " + err.Error(),
		})
		return
	}

	log.Printf("🔄 从volume同步 %d 个文件...", len(files))

	syncResults := make([]map[string]interface{}, 0)
	successCount := 0
	failCount := 0

	for _, objectName := range files {
		fullPath := filepath.Join(volumePath, objectName)

		// 打开文件
		file, err := os.Open(fullPath)
		if err != nil {
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "failed",
				"error":  err.Error(),
			})
			failCount++
			continue
		}

		// 获取文件信息
		fileInfo, err := file.Stat()
		if err != nil {
			file.Close()
			failCount++
			continue
		}

		// 判断Content-Type
		contentType := "application/octet-stream"
		ext := filepath.Ext(objectName)
		if strings.Contains(ext, "jpg") || strings.Contains(ext, "jpeg") {
			contentType = "image/jpeg"
		} else if strings.Contains(ext, "png") {
			contentType = "image/png"
		} else if strings.Contains(ext, "webp") {
			contentType = "image/webp"
		} else if strings.Contains(ext, "mp4") {
			contentType = "video/mp4"
		}

		// 上传到存储
		err = h.storage.PutObject(objectName, file, fileInfo.Size(), contentType)
		file.Close()

		if err != nil {
			log.Printf("❌ 同步失败: %s - %v", objectName, err)
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "failed",
				"error":  err.Error(),
			})
			failCount++
		} else {
			log.Printf("✅ 同步成功: %s (%d bytes)", objectName, fileInfo.Size())
			syncResults = append(syncResults, map[string]interface{}{
				"file":   objectName,
				"status": "success",
				"size":   fileInfo.Size(),
			})
			successCount++
		}
	}

	log.Printf("🔄 同步完成: 成功 %d, 失败 %d", successCount, failCount)

	c.JSON(http.StatusOK, gin.H{
		"volume_path":   volumePath,
		"total_files":   len(files),
		"success_count": successCount,
		"fail_count":    failCount,
		"results":       syncResults,
	})
}