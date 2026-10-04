package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
	"unicode/utf8"

	"libtv/internal/billing"
	"libtv/internal/idem"

	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/apperror"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// normalizeAssetRefs 规范化资产引用：把裸写的 @类型-资产名 强制补成（@类型-资产名）全角括号形式。
// 基于已知资产名单做精确匹配（LLM 输出的名称来自该名单），避免贪婪正则把后续汉字吞进名称。
// 已处于（@…）或 (@…) 内的引用跳过（不重复包裹）。
func normalizeAssetRefs(text string, refs []llm.AssetReference, refType string) string {
	if !strings.Contains(text, "@") {
		return text
	}
	for _, ref := range refs {
		name := strings.TrimSpace(ref.Name)
		if name == "" {
			continue
		}
		needle := "@" + refType + "-" + name
		pos := 0
		for {
			idx := strings.Index(text[pos:], needle)
			if idx < 0 {
				break
			}
			abs := pos + idx
			prev := rune(0)
			if abs > 0 {
				prev, _ = utf8.DecodeLastRuneInString(text[:abs])
			}
			if prev == '（' || prev == '(' {
				pos = abs + len(needle)
				continue
			}
			text = text[:abs] + "（" + needle + "）" + text[abs+len(needle):]
			pos = abs + len(needle) + 2
		}
	}
	return text
}

type PromptHandler struct {
	llmClient      *llm.Client
	modelManager   *llm.ModelManager
	biller         *billing.Service
	channelService *service.ChannelService
	// providerTasks 对账账本：提示词生成也是一次扣费=一次 AI 调用，同样要留痕、同样按
	// 「上游明确报错才自动退；超时/结果不完整交人工」处理
	providerTasks *billing.Ledger
	// idem 请求幂等：双击/重发只算一次调用、只扣一次费（同步接口没有队列那层防重）
	idem *idem.Store
}

func NewPromptHandler(llmClient *llm.Client, modelManager *llm.ModelManager, biller *billing.Service, ledger *billing.Ledger, idemStore *idem.Store, channelService ...*service.ChannelService) *PromptHandler {
	h := &PromptHandler{
		llmClient:     llmClient,
		modelManager:  modelManager,
		biller:        biller,
		providerTasks: ledger,
		idem:          idemStore,
	}
	if len(channelService) > 0 {
		h.channelService = channelService[0]
	}
	return h
}

// GeneratePromptRequest 生成提示词请求（画面 + 运动一起生成）
type GeneratePromptRequest struct {
	Model      string                    `json:"model" binding:"required"`    // 文本模型 ID
	ShotID     string                    `json:"shotId" binding:"required"`   // 镜头 ID
	ShotData   llm.ShotDataForGeneration `json:"shotData" binding:"required"` // 镜头数据
	Characters []llm.AssetReference      `json:"characters"`                  // 角色列表
	Scenes     []llm.AssetReference      `json:"scenes"`                      // 场景列表
	Props      []llm.AssetReference      `json:"props"`                       // 道具列表
	ImageCount int                       `json:"imageCount"`                  // 需要几份画面提示词（1=单张参考图；2=起始画面+结束画面），默认 1
	ProjectID  string                    `json:"projectId"`                   // 所在项目（对账用，可选）
}

// GeneratePromptResponse 生成提示词响应（画面 + 运动）
type GeneratePromptResponse struct {
	StoryboardPrompt  string   `json:"storyboardPrompt"`  // 生成的画面提示词（含 @ 引用）—— 多份时等于第 1 份，兼容旧前端
	StoryboardPrompts []string `json:"storyboardPrompts"` // 多份画面提示词（与参考图一一对应）
	MotionPrompt      string   `json:"motionPrompt"`      // 生成的运动提示词
	// Replayed 为 true 表示这是「刚刚那一次」的结果回放（窗口内重复点击，未重新生成、未再扣费）
	Replayed bool `json:"replayed,omitempty"`
}

