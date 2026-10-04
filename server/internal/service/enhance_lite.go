package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ========== P0「清晰化」本地档 ==========
//
// 这一档只用本机 ffmpeg 做「去块 + 轻降噪 + 锐化」（可选把低分辨率用 lanczos 放大到 720p），
// 不调用任何外部服务、不产生额外成本、不出境、不做补帧。
//
// 定位（见 docs/视频清晰化与补帧-调研与接入方案.md 第六章 P0）：
//   - 纯 CPU 可跑，成本为零，用来先验证「用户是否真的在意清晰度」；
//   - 它不会生成新细节（不幻觉、不崩人脸），只是把压缩伪影和软边压回去；
//   - 真正的 1080p 超分/补帧走 P1（腾讯云 MPS），不要用本地档冒充。

// 清晰化档位。空字符串表示关闭。
const (
	LiteEnhanceOff   = ""
	LiteEnhanceClean = "clean" // 去块 + 轻降噪 + 锐化（分辨率不变）
	LiteEnhanceHD    = "hd"    // clean + 短边不足 720p 时放大到 720p
)

// 默认参数。
//
// 这些值现在可以被 configs/enhance.yaml 的 limits 覆盖（启动时 ApplyEnhanceLimits 注入）：
// 它们是运维旋钮（机器吃紧就把并发降到 1、遇到长片就放宽时长上限），
// 以前硬编码在这里，线上要调只能改代码重新构建镜像。
const (
	liteEnhanceTargetShortSideDefault = 720
	liteEnhanceTimeoutDefault         = 300 * time.Second
	liteEnhanceCRFDefault             = 20
	liteEnhancePresetDefault          = "veryfast"
	// 本地档只处理「片段」。视频节点产出的都是 ≤30s 的镜头，
	// 真有人把整集（几分钟）连进来时，宁可明确拒绝，也不要占着 CPU 跑到超时再失败。
	liteEnhanceMaxDurationDefault = 120 * time.Second
	// 同时只允许 2 个 ffmpeg 进程：队列有 10 个 worker，不设闸门时 10 个 720p 编码能把机器打死
	liteEnhanceMaxConcurrency = 2
)

// 运行时生效值（启动时由 ApplyEnhanceLimits 用配置覆盖；未配置则保持上面的默认）
var (
	liteEnhanceLimitsMu           sync.RWMutex
	liteEnhanceTimeout            = liteEnhanceTimeoutDefault
	liteEnhanceCRF                = liteEnhanceCRFDefault
	liteEnhancePreset             = liteEnhancePresetDefault
	liteEnhanceMaxDuration        = liteEnhanceMaxDurationDefault
	liteEnhanceConcurrency        = liteEnhanceMaxConcurrency
	liteEnhanceTargetShortSideCfg = liteEnhanceTargetShortSideDefault
)

// ApplyEnhanceLimits 用配置覆盖运维旋钮（只在启动时调用一次）
func ApplyEnhanceLimits(l EnhanceLimitsConfig) {
	liteEnhanceLimitsMu.Lock()
	defer liteEnhanceLimitsMu.Unlock()

	if l.TimeoutSeconds > 0 {
		liteEnhanceTimeout = time.Duration(l.TimeoutSeconds) * time.Second
	}
	if l.MaxDurationSeconds > 0 {
		liteEnhanceMaxDuration = time.Duration(l.MaxDurationSeconds) * time.Second
	}
	if l.CRF > 0 && l.CRF <= 51 {
		liteEnhanceCRF = l.CRF
	}
	if l.Preset != "" {
		liteEnhancePreset = l.Preset
	}
	if l.MaxConcurrency > 0 && l.MaxConcurrency != liteEnhanceConcurrency {
		liteEnhanceConcurrency = l.MaxConcurrency
		// 闸门按新并发重建：只在启动时改，没有在跑的任务会被丢掉
		liteEnhanceSem = make(chan struct{}, l.MaxConcurrency)
	}
	log.Printf("✅ 本机清晰化参数: 并发上限=%d 时长上限=%ds 超时=%ds crf=%d preset=%s",
		liteEnhanceConcurrency, int(liteEnhanceMaxDuration/time.Second), int(liteEnhanceTimeout/time.Second), liteEnhanceCRF, liteEnhancePreset)
}

