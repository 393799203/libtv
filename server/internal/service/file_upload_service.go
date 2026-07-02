package service

import (
	"bytes"
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

// UploadFromReader 从 Reader 上传（用于AI生成的图片等场景）
// 复用哈希去重、存储路径构建、URL生成等逻辑
func (s *FileUploadService) UploadFromReader(reader io.Reader, size int64, filename string, opts UploadOptions) (*UploadResult, error) {
	// 1. 校验扩展名
	ext := strings.ToLower(filepath.Ext(filename))
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
	if opts.MaxSize > 0 && size > opts.MaxSize {
		return nil, fmt.Errorf("文件大小超过限制")
	}

	// 3. 计算内容哈希用于去重
	hasher := sha256.New()
	// 使用 TeeReader 同时计算哈希和保存数据
	dataBuffer := &bytes.Buffer{}
	teeReader := io.TeeReader(reader, hasher)

	if _, err := io.Copy(dataBuffer, teeReader); err != nil {
		return nil, fmt.Errorf("读取数据失败: %w", err)
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	finalFilename := fileHash[:12] + ext
	objectName := s.buildObjectName(opts, finalFilename)

	// 4. 去重检查
	if _, err := s.storage.StatObject(objectName); err == nil {
		return &UploadResult{
			URL:         s.urlFor(objectName, opts),
			ObjectName:  objectName,
			StorageType: s.storage.GetType(),
			Cached:      true,
		}, nil
	}

	contentType := "application/octet-stream"
	if opts.ContentTypeFor != nil {
		contentType = opts.ContentTypeFor(ext)
	}

	// 5. 上传到存储
	if err := s.storage.PutObject(objectName, dataBuffer, size, contentType); err != nil {
		return nil, fmt.Errorf("上传失败: %w", err)
	}

	return &UploadResult{
		URL:         s.urlFor(objectName, opts),
		ObjectName:  objectName,
		StorageType: s.storage.GetType(),
	}, nil
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

// VideoUploadResult 视频上传结果（可能同步完成，也可能异步转码中）
type VideoUploadResult struct {
	URL            string `json:"url,omitempty"`    // 同步完成时有值
	TaskID         string `json:"task_id,omitempty"` // 异步转码时有值
	ObjectName     string `json:"filename"`         // 最终对象名（含 .mp4）
	Cached         bool   `json:"cached"`            // 是否命中去重
	Compressed     bool   `json:"compressed"`        // 是否经过转码压缩
	StorageType    string `json:"storage_type"`
	AsyncTranscode bool   `json:"async_transcode"`  // 是否进入异步转码
}

// UploadVideoWithTranscode 视频上传 Template Method：
//   不需转码 → 走标准 Upload 流程
//   需转码   → 哈希去重 → 落盘临时文件 → 注册任务 → goroutine 异步转码并上传
// 调用方传入 transcodeSvc 用于异步转码分支，nil 时遇到需转码文件直接返回错误。
func (s *FileUploadService) UploadVideoWithTranscode(
	header *multipart.FileHeader,
	opts UploadOptions,
	transcodeSvc *TranscodeService,
) (*VideoUploadResult, error) {
	// 1. 校验扩展名
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if ext == "" {
		ext = ".mp4"
	}

	// 2. 计算哈希（用一次 Read 满足去重 + 后续落盘/上传）
	file, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))
	_ = file.Close()

	filename := fileHash[:12] + ext
	objectName := s.buildObjectName(opts, filename)
	// 转码后的统一目标为 .mp4
	mp4ObjectName := strings.TrimSuffix(objectName, filepath.Ext(objectName)) + ".mp4"

	// 3. 去重检查（命中已转码的 mp4）
	if _, err := s.storage.StatObject(mp4ObjectName); err == nil {
		return &VideoUploadResult{
			URL:         s.urlFor(mp4ObjectName, opts),
			ObjectName:  mp4ObjectName,
			Cached:      true,
			StorageType: s.storage.GetType(),
		}, nil
	}

	// 4. 不需要转码：直接上传为 .mp4
	if !NeedConvert(ext) {
		result, err := s.reupload(header, mp4ObjectName, "video/mp4")
		if err != nil {
			return nil, err
		}
		return &VideoUploadResult{
			URL:         result.URL,
			ObjectName:  result.ObjectName,
			StorageType: result.StorageType,
		}, nil
	}

	// 5. 需要转码
	if transcodeSvc == nil {
		return nil, fmt.Errorf("需要转码但未提供 TranscodeService")
	}

	// 落盘到临时目录
	src, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	tmpPath, err := transcodeSvc.PrepareTranscode(filename, src)
	_ = src.Close()
	if err != nil {
		return nil, err
	}

	taskID := fileHash[:16]
	transcodeSvc.RegisterTask(taskID)
	go transcodeSvc.ConvertAndUpload(taskID, tmpPath, mp4ObjectName)

	return &VideoUploadResult{
		TaskID:        taskID,
		ObjectName:    mp4ObjectName,
		StorageType:   s.storage.GetType(),
		AsyncTranscode: true,
	}, nil
}

// reupload 重新打开文件并上传到指定 objectName（内部复用工具）
func (s *FileUploadService) reupload(header *multipart.FileHeader, objectName, contentType string) (*UploadResult, error) {
	src, err := header.Open()
	if err != nil {
		return nil, fmt.Errorf("读取文件失败: %w", err)
	}
	defer src.Close()
	if err := s.storage.PutObject(objectName, src, header.Size, contentType); err != nil {
		return nil, fmt.Errorf("上传失败: %w", err)
	}
	return &UploadResult{
		URL:         s.storage.GetURL(objectName),
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
