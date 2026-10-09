package handler

import (
	"context"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"libtv/internal/service"
)

// WechatPayHandler 微信支付接口：只保留异步回调（公网，服务器间调用）。
//
// 后台配置读写/自检端点已下线：微信支付配置只来自服务器一处
// （config.yaml 的 payment.wxpay + WXPAY_* 环境变量），与支付宝 ALIPAY_* 的注入方式一致。
type WechatPayHandler struct {
	wechat *service.WechatPayService
}

func NewWechatPayHandler(wechat *service.WechatPayService) *WechatPayHandler {
	return &WechatPayHandler{wechat: wechat}
}

// maxNotifyBody 回调报文读取上限（正常只有几 KB，防御异常请求）
const maxNotifyBody = 1 << 20

// Notify 微信支付异步通知（服务器间调用，公网无需登录）。
//
// 应答格式由微信规定，**不是**本站的 {code:0} 结构：
//   - 成功：HTTP 200 + {"code":"SUCCESS","message":"成功"}
//   - 失败：HTTP 4xx/5xx + {"code":"FAIL","message":"..."} → 微信会按策略重试
//
// 因此这里必须「验签/解密/到账」全部成功才 ACK；失败一律 FAIL + 记日志（日志不含密钥/密文）。
func (h *WechatPayHandler) Notify(c *gin.Context) {
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, maxNotifyBody))
	if err != nil {
		log.Printf("[Wxpay] 读取回调报文失败: %v", err)
		c.JSON(http.StatusBadRequest, gin.H{"code": "FAIL", "message": "读取报文失败"})
		return
	}

	// 到账要在 5 秒内完成并 ACK：这里用独立的 context，
	// 避免「客户端连接抖动」把加分事务连带取消掉（那会出现微信已 ACK、本地没到账的窟窿）。
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := h.wechat.HandleNotify(ctx, c.Request.Header, body); err != nil {
		// 只回笼统原因给微信，具体错误已在服务层落日志
		c.JSON(http.StatusInternalServerError, gin.H{"code": "FAIL", "message": "处理失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": "SUCCESS", "message": "成功"})
}