// CurrentLiteEnhanceLimits 当前生效的运维旋钮（供接口/日志展示）
func CurrentLiteEnhanceLimits() (concurrency int, maxDurationSec int, timeoutSec int, crf int, preset string) {
	liteEnhanceLimitsMu.RLock()
	defer liteEnhanceLimitsMu.RUnlock()
	return liteEnhanceConcurrency, int(liteEnhanceMaxDuration / time.Second), int(liteEnhanceTimeout / time.Second), liteEnhanceCRF, liteEnhancePreset
}

// NormalizeLiteEnhance 规范化前端传来的档位值。
// 非法值一律当作「关闭」——清晰化是增强项，绝不能因为参数脏就让出片失败。
func NormalizeLiteEnhance(v string) string {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case LiteEnhanceClean:
		return LiteEnhanceClean
	case LiteEnhanceHD:
		return LiteEnhanceHD
	default:
		return LiteEnhanceOff
	}
}

// LiteEnhanceOptions 清晰化参数
type LiteEnhanceOptions struct {
	Level           string        // clean / hd
	TargetShortSide int           // hd 档目标短边，默认 720
	Timeout         time.Duration // 单次处理超时，默认 300s（线上共享 CPU 比开发机慢得多）
	MaxDuration     time.Duration // 源视频时长上限，默认 120s；超过则明确报错而不是硬跑
	CRF             int           // x264 CRF，默认 20
	Preset          string        // x264 preset，默认 veryfast
}

func (o LiteEnhanceOptions) withDefaults() LiteEnhanceOptions {
	if o.TargetShortSide <= 0 {
		o.TargetShortSide = liteEnhanceTargetShortSideDefault
	}
	liteEnhanceLimitsMu.RLock()
	timeout, maxDur, crf, preset := liteEnhanceTimeout, liteEnhanceMaxDuration, liteEnhanceCRF, liteEnhancePreset
	liteEnhanceLimitsMu.RUnlock()

	if o.Timeout <= 0 {
		o.Timeout = timeout
	}
	if o.MaxDuration <= 0 {
		o.MaxDuration = maxDur
	}
	if o.CRF <= 0 {
		o.CRF = crf
	}
	if o.Preset == "" {
		o.Preset = preset
	}
	return o
}

// LiteEnhanceResult 处理结果（用于留痕：节点数据、日志、A/B 统计）
type LiteEnhanceResult struct {
	Applied     bool   `json:"applied"`
	Level       string `json:"level"`
	Filter      string `json:"filter"`
	SourceW     int    `json:"sourceW"`
	SourceH     int    `json:"sourceH"`
	TargetW     int    `json:"targetW"`
	TargetH     int    `json:"targetH"`
	Upscaled    bool   `json:"upscaled"`
	ElapsedMS   int64  `json:"elapsedMs"`
	OutputBytes int64  `json:"outputBytes"`
	// 源视频时长，留痕用（便于统计「清晰化都用在多久的片子上」）
	SourceDurationMS int64 `json:"sourceDurationMs"`
	// 源片显示矩阵旋转角（0/90/180/270），留痕用
	SourceRotation int           `json:"sourceRotation"`
	Elapsed        time.Duration `json:"-"`
}

// findFFprobe 返回 ffprobe 路径（与 findFFmpeg 同源：本地 Homebrew，线上系统自带）
func findFFprobe() string {
	localPath := "/usr/local/Cellar/ffmpeg/8.1.1/bin/ffprobe"
	if _, err := os.Stat(localPath); err == nil {
		return localPath
	}
	return "ffprobe"
}

