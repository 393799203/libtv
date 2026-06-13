package storage

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"sync"
	"time"
)

// FallbackStorage 降级存储（MinIO优先，本地降级）
type FallbackStorage struct {
	Primary   Storage // MinIO（优先）
	Fallback  Storage // 本地存储（降级）
	mu        sync.Mutex
	syncQueue []string // 待同步文件队列
}

// NewFallbackStorage 创建降级存储
func NewFallbackStorage(primary, fallback Storage) *FallbackStorage {
	fs := &FallbackStorage{
		Primary:  primary,
		Fallback: fallback,
	}

	// 启动后台同步服务
	go fs.startSyncService()

	log.Printf("✅ 降级存储初始化成功 (Primary: %s, Fallback: %s)",
		primary.GetType(), fallback.GetType())

	return fs
}

// IsAvailable 检查存储是否可用
func (f *FallbackStorage) IsAvailable() bool {
	// 只要有一个可用就返回true
	return f.Primary.IsAvailable() || f.Fallback.IsAvailable()
}

// GetType 获取当前使用的存储类型
func (f *FallbackStorage) GetType() string {
	if f.Primary.IsAvailable() {
		return "minio"
	}
	return "local"
}

// PutObject 上传文件（优先MinIO，降级本地）
func (f *FallbackStorage) PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error {
	// 缓存reader数据（因为可能需要重试）
	buf := &bytes.Buffer{}
	teeReader := io.TeeReader(reader, buf)

	// 优先尝试MinIO
	if f.Primary.IsAvailable() {
		err := f.Primary.PutObject(objectName, teeReader, objectSize, contentType)
		if err == nil {
			log.Printf("✅ 文件上传到MinIO成功: %s", objectName)
			return nil
		}

		log.Printf("⚠️ MinIO上传失败，降级到本地存储: %v", err)
	}

	// 降级到本地存储
	err := f.Fallback.PutObject(objectName, buf, objectSize, contentType)
	if err != nil {
		log.Printf("❌ 本地存储上传也失败: %v", err)
		return fmt.Errorf("存储失败: %w", err)
	}

	log.Printf("✅ 文件降级存储到本地成功: %s", objectName)

	// 添加到同步队列（MinIO恢复后同步）
	f.addToSyncQueue(objectName)

	return nil
}

// GetObject 获取文件（优先MinIO，降级本地）
func (f *FallbackStorage) GetObject(objectName string) (io.ReadCloser, error) {
	// 优先从MinIO获取
	if f.Primary.IsAvailable() {
		reader, err := f.Primary.GetObject(objectName)
		if err == nil {
			return reader, nil
		}

		log.Printf("⚠️ MinIO获取失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.GetObject(objectName)
}

// GetObjectRange 获取文件指定范围（优先MinIO，降级本地）
func (f *FallbackStorage) GetObjectRange(objectName string, start, end int64) (io.ReadCloser, error) {
	// 优先从MinIO获取
	if f.Primary.IsAvailable() {
		reader, err := f.Primary.GetObjectRange(objectName, start, end)
		if err == nil {
			return reader, nil
		}

		log.Printf("⚠️ MinIO获取范围失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.GetObjectRange(objectName, start, end)
}

// DeleteObject 删除文件（两个存储都删除）
func (f *FallbackStorage) DeleteObject(objectName string) error {
	var errors []error

	// 删除MinIO中的文件
	if f.Primary.IsAvailable() {
		if err := f.Primary.DeleteObject(objectName); err != nil {
			errors = append(errors, fmt.Errorf("MinIO删除失败: %w", err))
		}
	}

	// 删除本地存储中的文件
	if err := f.Fallback.DeleteObject(objectName); err != nil {
		errors = append(errors, fmt.Errorf("本地删除失败: %w", err))
	}

	if len(errors) > 0 {
		return fmt.Errorf("删除失败: %v", errors)
	}

	log.Printf("✅ 文件删除成功: %s", objectName)
	return nil
}

// StatObject 获取文件信息（优先MinIO，降级本地）
func (f *FallbackStorage) StatObject(objectName string) (ObjectInfo, error) {
	// 优先从MinIO获取
	if f.Primary.IsAvailable() {
		info, err := f.Primary.StatObject(objectName)
		if err == nil {
			return info, nil
		}

		log.Printf("⚠️ MinIO获取信息失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.StatObject(objectName)
}

// GetURL 获取访问URL
func (f *FallbackStorage) GetURL(objectName string) string {
	// 如果MinIO可用，返回MinIO的公网URL
	if f.Primary.IsAvailable() {
		return f.Primary.GetURL(objectName)
	}
	// MinIO不可用时，返回本地存储路径
	return f.Fallback.GetURL(objectName)
}

// addToSyncQueue 添加到同步队列
func (f *FallbackStorage) addToSyncQueue(objectName string) {
	f.mu.Lock()
	f.syncQueue = append(f.syncQueue, objectName)
	f.mu.Unlock()
}

// startSyncService 启动后台同步服务
func (f *FallbackStorage) startSyncService() {
	ticker := time.NewTicker(30 * time.Second)

	for range ticker.C {
		// 检查MinIO是否恢复
		if !f.Primary.IsAvailable() {
			continue
		}

		// 同步队列中的文件
		f.syncPendingFiles()
	}
}

// syncPendingFiles 同步待处理的文件
func (f *FallbackStorage) syncPendingFiles() {
	f.mu.Lock()
	queue := f.syncQueue
	f.syncQueue = nil
	f.mu.Unlock()

	if len(queue) == 0 {
		return
	}

	log.Printf("🔄 开始同步 %d 个文件到MinIO...", len(queue))

	for _, objectName := range queue {
		// 检查MinIO是否已有该文件
		_, err := f.Primary.StatObject(objectName)
		if err == nil {
			log.Printf("⏭️ MinIO已有文件，跳过: %s", objectName)
			continue
		}

		// 从本地获取文件
		reader, err := f.Fallback.GetObject(objectName)
		if err != nil {
			log.Printf("❌ 本地文件不存在，跳过: %s", objectName)
			continue
		}

		// 获取文件信息
		info, err := f.Fallback.StatObject(objectName)
		if err != nil {
			reader.Close()
			continue
		}

		// 上传到MinIO
		err = f.Primary.PutObject(objectName, reader, info.Size, info.ContentType)
		reader.Close()

		if err != nil {
			log.Printf("❌ 同步失败: %s - %v", objectName, err)
			// 重新添加到队列
			f.addToSyncQueue(objectName)
		} else {
			log.Printf("✅ 同步成功: %s", objectName)
		}
	}

	log.Printf("🔄 同步完成")
}

// GetStatus 获取存储状态
func (f *FallbackStorage) GetStatus() map[string]interface{} {
	return map[string]interface{}{
		"primary_available":   f.Primary.IsAvailable(),
		"fallback_available":  f.Fallback.IsAvailable(),
		"current_type":        f.GetType(),
		"primary_type":        f.Primary.GetType(),
		"fallback_type":       f.Fallback.GetType(),
		"pending_sync_count":  len(f.syncQueue),
	}
}