package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// 音视频分离：把一条视频拆成「无声视频」+「音频」两份产物。
//
// 为什么要在服务端做（而不是浏览器 canvas/WebAudio）：
// 浏览器要拿到音频得先把整条视频下完再解码，跨域视频还会污染画布；服务端这边源文件
// 本来就有缓存（fetchVideoToFileCached），ffmpeg 抽一条音轨是**亚秒级**的事。
//
// 两条流的处理刻意不一样：
//   - 无声视频用 **-c:v copy**（不重编码）：画面一个像素都不动，而且秒出；
//     只有极少数容器不兼容的情况（比如把 VP8 塞进 mp4）才回退到重编码。
//   - 音频用 **AAC 重编码到 .m4a**，不 copy：源音轨可能是 mp3/opus/pcm，直接 copy 进 m4a
//     要么失败要么浏览器播不了；只编码音频对 30 秒的片子是零点几秒，不值得为省它冒风险。
//
// 没有音轨的视频必须**明确报错**，不能产出一个 0 字节的音频文件让用户以为分离成功了。

// VideoDemux 分离结果：前端据此建「无声视频节点」和「音频节点」。
type VideoDemux struct {
	// SilentVideoURL 去掉音轨的视频（画面与源片完全一致）
	SilentVideoURL string `json:"silentVideoUrl"`
	// AudioURL 抽出来的音轨（AAC/.m4a，浏览器可直接播）
	AudioURL   string  `json:"audioUrl"`
	Duration   float64 `json:"duration"`
	Width      int     `json:"width"`
	Height     int     `json:"height"`
	SilentSize int64   `json:"silentSize"`
	AudioSize  int64   `json:"audioSize"`
}

// DemuxVideo 把 videoURL 拆成无声视频 + 音频，两份都上传后返回可直接给节点用的地址。
func (s *ImageOpsService) DemuxVideo(
	ctx context.Context,
	videoURL string,
	opts UploadOptions,
) (*VideoDemux, error) {
	// ⚠️ 这一步必须在**下载之前**：ffprobe 读远端只要文件头（实测 0.3 秒），
	// 而"没有音轨"这种拒绝如果等整条片子下完再说，用户要白等 30 秒（线上实测 29.7s）。
	// 探不出来（ok=false）就继续走，下载完之后再用本地判断兜一次。
	// （上一版把这段写在了 fetch 之后，等于没起作用 —— 注释说省下载、代码却已经下完了。）
	if has, ok := hasRemoteAudioStream(ctx, videoURL); ok && !has {
		return nil, errors.New("这条视频没有音轨，没有可分离的音频")
	}

	srcPath, cleanupSrc, err := s.fetchVideoToFileCached(ctx, videoURL)
	if err != nil {
		return nil, err
	}
	defer cleanupSrc()

	if !hasAudioStream(srcPath) {
		return nil, errors.New("这条视频没有音轨，没有可分离的音频")
	}

	// ① 无声视频
	silentPath, cleanupSilent, err := extractSilentVideoFile(srcPath)
	if err != nil {
		return nil, err
	}
	defer cleanupSilent()
	silentSize, err := fileSize(silentPath)
	if err != nil {
		return nil, err
	}
	if silentSize == 0 {
		return nil, errors.New("去音轨后视频为空")
	}

	// ② 音频
	audioPath, cleanupAudio, err := extractAudioFile(srcPath)
	if err != nil {
		return nil, err
	}
	defer cleanupAudio()
	audioSize, err := fileSize(audioPath)
	if err != nil {
		return nil, err
	}
	if audioSize == 0 {
		return nil, errors.New("抽出来的音轨为空（这条视频可能只有静音音轨）")
	}

	silentURL, err := s.uploadDerivedFile(silentPath, "silent.mp4", VideoExts(), ContentTypeForVideo, ".mp4", silentSize, opts)
	if err != nil {
		return nil, fmt.Errorf("保存无声视频失败: %w", err)
	}
	audioURL, err := s.uploadDerivedFile(audioPath, "audio.m4a", AudioExts(), ContentTypeForAudio, ".m4a", audioSize, opts)
	if err != nil {
		return nil, fmt.Errorf("保存音频失败: %w", err)
	}

	out := &VideoDemux{
		SilentVideoURL: silentURL,
		AudioURL:       audioURL,
		SilentSize:     silentSize,
		AudioSize:      audioSize,
		Width:          mediaWidth(silentPath),
		Height:         mediaHeight(silentPath),
	}
	if d, ok := probeClipDuration(silentPath); ok {
		out.Duration = d
	} else if d, ok := probeClipDuration(srcPath); ok {
		out.Duration = d
	}
	return out, nil
}

// uploadDerivedFile 把本地派生文件上传（扩展名白名单/内容类型按媒体类型给，避免 .mp4 被图片那套判成非法）
func (s *ImageOpsService) uploadDerivedFile(
	path, name string,
	exts map[string]bool,
	contentType func(string) string,
	defaultExt string,
	size int64,
	opts UploadOptions,
) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("打开派生文件失败: %w", err)
	}
	defer f.Close()

	uploadOpts := opts
	uploadOpts.AllowedExts = exts
	uploadOpts.ContentTypeFor = contentType
	uploadOpts.DefaultExt = defaultExt
	result, err := s.upload.UploadFromReader(f, size, name, uploadOpts)
	if err != nil {
		return "", err
	}
	return result.URL, nil
}

