package handler

import (
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"
)

// PaymentHandler 支付相关接口（积分超市支付宝充值）
type PaymentHandler struct {
	paymentService *service.PaymentService
	frontendBase   string // 支付完成同步跳转回的前端地址
}

func NewPaymentHandler(paymentService *service.PaymentService, frontendBase string) *PaymentHandler {
	return &PaymentHandler{paymentService: paymentService, frontendBase: frontendBase}
}

// CreateOrderRequest 下单请求
type CreateOrderRequest struct {
	PackageID int64 `json:"package_id" binding:"required"`
}

// CreateOrder 创建充值订单，返回支付宝收银台支付 URL（需登录）
func (h *PaymentHandler) CreateOrder(c *gin.Context) {
	var req CreateOrderRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误：package_id 必填")
		return
	}

	order, payURL, err := h.paymentService.CreateOrder(c.Request.Context(), middleware.GetUserID(c), strconv.FormatInt(req.PackageID, 10))
	if err != nil {
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{
		"order_no":   order.OrderNo,
		"pay_url":    payURL,
		"points":     order.Points,
		"amount_fen": order.AmountFen,
		"status":     order.Status,
	})
}

// GetOrder 查询订单状态（需登录，前端支付后轮询）
func (h *PaymentHandler) GetOrder(c *gin.Context) {
	order, err := h.paymentService.GetOrder(c.Request.Context(), c.Param("orderNo"), middleware.GetUserID(c))
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{
		"order_no":     order.OrderNo,
		"points":       order.Points,
		"amount_fen":   order.AmountFen,
		"status":       order.Status,
		"package_name": order.PackageName,
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