package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// 视频裁剪：「片段重拍」真正把用户选的区间裁成一个**新视频文件**。
//
// 为什么必须有这一步（而不是只把"00:00 - 00:05"写进提示词）：
// 上游视频接口没有"只重拍某一段"的能力 —— 整个 llm 包里唯一的视频入参是
// reference_video（整条视频），上游按"视频延长"处理（详见 llm/video.go 的
// seedanceRatio→adaptive）。所以要想让模型真的只对着这一段干活，只能**在这边先把片段裁出来**，
// 拿裁好的短片当参考/结果，而不是指望提示词里的一句话被上游执行。
//
// 顺带解决两个真问题：
//  1. fast 系模型限制"参考视频时长 + 生成时长 ≤ 15.2s"，参考整条 30 秒的片子必然超标
//     （而且这条错误发生在扣费之后、不自动退费）；裁成 5 秒后就不会撞上。
//  2. seedance 按参考视频**完整时长**计费，送整条片子等于按整条计费。
//
// 编码参数：**重编码**而不是 -c copy。copy 是秒级，但只能从关键帧切，
// 用户拖到 00:02 很可能得到从 00:00 开始的片子 —— "所见即所得"在这里比省那几秒重要。
// veryfast/crf20 对 5~30 秒的片段是秒级到十几秒，可以接受。