// hasAudioStream 这条文件里有没有音频流（ae=audio/video 由调用方选）。
//
// 读不出来时**返回 true**：让后面 ffmpeg 用自己的错误说话，好过因为我们探测失败
// 就把一条明明有声音的视频判成"没有音轨"。
func hasStreamOfKind(path, kind string) bool {
	bin := findFFprobe()
	if bin == "" {
		return true
	}
	out, err := exec.Command(bin, "-v", "error",
		"-select_streams", kind,
		"-show_entries", "stream=index",
		"-of", "csv=p=0", path).Output()
	if err != nil {
		return true
	}
	return strings.TrimSpace(string(out)) != ""
}

// hasRemoteAudioStream 不下载整条片子就判断远端有没有音轨。
//
// 返回 (是否有音轨, 判断是否可信)：读不到文件头（网络慢、格式特殊）时可信位为 false，
// 调用方据此决定"再等下载完的本地判断"，而不是拿不确定的结果去拒绝用户。
func hasRemoteAudioStream(ctx context.Context, videoURL string) (bool, bool) {
	bin := findFFprobe()
	if bin == "" {
		return false, false
	}
	cctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	out, err := exec.CommandContext(cctx, bin, "-v", "error",
		// 远端读取：限速超时 + 协议白名单（和缩略图条那条 seek 兜底同一套参数）
		"-rw_timeout", "20000000",
		"-protocol_whitelist", "file,http,https,tcp,tls,crypto",
		"-select_streams", "a",
		"-show_entries", "stream=index",
		"-of", "csv=p=0", videoURL).Output()
	if err != nil {
		return false, false
	}
	return strings.TrimSpace(string(out)) != "", true
}

// hasAudioStream 有没有音轨（判断"能不能分离出音频"）
func hasAudioStream(path string) bool { return hasStreamOfKind(path, "a") }

// hasVideoStream 有没有画面（用于断言"抽出来的音频里不该带视频流"）
func hasVideoStream(path string) bool { return hasStreamOfKind(path, "v") }

// extractSilentVideoFile 去掉音轨（画面不重编码），返回路径与清理函数。
func extractSilentVideoFile(srcPath string) (string, func(), error) {
	out, err := os.CreateTemp("", "libtv-silent-*.mp4")
	if err != nil {
		return "", func() {}, fmt.Errorf("创建临时文件失败: %w", err)
	}
	outPath := out.Name()
	_ = out.Close()
	cleanup := func() { _ = os.Remove(outPath) }

	// 先试流拷贝：画面零损失、秒出
	copyArgs := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin",
		"-i", srcPath,
		"-map", "0:v:0",
		"-c:v", "copy",
		"-an",
		"-movflags", "+faststart",
		"-y", outPath,
	}
	if err := runFFmpeg(copyArgs); err == nil {
		if size, err := fileSize(outPath); err == nil && size > 0 {
			return outPath, cleanup, nil
		}
	}

	// 回退：容器不兼容（例如 VP8/VP9 源塞进 mp4）时重编码，宁可慢一点也要给出可播的产物
	encodeArgs := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin",
		"-i", srcPath,
		"-map", "0:v:0",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
		"-an",
		"-movflags", "+faststart",
		"-y", outPath,
	}
	if err := runFFmpeg(encodeArgs); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("ffmpeg 去音轨失败: %w", err)
	}
	if size, err := fileSize(outPath); err != nil || size == 0 {
		cleanup()
		return "", func() {}, errors.New("ffmpeg 去音轨输出为空")
	}
	return outPath, cleanup, nil
}

// extractAudioFile 抽出音轨（AAC/.m4a），返回路径与清理函数。
func extractAudioFile(srcPath string) (string, func(), error) {
	out, err := os.CreateTemp("", "libtv-audio-*.m4a")
	if err != nil {
		return "", func() {}, fmt.Errorf("创建临时文件失败: %w", err)
	}
	outPath := out.Name()
	_ = out.Close()
	cleanup := func() { _ = os.Remove(outPath) }

	args := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin",
		"-i", srcPath,
		"-map", "0:a:0",
		"-vn",
		"-c:a", "aac", "-b:a", "192k",
		"-movflags", "+faststart",
		"-y", outPath,
	}
	if err := runFFmpeg(args); err != nil {
		cleanup()
		return "", func() {}, fmt.Errorf("ffmpeg 抽取音轨失败: %w", err)
	}
	if size, err := fileSize(outPath); err != nil || size == 0 {
		cleanup()
		return "", func() {}, errors.New("ffmpeg 抽取音轨输出为空")
	}
	return outPath, cleanup, nil
}

// runFFmpeg 跑一次 ffmpeg，失败时把 stderr 尾部带回错误里（截断，避免把整段日志灌进响应）
func runFFmpeg(args []string) error {
	cmd := exec.Command("ffmpeg", args...)
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		return fmt.Errorf("%w: %s", err, msg)
	}
	return nil
}