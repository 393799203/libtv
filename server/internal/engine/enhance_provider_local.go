package engine

import (
	"context"
	"fmt"
	"os"

	"libtv/internal/service"
)

// ffmpegLocalProvider 本机 FFmpeg 渠道的实现（P0）。
//
// 特点：零成本、素材不出境、纯 CPU，只做「去块 + 轻降噪 + 锐化（可放大到 720p）」，
// 不做补帧、不生成新细节。
//
// 展示信息（名称/描述）不在这里 —— 那是配置（enhance.yaml）的事，
// 这个文件只回答「怎么处理」，以及「我认识哪些档位」。
type ffmpegLocalProvider struct{}

func init() {
	RegisterEnhanceImpl(ffmpegLocalProvider{})
}

func (ffmpegLocalProvider) Name() string { return "ffmpeg" }

// SupportedModes 本机档认识的两个档位（与 enhance.yaml 里的 id 对应）：
// 配置里写了别的档位（比如云端才有的 sr/interp）会被注册表剔除并告警
func (ffmpegLocalProvider) SupportedModes() []string {
	return []string{service.LiteEnhanceClean, service.LiteEnhanceHD}
}

// NeedsSourceBytes 需要：ffmpeg 只能吃本地文件
func (ffmpegLocalProvider) NeedsSourceBytes() bool { return true }

func (ffmpegLocalProvider) Enhance(ctx context.Context, req EnhanceRequest, progress func(string)) (EnhanceOutcome, error) {
	if len(req.SourceBytes) == 0 {
		return EnhanceOutcome{}, fmt.Errorf("本机 FFmpeg 渠道需要源视频字节，但上游没有提供")
	}

	// 档位 → 处理语义：档位 ID 与 cleaner 的 Level 同名（clean/hd），
	// 这样配置里改的是「展示与参数」，而处理语义仍由实现决定
	level := service.NormalizeLiteEnhance(req.Mode)
	if level == service.LiteEnhanceOff {
		return EnhanceOutcome{}, fmt.Errorf("本机 FFmpeg 不认识档位 %q", req.Mode)
	}

	// 放大目标短边来自档位配置（enhance.yaml 的 modes[].params.target_short_side），
	// 没配就交给 service 的默认值
	targetShortSide := 0
	if req.Params != nil {
		if v, ok := req.Params["target_short_side"]; ok {
			switch n := v.(type) {
			case int:
				targetShortSide = n
			case int64:
				targetShortSide = int(n)
			case float64:
				targetShortSide = int(n)
			}
		}
	}

	inPath, outPath, cleanup, err := service.LiteEnhanceTempPaths(req.SourceExt)
	if err != nil {
		return EnhanceOutcome{}, err
	}
	defer cleanup()

	if err := os.WriteFile(inPath, req.SourceBytes, 0o600); err != nil {
		return EnhanceOutcome{}, fmt.Errorf("write temp input: %w", err)
	}

	if progress != nil {
		progress("清晰化处理中…")
	}

	res, err := service.EnhanceLite(ctx, inPath, outPath, service.LiteEnhanceOptions{
		Level:           level,
		TargetShortSide: targetShortSide,
	})
	if err != nil {
		return EnhanceOutcome{}, err
	}

	out, err := os.ReadFile(outPath)
	if err != nil {
		return EnhanceOutcome{}, fmt.Errorf("读取清晰化结果失败: %w", err)
	}
	if len(out) == 0 {
		return EnhanceOutcome{}, fmt.Errorf("清晰化结果为空")
	}

	note := fmt.Sprintf("本机 FFmpeg · %dx%d · %.1fs", res.TargetW, res.TargetH, float64(res.ElapsedMS)/1000)

	return EnhanceOutcome{
		Bytes: out,
		Note:  note,
		Meta: map[string]interface{}{
			"enhanceLevel":      res.Level, // 兼容旧前端徽标
			"enhanceMode":       res.Level,
			"enhanceFilter":     res.Filter,
			"enhanceElapsedMs":  res.ElapsedMS,
			"enhanceSourceSize": fmt.Sprintf("%dx%d", res.SourceW, res.SourceH),
			"enhanceTargetSize": fmt.Sprintf("%dx%d", res.TargetW, res.TargetH),
			"enhanceUpscaled":   res.Upscaled,
		},
	}, nil
}
