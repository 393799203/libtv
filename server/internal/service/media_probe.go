package service

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// ========== 视频尺寸探测 ==========
//
// 用途：**校验交付是否符合设置**。
// 背景（真实工单）：电信渠道 `cdance2.0-fast-0807` 设置 480p，交付 1280x720。
// 根因是**我们自己的 bug**：电信 cdance 路径的报文里根本没有 resolution 字段
// （见 llm/video.go 的 DianxinVideoRequest，2026-10-04 修复），上游就按自己的默认值出 720p。
// 这种事不校验就永远只会在用户嘴里出现（"我设了 480p 怎么给我 720p"），
// 所以每次生成后量一下真实尺寸，不符就记一条日志 + 落到节点数据里，先量化规模。
// 修复后它继续当护栏：新增渠道/模型时字段再漏，也能第一时间发现，而不是等用户来问。
//
// 只记录、不拦截：片子已经生成、钱已经扣了，此处报错只会让用户拿不到本该能用的片子。

// NominalShortSide 分辨率档位对应的「短边标称值」（用于交付校验）。
// 用短边而不是宽高对：竖屏 480p 是 480x854、横屏是 854x480，短边都是 480；
// 而 16:9 之外的画幅（如 832x480 的万相）短边同样落在标称值上。
// 返回 0 表示这个档位没有标称值（如自适应/未知），调用方应跳过校验。
func NominalShortSide(resolution string) int {
	switch strings.ToLower(strings.TrimSpace(resolution)) {
	case "480p":
		return 480
	case "720p":
		return 720
	case "1080p":
		return 1080
	case "4k", "2160p":
		return 2160
	default:
		return 0
	}
}

// ProbeVideoDimensions 探测视频宽高（本机 ffprobe，接受本地路径或 http(s) 地址）
func ProbeVideoDimensions(ctx context.Context, pathOrURL string) (int, int, error) {
	ffprobe := findFFprobe()

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, ffprobe,
		"-v", "error",
		"-select_streams", "v:0",
		"-show_entries", "stream=width,height",
		"-of", "csv=p=0",
		pathOrURL,
	)
	out, err := cmd.Output()
	if err != nil {
		return 0, 0, fmt.Errorf("ffprobe 探测失败: %w", err)
	}

	fields := strings.Split(strings.TrimSpace(string(out)), ",")
	if len(fields) < 2 {
		return 0, 0, fmt.Errorf("ffprobe 输出无法解析: %q", strings.TrimSpace(string(out)))
	}
	w, errW := strconv.Atoi(strings.TrimSpace(fields[0]))
	h, errH := strconv.Atoi(strings.TrimSpace(fields[1]))
	if errW != nil || errH != nil || w <= 0 || h <= 0 {
		return 0, 0, fmt.Errorf("ffprobe 尺寸非法: %q", strings.TrimSpace(string(out)))
	}
	return w, h, nil
}

// ProbeVideoDimensionsFromBytes 探测内存里这段视频的宽高。
//
// 调用方通常刚把片子下载进内存（视频执行器就是这样），此时落一个临时文件再探测，
// 比再走一次网络（ffprobe 直接读远端 URL）便宜得多 —— 大文件尤其明显。
// mp4 的 moov 可能在文件尾部，走管道（pipe:0）会让 ffprobe 无法回退读取，故用临时文件。
func ProbeVideoDimensionsFromBytes(ctx context.Context, data []byte, ext string) (int, int, error) {
	if len(data) == 0 {
		return 0, 0, fmt.Errorf("视频字节为空")
	}
	if ext == "" {
		ext = ".mp4"
	}

	f, err := os.CreateTemp("", "probe-*"+ext)
	if err != nil {
		return 0, 0, fmt.Errorf("创建探测临时文件失败: %w", err)
	}
	path := f.Name()
	defer func() {
		_ = f.Close()
		_ = os.Remove(path)
	}()

	if _, err := f.Write(data); err != nil {
		return 0, 0, fmt.Errorf("写入探测临时文件失败: %w", err)
	}
	if err := f.Close(); err != nil {
		return 0, 0, fmt.Errorf("关闭探测临时文件失败: %w", err)
	}

	return ProbeVideoDimensions(ctx, path)
}
