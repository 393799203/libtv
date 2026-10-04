package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"libtv/internal/service"
)

// EnhanceExecutor 清晰化节点执行器（P0 本地档）。
//
// 为什么是独立节点而不是挂在视频节点上（设计取舍，见 docs/视频清晰化与补帧-调研与接入方案.md）：
//  1. 能对**已有素材**重做：直接读上游节点上已存在的 videoUrl，不必重新生成、不重复扣费；
//  2. A/B 便宜：同一片段可以反复试不同档位，成本只花在清晰化这一层；
//  3. 工程隔离：清晰化是 CPU 长任务，独立节点才能有独立超时与并发闸门，不挤占生成队列的 10 个 worker；
//  4. 它是 P1 的落点：将来换成腾讯云 MPS/火山的云端超分与补帧，只需在这里换 provider，接线不用再动。
//
// P0 档位只用本机 ffmpeg（去块 + 轻降噪 + 锐化，可选放大到 720p）：
// 不调用任何外部服务、不产生外部成本、素材不出境、不做补帧、不生成新细节（不幻觉）。
type EnhanceExecutor struct {
	fileUploadService *service.FileUploadService
}

func NewEnhanceExecutor(fileUploadService *service.FileUploadService) *EnhanceExecutor {
	return &EnhanceExecutor{fileUploadService: fileUploadService}
}

// enhanceNodeData 清晰化节点的数据
type enhanceNodeData struct {
	// Provider 渠道 ID（见 enhance_provider.go）。空 = 默认渠道（配置里第一条可用渠道）。
	// 渠道与档位都由 configs/enhance.yaml 定义，前端选项来自 /api/enhance/providers
	Provider string `json:"provider"`
	// Mode 档位 ID（clean / hd，将来云端档是 sr / interp 等），空 = 该渠道的默认档
	Mode string `json:"mode"`
	// Level 旧字段：P0 首版把档位叫 level。老画布上还留着它，
	// 读的时候作为 Mode 的兜底 —— 不能让今天还在画布上的节点因为改名就跑到默认档上去
	Level           string `json:"level"`
	TargetShortSide int    `json:"targetShortSide"` // 旧字段：放大目标短边，现由档位配置提供
	SourceNodeID    string `json:"sourceNodeId"`    // 可选：显式指定源视频节点（不填则取上游连线）
}