// mediaInfo 源视频的基本信息（清晰化所需的最小集合）
type mediaInfo struct {
	Width      int
	Height     int
	Duration   time.Duration
	AudioCodec string // 空 = 无音轨
	// Rotation 显示矩阵旋转角（0/90/180/270）。手机竖拍视频的宽高是「存储尺寸」，
	// 播放器按旋转角显示 —— 不看它就会把竖屏片按横屏算目标尺寸，甚至叠成二次旋转。
	Rotation int
}

// probeMediaInfo 一次 ffprobe 拿到宽高、时长与音频编码。
// 为什么要音频编码：清晰化要重新封装成 mp4，音频直通只在编码兼容时才安全
// （webm 的 opus 直通进 mp4，Chrome 能放、Safari/剪映打不开）。
func probeMediaInfo(ctx context.Context, path string) (mediaInfo, error) {
	cmd := exec.CommandContext(ctx, findFFprobe(),
		"-v", "error",
		"-show_entries", "stream=codec_type,width,height,codec_name:stream_tags=rotate:stream_side_data=rotation",
		"-show_entries", "format=duration",
		"-of", "json",
		path,
	)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return mediaInfo{}, fmt.Errorf("ffprobe: %w (stderr=%s)", err, strings.TrimSpace(stderr.String()))
	}

	var parsed struct {
		Streams []struct {
			CodecType string `json:"codec_type"`
			CodecName string `json:"codec_name"`
			Width     int    `json:"width"`
			Height    int    `json:"height"`
			Tags      struct {
				Rotate string `json:"rotate"`
			} `json:"tags"`
			SideDataList []struct {
				Rotation float64 `json:"rotation"`
			} `json:"side_data_list"`
		} `json:"streams"`
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}
	if err := json.Unmarshal(out, &parsed); err != nil {
		return mediaInfo{}, fmt.Errorf("parse ffprobe output: %w", err)
	}

	var info mediaInfo
	for _, st := range parsed.Streams {
		switch st.CodecType {
		case "video":
			if info.Width == 0 && st.Width > 0 && st.Height > 0 {
				info.Width, info.Height = st.Width, st.Height
				// 旋转角：新版 ffprobe 放 side_data_list[].rotation（负数表示逆时针），
				// 旧版放 tags.rotate。两者都归一化到 0~359 的正角度
				for _, sd := range st.SideDataList {
					if r := int(sd.Rotation); r != 0 {
						info.Rotation = ((r % 360) + 360) % 360
						break
					}
				}
				if info.Rotation == 0 && st.Tags.Rotate != "" {
					if r, err := strconv.Atoi(st.Tags.Rotate); err == nil {
						info.Rotation = ((r % 360) + 360) % 360
					}
				}
			}
		case "audio":
			if info.AudioCodec == "" {
				info.AudioCodec = st.CodecName
			}
		}
	}
	if info.Width <= 0 || info.Height <= 0 {
		return mediaInfo{}, fmt.Errorf("ffprobe: no video stream size")
	}
	if d, err := strconv.ParseFloat(parsed.Format.Duration, 64); err == nil && d > 0 {
		info.Duration = time.Duration(d * float64(time.Second))
	}
	return info, nil
}

// audioArgs 决定音频怎么处理：编码兼容就直接 copy（快且不掉质量），否则转 AAC。
func audioArgs(audioCodec string) []string {
	switch strings.ToLower(audioCodec) {
	case "":
		return nil // 无音轨
	case "aac", "mp3":
		return []string{"-c:a", "copy"}
	default:
		// opus/vorbis/ac3 等：直通进 mp4 会有播放器打不开的风险，统一转 AAC
		return []string{"-c:a", "aac", "-b:a", "128k"}
	}
}

// evenUp 向上取偶数：H.264 的 yuv420p 要求宽高为偶数，否则编码直接失败
func evenUp(n int) int {
	if n%2 != 0 {
		n++
	}
	if n < 2 {
		n = 2
	}
	return n
}

