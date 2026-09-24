package handler

import (
	"log"
	"net/http"

	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// ChannelHandler AI 渠道管理：全局策略切换 + 用户渠道查询/修改
type ChannelHandler struct {
	channelService *service.ChannelService
	userService    *service.UserService
}

func NewChannelHandler(channelService *service.ChannelService, userService *service.UserService) *ChannelHandler {
	return &ChannelHandler{channelService: channelService, userService: userService}
}

// SetPolicyRequest 设置全局渠道策略
type SetPolicyRequest struct {
	Policy string `json:"policy" binding:"required"` // all_wasu / all_dianxin / per_user
}

// SetPolicy 后台切换全局渠道策略（全A / 全B / 按各自渠道）
func (h *ChannelHandler) SetPolicy(c *gin.Context) {
	var req SetPolicyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}
	if err := h.channelService.SetPolicy(c.Request.Context(), req.Policy); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	log.Printf("[Channel] 全局渠道策略已切换: %s", req.Policy)
	response.OK(c, gin.H{"policy": req.Policy})
}

// GetPolicy 查询当前全局渠道策略
func (h *ChannelHandler) GetPolicy(c *gin.Context) {
	policy, err := h.channelService.GetPolicy(c.Request.Context())
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, err.Error())
		return
	}
	response.OK(c, gin.H{
		"policy":      policy,
		"all_wasu":    llm.PolicyAllWasu,
		"all_dianxin": llm.PolicyAllDianxin,
		"per_user":    llm.PolicyPerUser,
	})
}

// GetMyChannel 当前登录用户的最终渠道（全局策略 + 用户渠道解析后）
// 全局切换（all_wasu/all_dianxin）时返回被强制渠道，前端据此刷新模型清单
func (h *ChannelHandler) GetMyChannel(c *gin.Context) {
	userID := middleware.GetUserID(c)
	channel := h.channelService.ResolveUserChannel(c.Request.Context(), userID)
	response.OK(c, gin.H{"channel": channel})
}

// UpdateUserChannelRequest 管理员修改用户渠道
type UpdateUserChannelRequest struct {
	Channel string `json:"channel" binding:"required"` // wasu / dianxin
}

// UpdateUserChannel 管理员修改指定用户的渠道
func (h *ChannelHandler) UpdateUserChannel(c *gin.Context) {
	id := c.Param("id")
	var req UpdateUserChannelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}
	user, err := h.userService.UpdateChannel(c.Request.Context(), id, req.Channel)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	log.Printf("[Channel] 用户渠道已修改: userID=%s channel=%s", id, req.Channel)
	response.OK(c, user)
}