func (e *EnhanceExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data enhanceNodeData
	if len(node.Data) > 0 {
		if err := json.Unmarshal(node.Data, &data); err != nil {
			return nil, fmt.Errorf("parse enhance node data: %w", err)
		}
	}

	// 0) 解析渠道 + 档位：未知渠道、未开通渠道、该渠道不支持的档位都在这里明确拒绝 ——
	// 绝不能静默降级到本机档，否则用户以为在用云端档、实际拿的是本机处理结果
	modeID := data.Mode
	if modeID == "" {
		modeID = data.Level // 老画布兜底
	}
	resolved, err := ResolveEnhance(data.Provider, modeID)
	if err != nil {
		return nil, err
	}
	provider, mode := resolved.Impl, resolved.Mode

	// 1) 找源视频：显式指定的优先，其次找上游连线（连接关系本身就是「处理它」的意图）
	sourceNodeID, sourceURL, err := resolveSourceVideo(execCtx, node.ID, data.SourceNodeID)
	if err != nil {
		return nil, err
	}
	log.Printf("[EnhanceExecutor] nodeID=%s 渠道=%s(%s) 档位=%s(%s) 源视频节点=%s url=%s",
		node.ID, resolved.Channel.ID, resolved.Channel.Label, mode.ID, mode.Label, sourceNodeID, sourceURL)

	// 2) 源视频：本机档必须下载成字节；云端档只把 URL 交给对方（省一次几十 MB 的下载）
	req := EnhanceRequest{
		SourceURL: sourceURL,
		Channel:   resolved.Channel.ID,
		Mode:      mode.ID,
		Params:    mode.Params,
	}
	// 旧字段兜底：老画布上如果改过 targetShortSide，仍尊重它的值
	if data.TargetShortSide > 0 {
		if req.Params == nil {
			req.Params = map[string]interface{}{}
		}
		if _, ok := req.Params["target_short_side"]; !ok {
			req.Params["target_short_side"] = data.TargetShortSide
		}
	}
	if provider.NeedsSourceBytes() {
		execCtx.SetNodeProgress(node.ID, "下载源视频…")
		srcBytes, srcExt, dlErr := downloadVideoBytes(ctx, sourceURL)
		if dlErr != nil {
			return nil, fmt.Errorf("下载源视频失败: %w", dlErr)
		}
		req.SourceBytes, req.SourceExt = srcBytes, srcExt
		log.Printf("[EnhanceExecutor] 源视频下载完成: nodeID=%s size=%dB ext=%s", node.ID, len(srcBytes), srcExt)
	}

	// 3) 交给渠道干活（进度、超时、并发闸门都由渠道内部负责）
	execCtx.SetNodeProgress(node.ID, "清晰化处理中…")
	outcome, err := provider.Enhance(ctx, req, func(msg string) {
		execCtx.SetNodeProgress(node.ID, msg)
	})
	if err != nil {
		// 与视频节点不同：这里清晰化就是节点本身的产出，
		// 没有「回退成原始视频」这个选项 —— 否则用户会以为处理成功，实则拿到原片（假成功）。
		return nil, fmt.Errorf("清晰化失败（%s · %s）: %w", resolved.Channel.Label, mode.Label, err)
	}

	// 4) 结果落库：本机档给字节（转存到自有存储），云端档给远端地址（同样转存，保证不过期）
	execCtx.SetNodeProgress(node.ID, "保存结果…")
	videoURL, err := e.storeEnhanceOutcome(execCtx, outcome)
	if err != nil {
		return nil, err
	}

	log.Printf("[EnhanceExecutor] ✅ 清晰化完成: nodeId=%s 渠道=%s 档位=%s note=%q url=%s meta=%v",
		node.ID, resolved.Channel.ID, mode.ID, outcome.Note, videoURL, outcome.Meta)

	// 渠道留痕原样进节点数据：前端据此显示「已清晰化 · 渠道 · 档位 · 尺寸 · 耗时」
	outData := map[string]interface{}{
		"videoUrl":  videoURL,
		"sourceUrl": sourceURL,
		// 渠道：provider 是 P0 首版的字段名，channel 是现在的叫法，两个都写一份，
		// 让还没刷新页面的旧前端也能显示出来
		"enhanceProvider":      resolved.Channel.ID,
		"enhanceChannel":       resolved.Channel.ID,
		"enhanceProviderLabel": resolved.Channel.Label,
		"enhanceChannelLabel":  resolved.Channel.Label,
		// 档位：mode 是现在的叫法（level 由渠道实现的 meta 带出，兼容旧徽标）
		"enhanceRequestedMode": mode.ID,
		"enhanceModeLabel":     mode.Label,
		"enhanceNote":          outcome.Note,
		"enhanceSourceNodeId":  sourceNodeID,
	}
	for k, v := range outcome.Meta {
		outData[k] = v
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data:   outData,
	}, nil
}

