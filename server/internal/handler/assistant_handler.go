package handler

import (
	"log"
	"net/http"
	"strings"

	"libtv/internal/assistant"
	"libtv/internal/middleware"
	"libtv/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

// maxAssistantMessageRunes 单条消息的长度上限。
// 助手收到的是「一句话指令」，正常远低于这个数；超长基本是异常输入。
// 在入口就截断（而不是交给上游），因为对话不扣用户积分，token 成本全在平台。
const maxAssistantMessageRunes = 500

// AssistantHandler AI 助手：把用户的自然语言翻译成白名单内的画布命令。
//
// 注意这个接口**不挂 Billing 中间件**——对话本身不扣用户积分。
// 真正花钱的是前端拿到命令后触发的生成，那条路径继续走原有的计费链路与 402 拦截。
// 也就是说：助手免费，它让你做的事照价收费。
type AssistantHandler struct {
	svc *assistant.Service
}

func NewAssistantHandler(svc *assistant.Service) *AssistantHandler {
	return &AssistantHandler{svc: svc}
}

// Chat POST /api/assistant/chat
// 入参：{message, context:{projectId,nodes,selectedIds,credits}, recent}
// 出参：{reply, commands[], needConfirm, logId, rejected}
func (h *AssistantHandler) Chat(c *gin.Context) {
	var req assistant.Request
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请求格式不正确")
		return
	}

	if strings.TrimSpace(req.Message) == "" {
		response.Fail(c, http.StatusBadRequest, "说点什么吧")
		return
	}
	if len([]rune(req.Message)) > maxAssistantMessageRunes {
		response.Fail(c, http.StatusBadRequest, "这句话有点长，简短说一下吧")
		return
	}

	userID := middleware.GetUserID(c)
	result, err := h.svc.Chat(c.Request.Context(), userID, &req)
	if err != nil {
		// 上游/解析错误不向用户暴露细节，但必须留日志：助手「答不出来」的原因
		// 十有八九在服务端（模型不可用、渠道没配模型），而不是用户说错了
		log.Printf("[Assistant] ⚠ 处理失败 user=%s: %v", userID, err)
		response.Fail(c, http.StatusInternalServerError, "助手暂时不可用，稍后再试试")
		return
	}

	response.OK(c, result)
}
