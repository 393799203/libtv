package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/service"
)

// PaymentHandler 支付相关接口（积分超市充值：支付宝 / 微信支付二选一）
type PaymentHandler struct {
	paymentService *service.PaymentService
	wechatService  *service.WechatPayService
	frontendBase   string // 支付完成同步跳转回的前端地址
}

func NewPaymentHandler(paymentService *service.PaymentService, wechatService *service.WechatPayService, frontendBase string) *PaymentHandler {
	return &PaymentHandler{paymentService: paymentService, wechatService: wechatService, frontendBase: frontendBase}
}

// CreateOrderRequest 下单请求。
// Channel / Client 都是可选：不传即老行为（支付宝 + PC 电脑网站支付），保证既有前端不用改也能继续买。
type CreateOrderRequest struct {
	PackageID int64  `json:"package_id" binding:"required"`
	Channel   string `json:"channel"` // alipay（默认）/ wechat
	Client    string `json:"client"`  // pc（默认，微信走 Native 扫码）/ h5（手机，微信走 H5 支付）
}

// CreateOrder 创建充值订单：支付宝返回收银台 URL，微信返回 code_url（Native）/ h5_url
func (h *PaymentHandler) CreateOrder(c *gin.Context) {
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误：package_id 必填")
		return
	}
	userID := middleware.GetUserID(c)
	packageID := strconv.FormatInt(req.PackageID, 10)

	if req.Channel == "wechat" {
		order, result, err := h.wechatService.CreateOrder(c.Request.Context(), userID, packageID, req.Client, c.ClientIP())
		if err != nil {
			response.FailWith(c, err)
			return
		}
		response.OK(c, gin.H{
			"order_no":   order.OrderNo,
			"channel":    "wechat",
			"pay_mode":   result.Mode,
			"pay_url":    result.PayURL,  // h5 → 跳转地址；native → 二维码内容（可复制为支付链接）
			"code_url":   result.CodeURL, // PC 扫码（Native）二维码内容
			"h5_url":     result.H5URL,   // 手机 H5 跳转地址
			"points":     order.Points,
			"amount_fen": order.AmountFen,
			"status":     order.Status,
		})
		return
	}

	order, payURL, err := h.paymentService.CreateOrder(c.Request.Context(), userID, packageID)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{
		"order_no":   order.OrderNo,
		"channel":    "alipay",
		"pay_mode":   "page",
		"pay_url":    payURL,
		"points":     order.Points,
		"amount_fen": order.AmountFen,
		"status":     order.Status,
	})
}

// Methods 收银台支付方式能力查询（公开接口，不含敏感信息）：
// 前端据此决定「微信支付」是否置灰、手机上是否可以走 H5（未开通则回落扫码）。
func (h *PaymentHandler) Methods(c *gin.Context) {
	response.OK(c, h.wechatService.Methods(c.Request.Context()))
}

// GetOrder 查询订单状态（需登录，前端支付后轮询）。
// 微信订单在 pending 时会**主动查一次微信**（回调丢失时的兜底），查到已支付则立即到账。
func (h *PaymentHandler) GetOrder(c *gin.Context) {
	ctx := c.Request.Context()
	orderNo := c.Param("orderNo")
	userID := middleware.GetUserID(c)

	order, err := h.paymentService.GetOrder(ctx, orderNo, userID)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	if order.Status == "pending" && order.PayChannel == model.PayChannelWechat {
		h.wechatService.SyncPendingOrder(ctx, order)
		// 查单可能刚刚到账，重新读一次状态再返回（失败就沿用旧状态，不影响轮询）
		if latest, err := h.paymentService.GetOrder(ctx, orderNo, userID); err == nil {
			order = latest
		}
	}

	response.OK(c, gin.H{
		"order_no":     order.OrderNo,
		"points":       order.Points,
		"amount_fen":   order.AmountFen,
		"status":       order.Status,
		"package_name": order.PackageName,
		"pay_channel":  order.PayChannel,
	})
}

// AlipayNotify 支付宝异步通知（服务器间调用，公网无需登录；成功回 "success"）
func (h *PaymentHandler) AlipayNotify(c *gin.Context) {
	_ = c.Request.ParseForm()
	handled, err := h.paymentService.HandleNotify(c.Request.PostForm)
	if err != nil {
		log.Printf("[Payment] notify 处理失败: %v", err)
		c.String(http.StatusBadRequest, "fail")
		return
	}
	if handled {
		c.String(http.StatusOK, "success")
		return
	}
	c.String(http.StatusBadRequest, "fail")
}

// AlipayReturn 支付宝同步跳转（用户支付完成后浏览器跳回，验签后重定向到前端）
func (h *PaymentHandler) AlipayReturn(c *gin.Context) {
	orderNo, success, err := h.paymentService.VerifyReturn(c.Request.URL.Query())
	if err != nil {
		log.Printf("[Payment] return 验签失败: %v", err)
		c.Redirect(http.StatusFound, h.frontendBase)
		return
	}
	target := h.frontendBase
	if target == "" {
		target = "/"
	}
	if orderNo != "" {
		sep := "?"
		if strings.Contains(target, "?") {
			sep = "&"
		}
		target = target + sep + "order_no=" + orderNo + "&paid=" + strconv.FormatBool(success)
	}
	c.Redirect(http.StatusFound, target)
}