// buildLiteFilter 生成滤镜链与目标尺寸。
//
// 顺序有讲究：先去块（消 8x8 网格）→ 再时域降噪（压蚊噪/闪烁）→ 最后锐化。
// 反过来先锐化会把块效应一起锐化，越修越脏。
func buildLiteFilter(srcW, srcH, targetShortSide int, level string) (filter string, targetW, targetH int, upscaled bool) {
	targetW, targetH = srcW, srcH

	if level == LiteEnhanceHD && targetShortSide > 0 {
		shortSide := srcW
		if srcH < srcW {
			shortSide = srcH
		}
		if shortSide < targetShortSide {
			scale := float64(targetShortSide) / float64(shortSide)
			targetW = evenUp(int(float64(srcW)*scale + 0.5))
			targetH = evenUp(int(float64(srcH)*scale + 0.5))
			upscaled = true
		}
	}

	parts := make([]string, 0, 4)
	if upscaled {
		// lanczos：调研中实测过的放大核（比 bicubic 更锐，且不生成新细节）
		parts = append(parts, fmt.Sprintf("scale=%d:%d:flags=lanczos", targetW, targetH))
	}
	// deblock：消压缩块效应（强档 4px 块）
	parts = append(parts, "deblock=filter=strong:block=4")
	// hqdn3d：轻时域降噪，压蚊噪与色带抖动（参数刻意保守，避免糊掉线条）
	parts = append(parts, "hqdn3d=1.0:1.0:4:4")
	// cas：对比度自适应锐化，比 unsharp 更不容易出白边（动漫线条友好）
	parts = append(parts, "cas=strength=0.45")

	return strings.Join(parts, ","), targetW, targetH, upscaled
}

// EnhanceLite 用本机 ffmpeg 对视频做「清晰化」处理，输出到 outputPath。
//
// 参数 ctx 用于取消（执行器超时/用户中断都能立刻停）；opt.Timeout 是处理自身的兜底超时。
// 只有成功时返回的 Result.Applied 才为 true；调用方在出错时应回退使用原始视频。
func EnhanceLite(ctx context.Context, inputPath, outputPath string, opt LiteEnhanceOptions) (LiteEnhanceResult, error) {
	opt = opt.withDefaults()
	opt.Level = NormalizeLiteEnhance(opt.Level)

	res := LiteEnhanceResult{Level: opt.Level}
	if opt.Level == LiteEnhanceOff {
		return res, fmt.Errorf("enhance lite: level is off")
	}

	info, err := probeMediaInfo(ctx, inputPath)
	if err != nil {
		return res, err
	}
	srcW, srcH := info.Width, info.Height
	// 带 90/270 旋转的片子：ffmpeg 在跑滤镜前会自动旋转，滤镜看到的是「显示尺寸」，
	// 所以目标尺寸必须按显示尺寸算，否则会把竖屏片按横屏拉伸
	if info.Rotation == 90 || info.Rotation == 270 {
		srcW, srcH = srcH, srcW
	}
	res.SourceW, res.SourceH = srcW, srcH
	res.SourceRotation = info.Rotation
	res.SourceDurationMS = info.Duration.Milliseconds()

	// 时长闸门：本地档是给「镜头片段」用的，整集请走云端档（P1）。
	// 这里明确报错，比让它跑满 5 分钟再超时（用户只看到一个 timeout）要诚实得多。
	if opt.MaxDuration > 0 && info.Duration > opt.MaxDuration {
		return res, fmt.Errorf("源视频时长 %.1fs 超过本地清晰化档上限 %.0fs：请先剪切片段，或使用云端清晰化档（P1）",
			info.Duration.Seconds(), opt.MaxDuration.Seconds())
	}

	filter, targetW, targetH, upscaled := buildLiteFilter(srcW, srcH, opt.TargetShortSide, opt.Level)
	res.Filter = filter
	res.TargetW, res.TargetH = targetW, targetH
	res.Upscaled = upscaled

	runCtx, cancel := context.WithTimeout(ctx, opt.Timeout)
	defer cancel()

	// 并发闸门：队列有 10 个 worker，若不限制，10 个节点同时做 720p 编码会把机器 CPU 打满，
	// 连累同时在跑的生成请求。等待期间尊重 ctx（执行被取消就立刻退出，不白等）。
	if err := acquireLiteEnhanceSlot(runCtx); err != nil {
		return res, err
	}
	defer releaseLiteEnhanceSlot()

	args := []string{
		"-y",
		"-i", inputPath,
		"-vf", filter,
		"-c:v", "libx264",
		"-preset", opt.Preset,
		"-crf", strconv.Itoa(opt.CRF),
		"-pix_fmt", "yuv420p",
		// 保留容器元数据：AI 生成标识等隐式信息不得在清晰化环节被剥离
		"-map_metadata", "0",
		// 但显示矩阵必须清掉：ffmpeg 已自动旋转过画面，rotate 标签再抄回来会被播放器二次旋转
		"-metadata:s:v:0", "rotate=0",
		// 便于边下边播
		"-movflags", "+faststart",
	}
	// 音频策略见 audioArgs：兼容编码直通，其它转 AAC
	args = append(args, audioArgs(info.AudioCodec)...)
	args = append(args, outputPath)

	start := time.Now()
	cmd := exec.CommandContext(runCtx, findFFmpeg(), args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return res, fmt.Errorf("ffmpeg enhance(%s): %w (stderr tail=%s)", opt.Level, err, tail(stderr.String(), 600))
	}
	res.Elapsed = time.Since(start)
	res.ElapsedMS = res.Elapsed.Milliseconds()

	outInfo, statErr := os.Stat(outputPath)
	if statErr != nil || outInfo.Size() == 0 {
		return res, fmt.Errorf("enhance output missing or empty: path=%s err=%v", outputPath, statErr)
	}
	res.OutputBytes = outInfo.Size()
	res.Applied = true
	return res, nil
}

