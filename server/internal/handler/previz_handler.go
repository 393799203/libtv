package handler

import (
	"context"
	"encoding/json"
	"libtv/internal/billing"
	"libtv/internal/idem"
	"log"
	"strings"
	"time"

	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/apperror"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type PrevizHandler struct {
	llmClient      *llm.Client
	imageClient    *llm.ImageClient // 本地图片转 base64 用
	modelManager   *llm.ModelManager
	biller         *billing.Service
	channelService *service.ChannelService
	// providerTasks 对账账本：白模场景解析也是「一次扣费 = 一次 AI 调用」，
	// 同样要留痕、同样按「上游明确报错才自动退，超时/没拿到交人工」处理
	providerTasks *billing.Ledger
	// idem 请求幂等：双击/重发只算一次调用、只扣一次费（同步接口没有队列那层防重）
	idem *idem.Store
}

func NewPrevizHandler(llmClient *llm.Client, imageClient *llm.ImageClient, modelManager *llm.ModelManager, biller *billing.Service, ledger *billing.Ledger, idemStore *idem.Store, channelService ...*service.ChannelService) *PrevizHandler {
	h := &PrevizHandler{
		llmClient:     llmClient,
		imageClient:   imageClient,
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

// analyzeSceneResult 白模解析响应（同时用于幂等回放缓存）
type analyzeSceneResult struct {
	Objects     []llm.PrevizSceneObject `json:"objects"`
	Description string                  `json:"description"`
	// Replayed 为 true 表示这是「刚刚那一次」的结果回放（窗口内重复点击，未重新解析、未再扣费）
	Replayed bool `json:"replayed,omitempty"`
}

// AnalyzeSceneRequest 白模场景解析请求
type AnalyzeSceneRequest struct {
	ImageURL  string `json:"image_url" binding:"required"` // 参考图 URL（本地相对路径或公网 URL）
	Model     string `json:"model"`                        // 视觉模型 ID（可选，默认 doubao-seed-2.0-lite）
	ProjectID string `json:"projectId"`                    // 所在项目（对账用，可选）
}

// AnalyzeScene AI 建白模：视觉模型分析参考图 → 返回几何体布局 JSON
// POST /api/previz/analyze-scene
func (h *PrevizHandler) AnalyzeScene(c *gin.Context) {
	var req AnalyzeSceneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, 400, "请求参数错误: "+err.Error())
		return
	}

	// 解析用户最终渠道（全局策略 + 用户渠道），供视觉模型走对应 token
	channel := "wasu"
	if h.channelService != nil {
		channel = h.channelService.ResolveUserChannel(c.Request.Context(), middleware.GetUserID(c))
	}

	// 默认视觉模型（快/便宜）；按渠道取不同默认（电信=deepseek-v4.1-flash 多模态，华数=Seed 2.1 Turbo）
	modelID := req.Model
	if modelID == "" {
		if channel == "dianxin" {
			modelID = "deepseek-v4.1-flash"
		} else {
			modelID = "doubao-seed-2.1-turbo"
		}
	}

	// 模型 ID 映射：前端传 ID，需在当前渠道内转换为 model_id
	// （华数/电信存在同名模型，必须按渠道查找，避免取到另一渠道的配置）
	modelConfig := h.modelManager.FindModelByIDForChannel(channel, modelID)
	if modelConfig == nil {
		response.Fail(c, 400, "模型不存在: "+modelID)
		return
	}

	userID := middleware.GetUserID(c)
	// 请求幂等：同一张参考图 + 同一个模型在窗口内再来一次，不再调用上游、不再扣费。
	// 必须在扣费之前 —— 视觉模型要跑 1~2 分钟，这期间用户最容易以为卡住又点一次。
	idemKey := idem.Fingerprint("previz", userID, req.ImageURL, modelConfig.ModelID)
	switch state, cached, _ := h.idem.Begin(c.Request.Context(), idemKey, 5*time.Minute); state {
	case idem.Done:
		var resp analyzeSceneResult
		if err := json.Unmarshal(cached, &resp); err == nil {
			log.Printf("[PrevizHandler] ♻ 同一请求刚成功过，直接回放结果（不重复扣费）")
			resp.Replayed = true // 让界面能提示「这是刚才那次的结果」
			response.OK(c, resp)
			return
		}
	case idem.InFlight:
		log.Printf("[PrevizHandler] ⛔ 同一请求正在处理中，拒绝重复调用（不扣费）")
		response.Fail(c, 409, "这张参考图正在解析中，请稍候（不要重复点击）")
		return
	}

	// 扣费校验：通过后才调用 LLM（文本/视觉模型按次计费）
	// 必须先注入用户渠道再扣费：定价按「渠道 + 节点 + 模型」查表，
	// 不注入会回退 wasu，导致电信独有的视觉模型（如 glm-5.3-flash）在 wasu 价格表里查不到，
	// cost=0 则既不扣费也不拦余额（余额不足直接放行），账单渠道前缀也会错写成 wasu
	billCtx := llm.WithChannel(c.Request.Context(), channel)
	// 扣费编号先算出来：它同时写进扣费账单分录和对账行，是两边唯一的关联凭据
	chargeKey := billing.NewChargeKey()
	billCtx = billing.WithChargeKey(billCtx, chargeKey)
	chargedAmount, err := h.biller.ChargeByModel(billCtx, userID, billing.ActionPrevizAnalyze, modelConfig.ModelID, "白模场景解析", 1)
	if err != nil {
		c.JSON(apperror.HTTPStatusFromError(err), gin.H{
			"code": apperror.CodeFromError(err),
			"msg":  apperror.MsgFromError(err),
		})
		return
	}

	// 对账 + 失败结算统一走 billing.SyncCall：白模解析是前端直连的接口，
	// 没有执行号/节点号、也没有上游任务号，用「用户+时间」当编号，一次调用一行
	call := billing.SyncCall{
		Ledger:    h.providerTasks,
		Biller:    h.biller,
		ChargeKey: chargeKey,
		Kind:      billing.ActionPrevizAnalyze,
		Scene:     "白模场景解析",
		Model:     modelConfig.ModelID,
		Provider:  llm.ChannelFrom(billCtx),
		UserID:    userID,
		ProjectID: req.ProjectID,
		Charged:   chargedAmount,
	}
	call.Write(c.Request.Context(), billing.StatusSubmitted, "", 0)

	// 本地相对路径图片（/ 开头）先转 base64，公网 URL 直接使用
	imageURL := req.ImageURL
	isPublicURL := (strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://")) &&
		!strings.Contains(imageURL, "localhost") &&
		!strings.Contains(imageURL, "127.0.0.1")
	if !isPublicURL {
		base64Data, err := h.imageClient.ConvertLocalImageToBase64(c.Request.Context(), imageURL)
		if err != nil {
			log.Printf("[PrevizHandler] 本地图片转 base64 失败: %v", err)
			// 请求根本没发出去，上游不可能计费 → 直接退（这类必须退）
			if refundErr := h.biller.RefundDetached(billCtx, userID, chargedAmount,
				billing.ActionPrevizAnalyze, modelConfig.ModelID, "白模场景解析",
				"参考图读取失败（未调用上游）", billing.ChargeExtra{}); refundErr != nil {
				log.Printf("[PrevizHandler] 退费失败（参考图读取失败）: %v", refundErr)
				call.Write(c.Request.Context(), billing.StatusPendingReview, "参考图读取失败且退费失败，待人工处理", 0)
			} else {
				call.Write(c.Request.Context(), billing.StatusRefunded, "参考图读取失败（未调用上游），已退还本次扣费", chargedAmount)
			}
			response.Fail(c, 500, "参考图读取失败，请重新上传")
			return
		}
		imageURL = base64Data
	}

	// 调用视觉模型解析场景（复用上面的 billCtx：已注入用户渠道供多 token 路由）
	ctx := billCtx
	objects, description, err := h.llmClient.AnalyzeSceneImage(ctx, modelConfig.ModelID, imageURL)
	if err != nil {
		log.Printf("[PrevizHandler] 场景解析失败: %v", err)
		// 上游明确报错 → 自动退；超时/没拿到结果 → 不退，交人工决定（与视频同一套规则）
		// 渠道必须带进退费 ctx：裸请求 ctx 没有渠道，退费会按默认 wasu 记账，
		// 而这次扣费记的是 dianxin —— 同一笔业务扣费与退费渠道自相矛盾
		h.idem.Release(c.Request.Context(), idemKey) // 失败 → 撤掉认领，用户重试仍然有效
		settled := call.Settle(llm.WithChannel(context.WithoutCancel(c.Request.Context()), llm.ChannelFrom(billCtx)), err)
		response.Fail(c, 500, settled.Error())
		return
	}

	call.Write(c.Request.Context(), billing.StatusDelivered, "", 0)
	// 幂等：结果存起来，窗口内同一请求再来直接回放（不再扣费）
	// 响应只构造一次，既用于返回也用于幂等缓存
	result := analyzeSceneResult{Objects: objects, Description: description}
	h.idem.Finish(c.Request.Context(), idemKey, result, 120*time.Second)

	response.OK(c, gin.H{
		"objects":     objects,
		"description": description,
	})
}
