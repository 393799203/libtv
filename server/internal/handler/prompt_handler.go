package handler

import (
	"log"

	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/apperror"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type PromptHandler struct {
	llmClient    *llm.Client
	modelManager *llm.ModelManager
	biller       *service.BillingService
}

func NewPromptHandler(llmClient *llm.Client, modelManager *llm.ModelManager, biller *service.BillingService) *PromptHandler {
	return &PromptHandler{
		llmClient:    llmClient,
		modelManager: modelManager,
		biller:       biller,
	}
}

// GeneratePromptRequest 生成提示词请求（画面 + 运动一起生成）
type GeneratePromptRequest struct {
	Model      string                    `json:"model" binding:"required"`    // 文本模型 ID
	ShotID     string                    `json:"shotId" binding:"required"`   // 镜头 ID
	ShotData   llm.ShotDataForGeneration `json:"shotData" binding:"required"` // 镜头数据
	Characters []llm.AssetReference      `json:"characters"`                  // 角色列表
	Scenes     []llm.AssetReference      `json:"scenes"`                      // 场景列表
	Props      []llm.AssetReference      `json:"props"`                       // 道具列表
}

// GeneratePromptResponse 生成提示词响应（画面 + 运动）
type GeneratePromptResponse struct {
	StoryboardPrompt string `json:"storyboardPrompt"` // 生成的画面提示词（含 @ 引用）
	MotionPrompt     string `json:"motionPrompt"`     // 生成的运动提示词
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

	// 模型 ID 映射：前端传 ID（如 'text-general'），需要转换为 model_id（如 'deepseek-ai/DeepSeek-V4-Flash'）
	modelConfig := h.modelManager.FindModelByID(req.Model)
	if modelConfig == nil {
		response.Fail(c, 400, "模型不存在: "+req.Model)
		return
	}

	// 扣费校验：通过后才调用 LLM（账单记录模型与场景；文本模型按次计费）
	chargedAmount, err := h.biller.ChargeByModel(c.Request.Context(), middleware.GetUserID(c), service.BillingActionPromptGenerate, modelConfig.ModelID, "提示词生成", 1)
	if err != nil {
		c.JSON(apperror.HTTPStatusFromError(err), gin.H{
			"code": apperror.CodeFromError(err),
			"msg":  apperror.MsgFromError(err),
		})
		return
	}

	// 调用 LLM 生成提示词（画面 + 运动）
	storyboardPrompt, motionPrompt, err := h.llmClient.GeneratePrompt(
		c.Request.Context(),
		modelConfig.ModelID, // 使用完整的 model_id
		shotData,
		characters,
		scenes,
		props,
	)
	if err != nil {
		response.Fail(c, 500, "生成提示词失败: "+err.Error())
		return
	}

	// 模型输出格式异常导致画面/运动任一为空：不能让用户为半残结果买单，退费并提示重试
	if storyboardPrompt == "" || motionPrompt == "" {
		if refundErr := h.biller.Refund(c.Request.Context(), middleware.GetUserID(c), chargedAmount, service.BillingActionPromptGenerate, modelConfig.ModelID, "提示词生成"); refundErr != nil {
			log.Printf("[PromptHandler] 退费失败: %v", refundErr)
		}
		response.Fail(c, 500, "生成结果不完整（画面或运动提示词缺失），已退费，请重试")
		return
	}

	response.OK(c, GeneratePromptResponse{
		StoryboardPrompt: storyboardPrompt,
		MotionPrompt:     motionPrompt,
	})
}
