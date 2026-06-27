package service

import (
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// ========== 视频转码任务状态 ==========

type VideoTaskStatus string

const (
	TaskStatusProcessing VideoTaskStatus = "processing" // 转码中
	TaskStatusDone       VideoTaskStatus = "done"       // 完成
	TaskStatusFailed     VideoTaskStatus = "failed"     // 失败
)

type VideoTask struct {
	Status     VideoTaskStatus `json:"status"`
	URL        string           `json:"url,omitempty"`
	Compressed bool             `json:"compressed"`
	Error      string           `json:"error,omitempty"`
	CreatedAt  time.Time        `json:"created_at"`
}

// videoTaskRegistry 进程内任务状态注册表（仅用于异步转码场景）
type videoTaskRegistry struct {
	mu    sync.RWMutex
	tasks map[string]*VideoTask
}

var videoTasks = &videoTaskRegistry{tasks: make(map[string]*VideoTask)}

func (r *videoTaskRegistry) Set(taskID string, task *VideoTask) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tasks[taskID] = task
}

func (r *videoTaskRegistry) Get(taskID string) (*VideoTask, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	t, ok := r.tasks[taskID]
	return t, ok
}

func (r *videoTaskRegistry) MarkDone(taskID, url string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.tasks[taskID]; ok {
		t.Status = TaskStatusDone
		t.URL = url
	}
}

func (r *videoTaskRegistry) MarkFailed(taskID, errMsg string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.tasks[taskID]; ok {
		t.Status = TaskStatusFailed
		t.Error = errMsg
	}
}

// ========== 转码纯函数 ==========

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
	switch strings.ToLower(ext) {
	case ".ts", ".flv", ".m3u8", ".mkv", ".avi", ".wmv":
		return true
	default:
		return false
	}
}

// ========== 转码服务 ==========

// TranscodeService 视频转码服务
// 职责：把上传的源文件转码为 MP4 并上传到存储；任务状态注册表
type TranscodeService struct {
	storage StorageUploader
}

// StorageUploader 存储上传抽象（避免直接依赖 storage 包，便于单测）
type StorageUploader interface {
	PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error
	GetURL(objectName string) string
}

// NewTranscodeService 创建转码服务
func NewTranscodeService(storage StorageUploader) *TranscodeService {
	return &TranscodeService{storage: storage}
}

// GetTask 查询任务状态（handler 层调用）
func (s *TranscodeService) GetTask(taskID string) (*VideoTask, bool) {
	return videoTasks.Get(taskID)
}

// ConvertAndUpload 异步转码并上传到存储
// 调用方负责把源文件先落盘到 inputPath，本方法负责：转码 → 上传 → 清理 → 更新任务状态
func (s *TranscodeService) ConvertAndUpload(taskID, inputPath, outputObjectName string) {
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
	_ = os.Remove(inputPath)

	if err != nil {
		videoTasks.MarkFailed(taskID, fmt.Sprintf("ffmpeg 转码失败: %v", err))
		return
	}

	// 2. 上传到存储
	f, err := os.Open(outputPath)
	if err != nil {
		_ = os.Remove(outputPath)
		videoTasks.MarkFailed(taskID, fmt.Sprintf("打开转码后文件失败: %v", err))
		return
	}
	fi, _ := f.Stat()
	err = s.storage.PutObject(outputObjectName, f, fi.Size(), "video/mp4")
	_ = f.Close()
	_ = os.Remove(outputPath) // 清理输出文件

	if err != nil {
		videoTasks.MarkFailed(taskID, fmt.Sprintf("上传转码后文件失败: %v", err))
		return
	}

	// 3. 完成
	url := s.storage.GetURL(outputObjectName)
	videoTasks.MarkDone(taskID, url)
}

// PrepareTranscode 把上传的文件落盘到临时目录，返回临时路径
func (s *TranscodeService) PrepareTranscode(filename string, src io.Reader) (string, error) {
	tmpDir := "/tmp/libtv_convert"
	if err := os.MkdirAll(tmpDir, 0755); err != nil {
		return "", fmt.Errorf("创建临时目录失败: %w", err)
	}
	tmpPath := filepath.Join(tmpDir, filename)
	tmpFile, err := os.Create(tmpPath)
	if err != nil {
		return "", fmt.Errorf("创建临时文件失败: %w", err)
	}
	defer tmpFile.Close()
	if _, err := io.Copy(tmpFile, src); err != nil {
		return "", fmt.Errorf("写入临时文件失败: %w", err)
	}
	return tmpPath, nil
}

// RegisterTask 注册一个新任务到状态注册表
func (s *TranscodeService) RegisterTask(taskID string) {
	videoTasks.Set(taskID, &VideoTask{
		Status:    TaskStatusProcessing,
		CreatedAt: time.Now(),
	})
}
