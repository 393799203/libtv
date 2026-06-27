package service

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"mime/multipart"
	"path/filepath"
	"strings"

	"libtv/internal/storage"
)

// UploadOptions 上传选项（控制 Template Method 各步骤的具体行为）
type UploadOptions struct {
	// Dir 存储目录前缀（如 "styles"、"shows"、"videos"、"images"、"audio"、"canvas"）
	Dir string
	// ProjectID 可选，存在时存到 <Dir>/<ProjectID>/<filename>
	ProjectID string
	// AllowedExts 允许的扩展名集合（小写带点，如 ".jpg"）。为空表示不限制
	AllowedExts map[string]bool
	// MaxSize 最大字节数，0 表示不限
	MaxSize int64
	// DefaultExt 文件无扩展名时使用的默认扩展名（如 ".png"、".mp3"）
	DefaultExt string
	// ContentTypeFor 由调用方提供的扩展名 → Content-Type 映射函数。
	// 为 nil 时使用 ContentTypeForImage
	ContentTypeFor func(ext string) string
	// URLFor 可选：自定义 URL 构造逻辑（默认走 storage.GetURL）。
	// 用于兼容历史路由（如 ShowHandler.UploadVideo 返回 /media/videos/ 前缀）
	URLFor func(objectName string) string
}

// UploadResult 上传结果
type UploadResult struct {
	URL         string
	ObjectName  string
	StorageType string
	Cached      bool // true 表示文件已存在被复用，未实际上传
}

// FileUploadService 文件上传服务（Template Method）
//
// 把原本在 StyleHandler / ShowHandler / BannerHandler / UploadHandler 里
// 复制粘贴了 7 遍的"哈希去重 + StatObject + PutObject + 返回 URL"流程
// 内聚到一处，调用方只需提供 UploadOptions 即可复用。
type FileUploadService struct {
	storage storage.Storage
}

// NewFileUploadService 创建上传服务
func NewFileUploadService(s storage.Storage) *FileUploadService {
	return &FileUploadService{storage: s}
}

// Upload 执行标准上传流程：校验扩展名/大小 → 计算哈希 → StatObject 去重 → PutObject → 返回 URL
func (s *FileUploadService) Upload(file multipart.File, header *multipart.FileHeader, opts UploadOptions) (*UploadResult, error) {
	// 1. 校验扩展名
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = opts.DefaultExt
	}
	if ext == "" && len(opts.AllowedExts) > 0 {
		return nil, fmt.Errorf("文件缺少扩展名")
	}
	if len(opts.AllowedExts) > 0 && !opts.AllowedExts[ext] {
		return nil, fmt.Errorf("不支持的文件格式")
	}

	// 2. 校验大小
	if opts.MaxSize > 0 && header.Size > opts.MaxSize {
		return nil, fmt.Errorf("文件大小超过限制")
	}

	// 3. 计算内容哈希用于去重
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	filename := fileHash[:12] + ext
	objectName := s.buildObjectName(opts, filename)

	// 4. 去重检查
	if _, err := s.storage.StatObject(objectName); err == nil {
		return &UploadResult{
			URL:         s.urlFor(objectName, opts),
			ObjectName:  objectName,
			StorageType: s.storage.GetType(),
			Cached:      true,
		}, nil
	}

	// 5. 重新打开文件（io.Copy 已读到末尾）
	src, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	defer src.Close()

	contentType := "application/octet-stream"
	if opts.ContentTypeFor != nil {
		contentType = opts.ContentTypeFor(ext)
	}

	// 6. 上传到存储
	if err := s.storage.PutObject(objectName, src, header.Size, contentType); err != nil {
		return nil, fmt.Errorf("上传失败: %w", err)
	}

	return &UploadResult{
		URL:         s.urlFor(objectName, opts),
		ObjectName:  objectName,
		StorageType: s.storage.GetType(),
	}, nil
}

// buildObjectName 按选项构造存储对象名
func (s *FileUploadService) buildObjectName(opts UploadOptions, filename string) string {
	if opts.ProjectID != "" {
		return opts.Dir + "/" + opts.ProjectID + "/" + filename
	}
	return opts.Dir + "/" + filename
}

// urlFor 返回访问 URL（优先使用调用方提供的 URLFor，否则走 storage.GetURL）
func (s *FileUploadService) urlFor(objectName string, opts UploadOptions) string {
	if opts.URLFor != nil {
		return opts.URLFor(objectName)
	}
	return s.storage.GetURL(objectName)
}

// ========== Content-Type 辅助函数（调用方可直接传入 ContentTypeFor） ==========

// ContentTypeForImage 图片扩展名 → Content-Type
func ContentTypeForImage(ext string) string {
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return "application/octet-stream"
	}
}

// ContentTypeForVideo 视频扩展名 → Content-Type
func ContentTypeForVideo(ext string) string {
	switch ext {
	case ".mp4":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/x-msvideo"
	case ".mkv":
		return "video/x-matroska"
	default:
		return "application/octet-stream"
	}
}

// ContentTypeForAudio 音频扩展名 → Content-Type
func ContentTypeForAudio(ext string) string {
	switch ext {
	case ".mp3":
		return "audio/mpeg"
	case ".wav":
		return "audio/wav"
	case ".ogg":
		return "audio/ogg"
	case ".m4a":
		return "audio/mp4"
	case ".flac":
		return "audio/flac"
	default:
		return "application/octet-stream"
	}
}

// ImageExts 通用图片扩展名白名单
func ImageExts() map[string]bool {
	return map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true,
	}
}

// VideoExts 通用视频扩展名白名单
func VideoExts() map[string]bool {
	return map[string]bool{
		".mp4": true, ".webm": true, ".mov": true, ".avi": true, ".mkv": true,
	}
}