// VideoClip 裁剪结果：给前端建节点用（url 直接当节点的 videoUrl）
type VideoClip struct {
	URL string `json:"url"`
	// Duration 是**裁完之后实测**的时长，不一定等于 end-start：
	// 请求的区间超出片尾时，ffmpeg 只给得出实际存在的部分。前端据此把节点上的区间改准。
	Duration float64 `json:"duration"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	Size     int64   `json:"size"`
	// Start/End 请求的原始区间（回显，便于前端核对）
	Start float64 `json:"start"`
	End   float64 `json:"end"`
}

const (
	// 单次裁剪的最短时长：比 0.5 秒更短没有使用价值，多半是参数写错了
	videoClipMinSeconds = 0.5
	// 单次裁剪的最长时长：重拍片段不该是"整条片子"，也防有人传 0~3600 让服务器转码一小时
	videoClipMaxSeconds = 300
	// 裁完之后实测时长与请求时长差多少算"没裁到"（秒）：超出片尾时用它给出提示
	videoClipDurationTolerance = 0.35
)

// TrimVideo 把 [start, end) 裁成一个新视频并落盘，返回可直接给视频节点用的地址。
func (s *ImageOpsService) TrimVideo(
	ctx context.Context,
	videoURL string,
	start, end float64,
	opts UploadOptions,
) (*VideoClip, error) {
	if err := validateClipRange(start, end); err != nil {
		return nil, err
	}

	srcPath, cleanupSrc, err := s.fetchVideoToFileCached(ctx, videoURL)
	if err != nil {
		return nil, err
	}
	defer cleanupSrc()

	clipPath, cleanupClip, err := extractVideoClipFile(srcPath, start, end)
	if err != nil {
		return nil, err
	}
	defer cleanupClip()

	size, err := fileSize(clipPath)
	if err != nil {
		return nil, err
	}
	if size == 0 {
		return nil, errors.New("裁剪结果为空（该区间可能没有画面）")
	}

	f, err := os.Open(clipPath)
	if err != nil {
		return nil, fmt.Errorf("打开裁剪结果失败: %w", err)
	}
	defer f.Close()

	// 视频走视频扩展名/内容类型：用图片那套会把 .mp4 判成非法扩展名
	uploadOpts := opts
	uploadOpts.AllowedExts = VideoExts()
	uploadOpts.ContentTypeFor = ContentTypeForVideo
	uploadOpts.DefaultExt = ".mp4"
	result, err := s.upload.UploadFromReader(f, size, "clip.mp4", uploadOpts)
	if err != nil {
		return nil, fmt.Errorf("保存裁剪结果失败: %w", err)
	}

	clip := &VideoClip{
		URL:    result.URL,
		Size:   size,
		Start:  start,
		End:    end,
		Width:  mediaWidth(clipPath),
		Height: mediaHeight(clipPath),
	}
	if d, ok := probeClipDuration(clipPath); ok {
		clip.Duration = d
	} else {
		// 探不到就用请求区间兜底（前端会以节点上记的区间为准）
		clip.Duration = end - start
	}
	return clip, nil
}

func validateClipRange(start, end float64) error {
	if start < 0 || end < 0 {
		return errors.New("裁剪区间不能为负数")
	}
	if end <= start {
		return errors.New("裁剪区间的结束时间必须大于开始时间")
	}
	length := end - start
	if length < videoClipMinSeconds {
		return fmt.Errorf("片段至少要 %.1f 秒", videoClipMinSeconds)
	}
	if length > videoClipMaxSeconds {
		return fmt.Errorf("单次最多裁 %d 秒", videoClipMaxSeconds)
	}
	if end > 24*3600 {
		return errors.New("裁剪区间超出合理范围")
	}
	return nil
}

// extractVideoClipFile 用 ffmpeg 裁出 [start, end) 到临时文件，返回路径与清理函数。
//
// 单独抽成纯函数（不碰网络与存储）是为了能在容器里直接断言：
// 裁 0.9~2.1 秒出来的片子，第 0.2 秒那一帧到底是不是原视频第 1.1 秒的画面。
func extractVideoClipFile(srcPath string, start, end float64) (string, func(), error) {
	out, err := os.CreateTemp("", "libtv-clip-*.mp4")
	if err != nil {
		return "", func() {}, fmt.Errorf("创建临时文件失败: %w", err)
	}
	outPath := out.Name()
	_ = out.Close()
	cleanup := func() { _ = os.Remove(outPath) }

	args := []string{
		"-hide_banner", "-loglevel", "error", "-nostdin",
		// -ss 放在 -i 前：走 seek 而不是从头解码；ffmpeg 默认 accurate_seek，落点是精确时刻
		"-ss", strconv.FormatFloat(start, 'f', 3, 64),
		"-i", srcPath,
		// -t 是**时长**（放在 -i 之后按输出时间轴算），比 -to 的绝对/相对歧义更稳
		"-t", strconv.FormatFloat(end-start, 'f', 3, 64),
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "128k",
		// faststart：moov 放文件头，网页里点开就能播（否则要先下完整个文件）
		"-movflags", "+faststart",
		"-y", outPath,
	}

	cmd := exec.Command("ffmpeg", args...)
	var errBuf bytes.Buffer
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(errBuf.String())
		if len(msg) > 300 {
			msg = msg[:300]
		}
		cleanup()
		return "", func() {}, fmt.Errorf("ffmpeg 裁剪失败: %w: %s", err, msg)
	}
	if size, err := fileSize(outPath); err != nil || size == 0 {
		cleanup()
		return "", func() {}, errors.New("ffmpeg 裁剪输出为空（该区间可能没有画面）")
	}
	return outPath, cleanup, nil
}

func fileSize(path string) (int64, error) {
	st, err := os.Stat(path)
	if err != nil {
		return 0, fmt.Errorf("读取文件信息失败: %w", err)
	}
	return st.Size(), nil
}

// probeClipDuration 用 ffprobe 读实际时长（读不到返回 false，调用方用请求区间兜底）
func probeClipDuration(path string) (float64, bool) {
	bin := findFFprobe()
	if bin == "" {
		return 0, false
	}
	out, err := exec.Command(bin, "-v", "error", "-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1", path).Output()
	if err != nil {
		return 0, false
	}
	d, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || d <= 0 {
		return 0, false
	}
	return d, true
}

// mediaWidth/mediaHeight 读视频尺寸（读不到回 0，前端会退回原图实测）
func mediaWidth(path string) int  { w, _ := probeMediaSize(path); return w }
func mediaHeight(path string) int { _, h := probeMediaSize(path); return h }

func probeMediaSize(path string) (int, int) {
	bin := findFFprobe()
	if bin == "" {
		return 0, 0
	}
	out, err := exec.Command(bin, "-v", "error", "-select_streams", "v:0",
		"-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path).Output()
	if err != nil {
		return 0, 0
	}
	parts := strings.Split(strings.TrimSpace(string(out)), "x")
	if len(parts) != 2 {
		return 0, 0
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil {
		return 0, 0
	}
	return w, h
}

// ClipShorterThanRequested 实测时长明显短于请求时长 → 说明请求区间超出了片尾
func ClipShorterThanRequested(clip *VideoClip) bool {
	if clip == nil || clip.Duration <= 0 {
		return false
	}
	return (clip.End-clip.Start)-clip.Duration > videoClipDurationTolerance
}