// liteEnhanceSem 本地清晰化的并发闸门（上限见 enhance.yaml 的 limits.max_concurrency）
var liteEnhanceSem = make(chan struct{}, liteEnhanceMaxConcurrency)

func acquireLiteEnhanceSlot(ctx context.Context) error {
	liteEnhanceLimitsMu.RLock()
	sem, limit := liteEnhanceSem, liteEnhanceConcurrency
	liteEnhanceLimitsMu.RUnlock()

	select {
	case sem <- struct{}{}:
		return nil
	case <-ctx.Done():
		return fmt.Errorf("等待清晰化资源超时（当前并发已满 %d）: %w", limit, ctx.Err())
	}
}

func releaseLiteEnhanceSlot() {
	select {
	case <-liteEnhanceSem:
	default:
	}
}

// tail 截取字符串末尾 n 个字符（ffmpeg 的报错关键信息通常在最后）
func tail(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return "..." + s[len(s)-n:]
}

// LiteEnhanceTempPaths 申请一对临时文件路径（输入/输出）。
// 返回的清理函数必须被 defer 调用，避免在执行器异常时留下垃圾文件。
func LiteEnhanceTempPaths(ext string) (inPath, outPath string, cleanup func(), err error) {
	if ext == "" {
		ext = ".mp4"
	}
	if !strings.HasPrefix(ext, ".") {
		ext = "." + ext
	}

	inFile, err := os.CreateTemp("", "libtv-enhance-in-*"+ext)
	if err != nil {
		return "", "", nil, fmt.Errorf("create temp input: %w", err)
	}
	inPath = inFile.Name()
	inFile.Close()

	outPath = filepath.Join(os.TempDir(), fmt.Sprintf("libtv-enhance-out-%d%s", time.Now().UnixNano(), ext))

	cleanup = func() {
		_ = os.Remove(inPath)
		_ = os.Remove(outPath)
	}
	return inPath, outPath, cleanup, nil
}
