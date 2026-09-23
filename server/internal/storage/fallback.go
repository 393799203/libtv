package storage

import (
	"bytes"
	"fmt"
	"io"
	"log"
	"sync"
	"time"

	"libtv/internal/config"
)

// FallbackStorage 降级存储（云存储优先，本地降级）
type FallbackStorage struct {
	Primary   Storage // 云存储（ZOS/MinIO，优先）
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

func init() {
	Register("fallback", func(cfg config.StorageConfig, publicDir string) (Storage, error) {
		// 本地存储作为兜底（必须成功）
		basePath := cfg.Local.BasePath
		if basePath == "" {
			basePath = publicDir
		}
		localStorage, err2 := NewLocalStorage(basePath)
		if err2 != nil {
			return nil, fmt.Errorf("本地存储初始化失败: %w", err2)
		}

		// 云存储优先：配置了 ZOS 就用 ZOS，否则退回 MinIO
		// （ZOS/MinIO 都兼容 S3 协议，同一套 minio-go 客户端）
		var primary Storage
		var primaryErr error
		if cfg.ZOS.Endpoint != "" && cfg.ZOS.AccessKey != "" && cfg.ZOS.Bucket != "" {
			primary, primaryErr = NewZOSStorage(&ZOSConfig{
				Endpoint:       cfg.ZOS.Endpoint,
				AccessKey:      cfg.ZOS.AccessKey,
				SecretKey:      cfg.ZOS.SecretKey,
				Bucket:         cfg.ZOS.Bucket,
				UseSSL:         cfg.ZOS.UseSSL,
				PublicEndpoint: cfg.ZOS.PublicEndpoint,
				CheckInterval:  parseCheckInterval(cfg.ZOS.CheckInterval),
			})
		} else {
			primary, primaryErr = NewMinIOStorage(&MinIOConfig{
				Endpoint:       cfg.MinIO.Endpoint,
				AccessKey:      cfg.MinIO.AccessKey,
				SecretKey:      cfg.MinIO.SecretKey,
				Bucket:         cfg.MinIO.Bucket,
				UseSSL:         cfg.MinIO.UseSSL,
				PublicEndpoint: cfg.MinIO.PublicEndpoint,
				CheckInterval:  parseCheckInterval(cfg.MinIO.CheckInterval),
			})
		}

		// 云存储失败：只使用本地
		if primaryErr != nil {
			log.Printf("⚠️ 云存储初始化失败，只使用本地存储: %v", primaryErr)
			return localStorage, nil
		}

		// 云存储成功：使用降级存储
		return NewFallbackStorage(primary, localStorage), nil
	})
}

// IsAvailable 检查存储是否可用
func (f *FallbackStorage) IsAvailable() bool {
	// 只要有一个可用就返回true
	return f.Primary.IsAvailable() || f.Fallback.IsAvailable()
}

// GetType 获取当前使用的存储类型（云存储为 zos/minio，降级为 local）
func (f *FallbackStorage) GetType() string {
	if f.Primary.IsAvailable() {
		return f.Primary.GetType()
	}
	return "local"
}

// PutObject 上传文件（优先云存储，降级本地）
func (f *FallbackStorage) PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error {
	// 缓存reader数据（因为可能需要重试）
	buf := &bytes.Buffer{}
	teeReader := io.TeeReader(reader, buf)

	// 优先尝试云存储
	if f.Primary.IsAvailable() {
		err := f.Primary.PutObject(objectName, teeReader, objectSize, contentType)
		if err == nil {
			log.Printf("✅ 文件上传到云存储成功: %s", objectName)
			return nil
		}

		log.Printf("⚠️ 云存储上传失败，降级到本地存储: %v", err)
	}

	// 降级到本地存储
	err := f.Fallback.PutObject(objectName, buf, objectSize, contentType)
	if err != nil {
		log.Printf("❌ 本地存储上传也失败: %v", err)
		return fmt.Errorf("存储失败: %w", err)
	}

	log.Printf("✅ 文件降级存储到本地成功: %s", objectName)

	// 添加到同步队列（云存储恢复后同步）
	f.addToSyncQueue(objectName)

	return nil
}

// GetObject 获取文件（优先云存储，降级本地）
func (f *FallbackStorage) GetObject(objectName string) (io.ReadCloser, error) {
	// 优先从云存储获取
	if f.Primary.IsAvailable() {
		reader, err := f.Primary.GetObject(objectName)
		if err == nil {
			return reader, nil
		}

		log.Printf("⚠️ 云存储获取失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.GetObject(objectName)
}

// GetObjectRange 获取文件指定范围（优先云存储，降级本地）
func (f *FallbackStorage) GetObjectRange(objectName string, start, end int64) (io.ReadCloser, error) {
	// 优先从云存储获取
	if f.Primary.IsAvailable() {
		reader, err := f.Primary.GetObjectRange(objectName, start, end)
		if err == nil {
			return reader, nil
		}

		log.Printf("⚠️ 云存储获取范围失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.GetObjectRange(objectName, start, end)
}

// DeleteObject 删除文件（两个存储都删除）
// 注意：云存储删除不受健康检查开关限制——否则探测瞬时不可用会导致文件静默泄漏
func (f *FallbackStorage) DeleteObject(objectName string) error {
	var errors []error

	// 删除云存储中的文件（无论健康检查状态都尝试，真不可用时会返回错误并记录）
	if err := f.Primary.DeleteObject(objectName); err != nil {
		errors = append(errors, fmt.Errorf("云存储删除失败: %w", err))
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

// StatObject 获取文件信息（优先云存储，降级本地）
func (f *FallbackStorage) StatObject(objectName string) (ObjectInfo, error) {
	// 优先从云存储获取
	if f.Primary.IsAvailable() {
		info, err := f.Primary.StatObject(objectName)
		if err == nil {
			return info, nil
		}

		log.Printf("⚠️ 云存储获取信息失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.StatObject(objectName)
}

// GetURL 获取访问URL
func (f *FallbackStorage) GetURL(objectName string) string {
	// 如果云存储可用，返回云存储的公网URL
	if f.Primary.IsAvailable() {
		return f.Primary.GetURL(objectName)
	}
	// 云存储不可用时，返回本地存储路径
	return f.Fallback.GetURL(objectName)
}

// ParseObjectName 从访问 URL 反解出 objectName
// 同时尝试 Primary 与 Fallback 的格式，任一匹配即返回
func (f *FallbackStorage) ParseObjectName(url string) (string, bool) {
	// 优先用 Primary 解析（实际生成的 URL 通常由 Primary 决定）
	if name, ok := f.Primary.ParseObjectName(url); ok {
		return name, true
	}
	return f.Fallback.ParseObjectName(url)
}

// ListObjects 列出指定前缀的所有文件（优先云存储，降级本地）
func (f *FallbackStorage) ListObjects(prefix string) ([]string, error) {
	// 优先从MinIO列出
	if f.Primary.IsAvailable() {
		objects, err := f.Primary.ListObjects(prefix)
		if err == nil {
			return objects, nil
		}
		log.Printf("⚠️ 云存储列出文件失败，尝试本地存储: %v", err)
	}

	// 降级到本地存储
	return f.Fallback.ListObjects(prefix)
}

// DeleteObjectsByPrefix 删除指定前缀的所有文件（两个存储都删除）
// 注意：云存储删除不受健康检查开关限制——否则探测瞬时不可用会导致目录静默泄漏
func (f *FallbackStorage) DeleteObjectsByPrefix(prefix string) error {
	var errors []error

	log.Printf("[FallbackStorage] 开始删除目录: prefix=%s", prefix)

	// 删除云存储中的文件（无论健康检查状态都尝试，真不可用时会返回错误并记录）
	if err := f.Primary.DeleteObjectsByPrefix(prefix); err != nil {
		errors = append(errors, fmt.Errorf("云存储删除目录失败: %w", err))
		log.Printf("[FallbackStorage] 云存储删除失败: prefix=%s err=%v", prefix, err)
	} else {
		log.Printf("[FallbackStorage] 云存储删除成功: prefix=%s", prefix)
	}

	// 删除本地存储中的文件
	if err := f.Fallback.DeleteObjectsByPrefix(prefix); err != nil {
		errors = append(errors, fmt.Errorf("本地删除目录失败: %w", err))
		log.Printf("[FallbackStorage] 本地删除失败: prefix=%s err=%v", prefix, err)
	} else {
		log.Printf("[FallbackStorage] 本地删除成功: prefix=%s", prefix)
	}

	if len(errors) > 0 {
		return fmt.Errorf("删除目录失败: %v", errors)
	}

	log.Printf("[FallbackStorage] 目录删除完成: prefix=%s", prefix)
	return nil
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
		// 检查云存储是否恢复
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

	log.Printf("🔄 开始同步 %d 个文件到云存储...", len(queue))

	for _, objectName := range queue {
		// 检查云存储是否已有该文件
		_, err := f.Primary.StatObject(objectName)
		if err == nil {
			log.Printf("⏭️ 云存储已有文件，跳过: %s", objectName)
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

		// 上传到云存储
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
		"primary_available":  f.Primary.IsAvailable(),
		"fallback_available": f.Fallback.IsAvailable(),
		"current_type":       f.GetType(),
		"primary_type":       f.Primary.GetType(),
		"fallback_type":      f.Fallback.GetType(),
		"pending_sync_count": len(f.syncQueue),
	}
}