// GeneratePrompt 生成提示词（画面 + 运动一起生成）
// POST /api/prompt/generate
func (h *PromptHandler) GeneratePrompt(c *gin.Context) {
	var req GeneratePromptRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, 400, "请求参数错误: "+err.Error())
		return
	}

	// 转换请求参数到 llm 包的类型
	shotData := llm.ShotDataForGeneration{
		Visual:             req.ShotData.Visual,
		ShotSize:           req.ShotData.ShotSize,
		CameraMovement:     req.ShotData.CameraMovement,
		Dialogue:           req.ShotData.Dialogue,
		SoundEffect:        req.ShotData.SoundEffect,
		LightingAtmosphere: req.ShotData.LightingAtmosphere,
		ToneHint:           req.ShotData.ToneHint,
	}

	characters := make([]llm.AssetReference, len(req.Characters))
	for i, c := range req.Characters {
		characters[i] = llm.AssetReference{
			Name:        c.Name,
			Description: c.Description,
			ImageURL:    c.ImageURL,
		}
	}

	scenes := make([]llm.AssetReference, len(req.Scenes))
	for i, s := range req.Scenes {
		scenes[i] = llm.AssetReference{
			Name:        s.Name,
			Description: s.Description,
			ImageURL:    s.ImageURL,
		}
	}

	props := make([]llm.AssetReference, len(req.Props))
	for i, p := range req.Props {
		props[i] = llm.AssetReference{
			Name:        p.Name,
			Description: p.Description,
			ImageURL:    p.ImageURL,
		}
	}

	// 解析用户最终渠道（全局策略 + 用户渠道）：用于按渠道查找模型、计费账单带渠道前缀、调用走对应 token
	billCtx := c.Request.Context()
	channel := ""
	if h.channelService != nil {
		channel = h.channelService.ResolveUserChannel(billCtx, middleware.GetUserID(c))
		billCtx = llm.WithChannel(billCtx, channel)
	}

	// 模型 ID 映射：前端传 ID（如 'text-general'），需在当前渠道内转换为 model_id
	// （华数/电信存在同名模型，必须按渠道查找，避免取到另一渠道的配置）
	modelConfig := h.modelManager.FindModelByIDForChannel(channel, req.Model)
	if modelConfig == nil {
		response.Fail(c, 400, "模型不存在: "+req.Model)
		return
	}

	// 请求幂等：同一个「镜头 + 模型 + 份数」在窗口内再来一次，不再调用上游、不再扣费。
	// 这一步必须在扣费之前 —— 双击最容易发生在扣费之后、结果回来之前。
	idemKey := idem.Fingerprint("prompt", middleware.GetUserID(c), req.ShotID, modelConfig.ModelID, fmt.Sprint(req.ImageCount))
	switch state, cached, _ := h.idem.Begin(c.Request.Context(), idemKey, 5*time.Minute); state {
	case idem.Done:
		var resp GeneratePromptResponse
		if err := json.Unmarshal(cached, &resp); err == nil {
			log.Printf("[PromptHandler] ♻ 同一请求刚成功过，直接回放结果（不重复扣费）: shot=%s", req.ShotID)
			resp.Replayed = true // 让界面能提示「这是刚才那次的结果」
			response.OK(c, resp)
			return
		}
	case idem.InFlight:
		log.Printf("[PromptHandler] ⛔ 同一请求正在处理中，拒绝重复调用（不扣费）: shot=%s", req.ShotID)
		response.Fail(c, 409, "这条分镜的提示词正在生成中，请稍候（不要重复点击）")
		return
	}

	// 扣费校验：通过后才调用 LLM（账单记录模型与场景；文本模型按次计费）
	// 扣费编号先算出来：它同时写进扣费账单分录和对账行，是两边唯一的关联凭据
	chargeKey := billing.NewChargeKey()
	billCtx = billing.WithChargeKey(billCtx, chargeKey)
	chargedAmount, err := h.biller.ChargeByModel(billCtx, middleware.GetUserID(c), billing.ActionPromptGenerate, modelConfig.ModelID, "提示词生成", 1)
	if err != nil {
		c.JSON(apperror.HTTPStatusFromError(err), gin.H{
			"code": apperror.CodeFromError(err),
			"msg":  apperror.MsgFromError(err),
		})
		return
	}

	// 对账 + 失败结算统一走 billing.SyncCall：提示词生成是前端直连的接口，
	// 没有执行号/节点号、也没有上游任务号
	call := billing.SyncCall{
		Ledger:    h.providerTasks,
		Biller:    h.biller,
		ChargeKey: chargeKey,
		Kind:      billing.ActionPromptGenerate,
		Scene:     "提示词生成",
		Model:     modelConfig.ModelID,
		Provider:  llm.ChannelFrom(billCtx),
		UserID:    middleware.GetUserID(c),
		ProjectID: req.ProjectID,
		Charged:   chargedAmount,
	}
	call.Write(c.Request.Context(), billing.StatusSubmitted, "", 0)

	// 参考图张数：1=单张，2=起始画面+结束画面（多份提示词一次生成，只扣一次费）
	imageCount := req.ImageCount
	if imageCount <= 0 {
		imageCount = 1
	}
	if imageCount > 9 {
		imageCount = 9
	}

	// 调用 LLM 生成提示词（画面 + 运动）
	storyboardPrompts, motionPrompt, err := h.llmClient.GeneratePrompt(
		c.Request.Context(),
		modelConfig.ModelID, // 使用完整的 model_id
		shotData,
		characters,
		scenes,
		props,
		imageCount,
	)
	if err != nil {
		// 规则与视频/图片一致：上游明确报错才自动退；超时、被掐断、没拿到结果不自动退，
		// 进对账表交人工复核（渠道随 ctx 带过去，不会记成默认 wasu）
		h.idem.Release(c.Request.Context(), idemKey) // 失败 → 撤掉认领，用户重试仍然有效
		settled := call.Settle(llm.WithChannel(context.WithoutCancel(c.Request.Context()), llm.ChannelFrom(billCtx)), err)
		response.Fail(c, 500, "生成提示词失败: "+settled.Error())
		return
	}

	// 模型输出格式异常导致画面/运动缺失（要求几份就得有几份）：不能让用户为半残结果买单，退费并提示重试
	incomplete := motionPrompt == "" || len(storyboardPrompts) < imageCount
	if !incomplete {
		for _, sp := range storyboardPrompts {
			if sp == "" {
				incomplete = true
				break
			}
		}
	}
	if incomplete {
		// 上游正常返回了（也大概率按次计费了），只是内容不完整 —— 这不是「上游拒绝本次任务」，
		// 按规则不自动退费：写进对账表，管理员看到「结果不完整」再决定退不退
		reason := "生成结果不完整（画面或运动提示词缺失）；本次扣费未自动退还，已提交人工复核"
		call.Write(c.Request.Context(), billing.StatusPendingReview, reason, 0)
		h.idem.Release(c.Request.Context(), idemKey)
		response.Fail(c, 500, "生成结果不完整（画面或运动提示词缺失）；本次扣费未自动退还，已提交人工复核，确认无效后会原路退还")
		return
	}

	// 逐份做资产引用归一化
	normalized := make([]string, len(storyboardPrompts))
	for i, sp := range storyboardPrompts {
		normalized[i] = normalizeAssetRefs(normalizeAssetRefs(sp, characters, "角色"), scenes, "场景")
	}

	call.Write(c.Request.Context(), billing.StatusDelivered, "", 0)

	// 响应只构造一次，既用于返回也用于幂等缓存（避免两处写法漂移）
	resp := GeneratePromptResponse{
		StoryboardPrompt:  normalized[0],
		StoryboardPrompts: normalized,
		MotionPrompt:      normalizeAssetRefs(normalizeAssetRefs(normalizeAssetRefs(motionPrompt, characters, "角色"), scenes, "场景"), props, "道具"),
	}
	// 幂等：存结果，窗口内同一个请求再来直接回放（不再扣费）
	h.idem.Finish(c.Request.Context(), idemKey, resp, 60*time.Second)

	response.OK(c, resp)
}