// storeEnhanceOutcome 把渠道产出的结果落到自有存储。
//
// 为什么要「云端档给的地址也转存」：上游给的多半是限时 URL（阿里云 30 分钟、腾讯云 COS 签名几小时），
// 直接把它写进节点数据、过一阵用户再看就是死链 —— 而账早扣了（假成功）。
func (e *EnhanceExecutor) storeEnhanceOutcome(execCtx *ExecutionContext, outcome EnhanceOutcome) (string, error) {
	var data []byte
	if len(outcome.Bytes) > 0 {
		data = outcome.Bytes
	} else if outcome.URL != "" {
		fetched, _, err := downloadVideoBytes(context.Background(), outcome.URL)
		if err != nil {
			return "", fmt.Errorf("下载渠道结果失败: %w", err)
		}
		data = fetched
	} else {
		return "", fmt.Errorf("清晰化渠道没有返回结果（既无字节也无地址）")
	}

	result, err := e.fileUploadService.UploadFromReader(bytes.NewReader(data), int64(len(data)), "video.mp4", service.UploadOptions{
		Dir:            execCtx.GetCanvasDir(),
		ProjectID:      execCtx.GetProjectID(),
		DefaultExt:     ".mp4",
		ContentTypeFor: service.ContentTypeForVideo,
	})
	if err != nil {
		return "", fmt.Errorf("上传清晰化结果失败: %w", err)
	}
	return result.URL, nil
}

// resolveSourceVideo 找到待处理的源视频 URL。
//
// 取值顺序（前者优先）：
//  1. 显式指定的 sourceNodeId；
//  2. 上游连线中「本次执行刚产出视频」的节点（同一次运行里的新鲜结果）；
//  3. 上游连线中「节点数据里已存有 videoUrl」的节点（对老片重做，不必重新生成）。
//
// 第 3 条是这个节点存在的核心理由：用户可以对画布上任何已生成的片段做清晰化，零重复生成成本。
func resolveSourceVideo(execCtx *ExecutionContext, selfNodeID, explicitSourceNodeID string) (string, string, error) {
	candidates := make([]string, 0, 4)
	if explicitSourceNodeID != "" {
		candidates = append(candidates, explicitSourceNodeID)
	}
	for _, src := range execCtx.GetUpstreamSources(selfNodeID) {
		if src == explicitSourceNodeID {
			continue
		}
		candidates = append(candidates, src)
	}

	if len(candidates) == 0 {
		return "", "", fmt.Errorf("清晰化节点没有输入：请把一个视频节点连到它上面（或指定 sourceNodeId）")
	}

	// 先看本次执行已产出的结果
	for _, src := range candidates {
		if out, ok := execCtx.GetOutput(src); ok && out != nil {
			if url := outputVideoURL(out.Data); url != "" {
				return src, url, nil
			}
		}
	}
	// 再看节点上已存的 videoUrl（老片重做路径）
	for _, src := range candidates {
		raw, ok := execCtx.GetNodeData(src)
		if !ok || len(raw) == 0 {
			continue
		}
		var nd struct {
			Type     string `json:"type"`
			VideoUrl string `json:"videoUrl"`
			StillUrl string `json:"stillUrl"`
		}
		if err := json.Unmarshal(raw, &nd); err != nil {
			continue
		}
		if nd.VideoUrl != "" {
			return src, nd.VideoUrl, nil
		}
	}

	return "", "", fmt.Errorf("上游节点没有可用的视频（共检查 %d 个上游节点）：请先生成视频或连一个有视频的节点", len(candidates))
}

// outputVideoURL 从节点输出里取出视频地址（video 节点用 videoUrl，清晰化/白模节点也走这个键）
func outputVideoURL(data map[string]interface{}) string {
	if data == nil {
		return ""
	}
	if v, ok := data["videoUrl"].(string); ok {
		return v
	}
	return ""
}

// downloadVideoBytes 下载视频到内存并推断扩展名
func downloadVideoBytes(ctx context.Context, url string) ([]byte, string, error) {
	httpClient := &http.Client{Timeout: 300 * time.Second}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, "", fmt.Errorf("create request: %w", err)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("download: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("download failed: status=%d", resp.StatusCode)
	}

	buf, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("read body: %w", err)
	}

	ext := ".mp4"
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "webm") {
		ext = ".webm"
	} else if strings.Contains(contentType, "mov") {
		ext = ".mov"
	}
	return buf, ext, nil
}
