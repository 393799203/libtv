package handler

import (
	"log"
	"strings"

	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/apperror"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type PrevizHandler struct {
	llmClient    *llm.Client
	imageClient  *llm.ImageClient // 本地图片转 base64 用
	modelManager *llm.ModelManager
	biller       *service.BillingService
}

func NewPrevizHandler(llmClient *llm.Client, imageClient *llm.ImageClient, modelManager *llm.ModelManager, biller *service.BillingService) *PrevizHandler {
	return &PrevizHandler{
		llmClient:    llmClient,
		imageClient:  imageClient,
		modelManager: modelManager,
		biller:       biller,
	}
}

// AnalyzeSceneRequest 白模场景解析请求
type AnalyzeSceneRequest struct {
	ImageURL string `json:"image_url" binding:"required"` // 参考图 URL（本地相对路径或公网 URL）
	Model    string `json:"model"`                        // 视觉模型 ID（可选，默认 doubao-seed-2.0-lite）
}

// AnalyzeScene AI 建白模：视觉模型分析参考图 → 返回几何体布局 JSON
// POST /api/previz/analyze-scene
func (h *PrevizHandler) AnalyzeScene(c *gin.Context) {
	var req AnalyzeSceneRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, 400, "请求参数错误: "+err.Error())
		return
	}

	// 默认视觉模型（快/便宜）
	modelID := req.Model
	if modelID == "" {
		modelID = "doubao-seed-2.0-lite"
	}

	// 模型 ID 映射：前端传 ID，需要转换为 model_id
	modelConfig := h.modelManager.FindModelByID(modelID)
	if modelConfig == nil {
		response.Fail(c, 400, "模型不存在: "+modelID)
		return
	}

	// 扣费校验：通过后才调用 LLM（文本/视觉模型按次计费）
	userID := middleware.GetUserID(c)
	chargedAmount, err := h.biller.ChargeByModel(c.Request.Context(), userID, service.BillingActionPrevizAnalyze, modelConfig.ModelID, "白模场景解析", 1)
	if err != nil {
		c.JSON(apperror.HTTPStatusFromError(err), gin.H{
			"code": apperror.CodeFromError(err),
			"msg":  apperror.MsgFromError(err),
		})
		return
	}

	// 退费辅助：解析/调用失败不能让用户买单
	refund := func(reason string) {
		if refundErr := h.biller.Refund(c.Request.Context(), userID, chargedAmount, service.BillingActionPrevizAnalyze, modelConfig.ModelID, "白模场景解析"); refundErr != nil {
			log.Printf("[PrevizHandler] 退费失败(%s): %v", reason, refundErr)
		}
	}

	// 本地相对路径图片（/ 开头）先转 base64，公网 URL 直接使用
	imageURL := req.ImageURL
	isPublicURL := (strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://")) &&
		!strings.Contains(imageURL, "localhost") &&
		!strings.Contains(imageURL, "127.0.0.1")
	if !isPublicURL {
		base64Data, err := h.imageClient.ConvertLocalImageToBase64(c.Request.Context(), imageURL)
		if err != nil {
			log.Printf("[PrevizHandler] 本地图片转 base64 失败: %v", err)
			refund("图片转换失败")
			response.Fail(c, 500, "参考图读取失败，请重新上传")
			return
		}
		imageURL = base64Data
	}

	// 调用视觉模型解析场景
	objects, description, err := h.llmClient.AnalyzeSceneImage(c.Request.Context(), modelConfig.ModelID, imageURL)
	if err != nil {
		log.Printf("[PrevizHandler] 场景解析失败: %v", err)
		refund("解析失败")
		response.Fail(c, 500, err.Error()+"，已退费，请重试")
		return
	}

	response.OK(c, gin.H{
		"objects":     objects,
		"description": description,
	})
}
