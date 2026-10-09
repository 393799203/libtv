package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"

	"libtv/internal/billing"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/wxpay"
)

// 微信支付相关业务错误（都是明确的中文提示，不用 500，也不会 panic）
var (
	// ErrWechatPayDisabled 未配置 / 未启用：前端据此置灰「暂未开通」
	ErrWechatPayDisabled = apperror.New(400, http.StatusBadRequest, "微信支付暂未开通")
	// ErrWechatPayH5Disabled H5 支付权限未开通（需在商户平台单独申请）
	ErrWechatPayH5Disabled = apperror.New(400, http.StatusBadRequest, "微信支付 H5 暂未开通，请改用扫码支付")
	// ErrWechatPayOrderFails 微信侧下单失败（网络/参数等）
	ErrWechatPayOrderFails = apperror.New(400, http.StatusBadRequest, "微信支付下单失败，请稍后重试或改用支付宝")
	// ErrWechatPayNotConfigured 配置不完整（缺哪几项看启动日志，前台一律只说「暂未开通」）
	ErrWechatPayNotConfigured = apperror.New(400, http.StatusBadRequest, "微信支付配置不完整，需在商户平台配置 APIv3 密钥与证书后可用")
)

// H5 订单未支付前的查单节流：同一订单 5 秒内最多主动查一次微信
const wechatQueryThrottle = 5 * time.Second

// WechatPayResult 微信支付下单结果（前端据此出二维码/跳转）
type WechatPayResult struct {
	Mode    string `json:"mode"`     // native=PC 扫码 / h5=手机跳转
	CodeURL string `json:"code_url"` // Native 二维码内容（weixin://wxpay/bizpayurl?...）
	H5URL   string `json:"h5_url"`   // H5 支付跳转地址
	PayURL  string `json:"pay_url"`  // 统一入口：native=code_url，h5=h5_url
}

// PaymentMethods 前台收银台的能力清单（公开接口，不含任何敏感信息）
type PaymentMethods struct {
	Alipay PaymentMethodInfo `json:"alipay"`
	Wechat WechatMethodInfo  `json:"wechat"`
}

// PaymentMethodInfo 通用能力项
type PaymentMethodInfo struct {
	Available bool   `json:"available"`
	Name      string `json:"name"`
	Reason    string `json:"reason"` // 不可用原因（前端用于置灰提示）
}

// WechatMethodInfo 微信支付能力项
type WechatMethodInfo struct {
	Available       bool   `json:"available"`        // 是否可下单（PC 扫码）
	NativeAvailable bool   `json:"native_available"` // PC 扫码（Native）是否可用
	H5Available     bool   `json:"h5_available"`     // 手机 H5 是否可用（未开通时前端回落扫码）
	Name            string `json:"name"`
	Reason          string `json:"reason"`
	H5Reason        string `json:"h5_reason"`
}

// WechatPayService 微信支付业务服务：Native / H5 下单、回调验签解密到账、主动查单兜底
//
// 与支付宝的关系：共用 payment_orders 订单表与 billing.Recharge 到账路径，
// 只把「下单/回调/查单」换成微信 APIv3。
type WechatPayService struct {
	db      *gorm.DB
	billing *billing.Service
	cfg     *WechatPayConfigService

	mu       sync.Mutex
	client   *wxpay.Client
	clientFP string

	// H5 能力运行时探测结果：真实调用 H5 下单失败（如未申请开通）后如实标注不可用
	h5Mu     sync.Mutex
	h5Failed bool
	h5Reason string

	// 主动查单节流（订单号 → 上次查询时间）
	queryMu   sync.Mutex
	queriedAt map[string]time.Time
}

// NewWechatPayService 创建微信支付服务
func NewWechatPayService(db *gorm.DB, billingSvc *billing.Service, cfgSvc *WechatPayConfigService) *WechatPayService {
	return &WechatPayService{
		db:        db,
		billing:   billingSvc,
		cfg:       cfgSvc,
		queriedAt: make(map[string]time.Time),
	}
}

// clientFor 取当前配置对应的 APIv3 客户端（配置变了就重建，证书缓存随新客户端重新预取）
func (s *WechatPayService) clientFor(ctx context.Context) (*wxpay.Client, wxpay.Config, error) {
	cfg := s.cfg.Effective(ctx)
	if !cfg.Ready() {
		if cfg.Enabled {
			// 开了开关但缺配置：给管理员可见的具体原因，同时仍是 400 业务错误
			return nil, cfg, ErrWechatPayNotConfigured
		}
		return nil, cfg, ErrWechatPayDisabled
	}

	fp := cfg.Fingerprint()
	s.mu.Lock()
	if s.client != nil && s.clientFP == fp {
		cli := s.client
		s.mu.Unlock()
		return cli, cfg, nil
	}
	s.mu.Unlock()

	cli, err := wxpay.NewClient(cfg)
	if err != nil {
		log.Printf("[Wxpay] 初始化微信支付客户端失败: %v", err)
		return nil, cfg, ErrWechatPayNotConfigured
	}
	// 预取平台证书：让第一笔回调不必现拉证书（5 秒 ACK 预算）
	go cli.PrefetchPlatformCerts(context.Background())

	s.mu.Lock()
	s.client = cli
	s.clientFP = fp
	s.mu.Unlock()
	return cli, cfg, nil
}

// Prefetch 主动预取证书与配置（进程启动时调用一次；失败只记日志，不阻断启动）
func (s *WechatPayService) Prefetch(ctx context.Context) {
	cli, cfg, err := s.clientFor(ctx)
	if err != nil {
		// 后台配置页已下线，「还缺哪几项」只在这里看得见（只列字段中文名，不含任何密钥内容）
		if cfg.Enabled && !cfg.Ready() {
			log.Printf("[Wxpay] 微信支付已启用但配置不完整，缺少：%s", strings.Join(cfg.Missing(), "、"))
		}
		log.Printf("[Wxpay] 跳过预取：%v", err)
		return
	}
	log.Printf("[Wxpay] 微信支付已就绪: mchid=%s appid=%s 回调=%s H5=%t", cfg.MchID, cfg.AppID, cfg.NotifyURL, cfg.H5Enabled)
	cli.PrefetchPlatformCerts(ctx)
}

// Methods 收银台能力清单：如实标注「微信是否可用」「H5 是否可用」
func (s *WechatPayService) Methods(ctx context.Context) PaymentMethods {
	cfg := s.cfg.Effective(ctx)
	out := PaymentMethods{
		Alipay: PaymentMethodInfo{
			Available: s.cfg.alipayEnabled,
			Name:      "支付宝",
			Reason:    reasonIf(!s.cfg.alipayEnabled, "支付宝暂未开通"),
		},
		Wechat: WechatMethodInfo{
			Name: "微信支付",
		},
	}

	switch {
	case !cfg.Enabled:
		out.Wechat.Reason = "微信支付暂未开通"
	case !cfg.Ready():
		// 开关开着但缺项：前台只说「暂未开通」，具体缺哪几项只在启动日志里（不对外暴露配置细节）
		out.Wechat.Reason = "微信支付暂未开通"
	default:
		out.Wechat.Available = true
		out.Wechat.NativeAvailable = true
	}

	// H5：需要商户平台单独申请，并且真跑过一次才知道行不行
	h5Allowed := out.Wechat.Available && cfg.H5Enabled
	s.h5Mu.Lock()
	failed, failReason := s.h5Failed, s.h5Reason
	s.h5Mu.Unlock()
	if h5Allowed && !failed {
		out.Wechat.H5Available = true
	} else {
		if !cfg.H5Enabled {
			out.Wechat.H5Reason = "H5 支付未在商户平台开通"
		} else if failed {
			out.Wechat.H5Reason = failReason
		}
		if !out.Wechat.Available {
			out.Wechat.H5Reason = out.Wechat.Reason
		}
	}
	return out
}

// reasonIf 条件为真时返回原因文案
func reasonIf(cond bool, reason string) string {
	if cond {
		return reason
	}
	return ""
}

// CreateOrder 微信下单：PC → Native（返回 code_url），手机 → H5（返回 h5_url）
//
// 优雅降级：未配置 / 未启用时直接返回业务错误「微信支付暂未开通」，
// 不会创建垃圾订单，也不会 500 或 panic。
func (s *WechatPayService) CreateOrder(ctx context.Context, userID, packageID, clientKind, payerIP string) (*model.PaymentOrder, *WechatPayResult, error) {
	cli, cfg, err := s.clientFor(ctx)
	if err != nil {
		return nil, nil, err
	}

	useH5 := strings.EqualFold(strings.TrimSpace(clientKind), "h5") || strings.EqualFold(strings.TrimSpace(clientKind), "mobile")
	if useH5 && !cfg.H5Enabled {
		return nil, nil, ErrWechatPayH5Disabled
	}

	pkg, err := loadEnabledPackage(ctx, s.db, packageID)
	if err != nil {
		return nil, nil, err
	}

	order := newPendingOrder(userID, pkg, model.PayChannelWechat)
	if err := s.db.WithContext(ctx).Create(order).Error; err != nil {
		log.Printf("[Wxpay] 创建订单失败: userID=%s err=%v", userID, err)
		return nil, nil, ErrPaymentOrderFails
	}

	in := wxpay.CreateOrderInput{
		OutTradeNo:    order.OrderNo,
		Description:   s.orderSubject(order),
		AmountFen:     order.AmountFen,
		Attach:        "points_package",
		PayerClientIP: payerIP,
	}

	result := &WechatPayResult{Mode: "native"}
	if useH5 {
		h5URL, err := cli.CreateH5(ctx, in)
		if err != nil {
			s.closeOrder(ctx, order.OrderNo, "H5 下单失败")
			log.Printf("[Wxpay] H5 下单失败: orderNo=%s err=%v", order.OrderNo, err)
			if isH5PermissionError(err) {
				// 真没开通（商户平台未申请）：如实标注不可用，前端回落扫码
				s.markH5Unavailable(err)
				return nil, nil, ErrWechatPayH5Disabled
			}
			// 网络抖动等临时故障：不改能力标注，只让本次下单失败
			return nil, nil, ErrWechatPayOrderFails
		}
		s.markH5Available()
		result.Mode = "h5"
		result.H5URL = h5URL
		result.PayURL = h5URL
	} else {
		codeURL, err := cli.CreateNative(ctx, in)
		if err != nil {
			s.closeOrder(ctx, order.OrderNo, "Native 下单失败")
			log.Printf("[Wxpay] Native 下单失败: orderNo=%s err=%v", order.OrderNo, err)
			return nil, nil, ErrWechatPayOrderFails
		}
		result.CodeURL = codeURL
		result.PayURL = codeURL
	}

	log.Printf("[Wxpay] 创建订单: orderNo=%s userID=%s pkg=%s amountFen=%d points=%d mode=%s",
		order.OrderNo, userID, pkg.Name, order.AmountFen, pkg.Points, result.Mode)
	return order, result, nil
}

// isH5PermissionError 判断微信返回的错误是否属于「H5 支付没开通 / 没权限」。
// 只有这类错误才把 H5 标成不可用；网络抖动、参数临时问题不改变能力标注。
func isH5PermissionError(err error) bool {
	if err == nil {
		return false
	}
	var apiErr *wxpay.APIError
	if errors.As(err, &apiErr) {
		code := strings.ToUpper(apiErr.Code)
		if code == "NOAUTH" || code == "SIGN_ERROR" {
			return true
		}
		msg := apiErr.Message
		for _, kw := range []string{"未开通", "没有权限", "无权限", "权限", "permission", "not enabled", "not support"} {
			if strings.Contains(strings.ToLower(msg), strings.ToLower(kw)) {
				return true
			}
		}
	}
	return false
}

// markH5Unavailable 记录 H5 真实不可用（未申请开通时微信会返回权限类错误）
func (s *WechatPayService) markH5Unavailable(err error) {
	reason := "H5 支付调用失败：" + shortReason(err)
	s.h5Mu.Lock()
	s.h5Failed = true
	s.h5Reason = reason
	s.h5Mu.Unlock()
}

// markH5Available 一次成功的 H5 下单说明权限其实是通的，清掉失败标注
func (s *WechatPayService) markH5Available() {
	s.h5Mu.Lock()
	if s.h5Failed {
		s.h5Failed = false
		s.h5Reason = ""
	}
	s.h5Mu.Unlock()
}

// shortReason 截断错误文案，避免把整段响应塞进前端提示
func shortReason(err error) string {
	msg := err.Error()
	if len([]rune(msg)) > 80 {
		msg = string([]rune(msg)[:80]) + "…"
	}
	return msg
}

// closeOrder 下单失败后收尾：把刚建的 pending 订单置为 closed，不留垃圾待支付单
func (s *WechatPayService) closeOrder(ctx context.Context, orderNo, reason string) {
	if err := s.db.WithContext(ctx).Model(&model.PaymentOrder{}).
		Where("order_no = ? AND status = 'pending'", orderNo).
		Update("status", "closed").Error; err != nil {
		log.Printf("[Wxpay] 关闭订单失败: orderNo=%s reason=%s err=%v", orderNo, reason, err)
	}
}

// orderSubject 商品标题（微信侧最多 127 字，留出前缀余量）
func (s *WechatPayService) orderSubject(order *model.PaymentOrder) string {
	subject := "漫蛙AI积分-" + order.PackageName
	if len([]rune(subject)) > 120 {
		subject = string([]rune(subject)[:120])
	}
	return subject
}

// ==================== 异步回调 ====================

// HandleNotify 处理微信支付回调：
// 验签（平台证书/公钥，证书可轮换）→ AES-256-GCM 解密 → 幂等到账 → 返回 nil 表示可 ACK。
//
// 返回 error 时 handler 会回 FAIL（微信会重试），因此**绝不能**在「到账失败」时误 ACK。
func (s *WechatPayService) HandleNotify(ctx context.Context, headers http.Header, body []byte) error {
	cli, _, err := s.clientFor(ctx)
	if err != nil {
		log.Printf("[Wxpay] 回调到达但微信支付不可用: %v", err)
		return err
	}

	tx, event, err := cli.ParseNotify(ctx, headers, body)
	if err != nil {
		// 只记错误类型与订单无关的信息，不打印签名/密文原文
		log.Printf("[Wxpay] 回调验签/解密失败: %v", err)
		return err
	}
	if event != nil && event.EventType != "" && event.EventType != "TRANSACTION.SUCCESS" {
		log.Printf("[Wxpay] 回调事件非支付成功，已忽略: eventType=%s", event.EventType)
		return nil
	}
	if tx == nil || tx.OutTradeNo == "" {
		log.Printf("[Wxpay] 回调解密后缺少商户订单号，已忽略")
		return nil
	}
	if !tx.Paid() {
		log.Printf("[Wxpay] 回调状态非成功: orderNo=%s state=%s", tx.OutTradeNo, tx.TradeState)
		return nil // 非成功状态不需要到账，直接 ACK（微信不会再推同一笔的失败态）
	}

	// 金额校验：回调金额与订单金额不一致视为异常，记录但不到账
	if err := s.checkAmount(ctx, tx); err != nil {
		log.Printf("[Wxpay] ⚠️ 回调金额校验不通过: orderNo=%s err=%v", tx.OutTradeNo, err)
		return nil
	}

	if err := s.chargeOrder(ctx, tx.OutTradeNo, tx.TransactionID, "回调"); err != nil {
		return err
	}
	return nil
}

// checkAmount 校验回调金额与本地订单金额（分）一致
func (s *WechatPayService) checkAmount(ctx context.Context, tx *wxpay.Transaction) error {
	var order model.PaymentOrder
	if err := s.db.WithContext(ctx).First(&order, "order_no = ?", tx.OutTradeNo).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil // 未知订单在到账路径里按「消费掉」处理，这里不拦
		}
		return err
	}
	if tx.Amount.Total != 0 && order.AmountFen != 0 && tx.Amount.Total != order.AmountFen {
		return fmt.Errorf("金额不一致: 回调=%d分 订单=%d分", tx.Amount.Total, order.AmountFen)
	}
	return nil
}

// chargeOrder 到账（幂等）：原子抢占 pending → paid，抢到的那一次才加分
//
// 与支付宝同一条链路：claimPaidOrder + billing.Recharge（加分 + 记账单），
// 失败回滚抢占状态让微信重试；未知订单直接消费（避免微信无限重推）。
func (s *WechatPayService) chargeOrder(ctx context.Context, orderNo, tradeNo, source string) error {
	order, claimed, err := claimPaidOrder(ctx, s.db, orderNo, tradeNo)
	if err != nil {
		if errors.Is(err, ErrPaymentOrderNotFound) {
			log.Printf("[Wxpay] %s 订单不存在（已消费，避免重复通知）: orderNo=%s", source, orderNo)
			return nil
		}
		return err
	}
	if !claimed {
		log.Printf("[Wxpay] %s 重复通知，已幂等跳过: orderNo=%s", source, orderNo)
		return nil
	}

	if err := rechargeClaimedOrder(ctx, s.billing, order, tradeNo, "微信支付"); err != nil {
		log.Printf("[Wxpay] ⚠️ 到账失败，回滚订单状态: orderNo=%s userID=%s points=%d err=%v", orderNo, order.UserID, order.Points, err)
		rollbackClaim(ctx, s.db, orderNo, model.PayChannelWechat)
		return err
	}
	log.Printf("[Wxpay] ✅ 充值到账: orderNo=%s userID=%s points=%d tradeNo=%s source=%s", orderNo, order.UserID, order.Points, tradeNo, source)
	return nil
}

// ==================== 主动查单（前端轮询兜底 + 后台对账）====================

// SyncPendingOrder 对「微信渠道 + 待支付」的订单主动查一次微信（回调丢失时的兜底），
// 已支付则立即到账。节流：同一订单 5 秒内只查一次；任何失败都只记日志不打断轮询。
func (s *WechatPayService) SyncPendingOrder(ctx context.Context, order *model.PaymentOrder) {
	if order == nil || order.Status != "pending" {
		return
	}
	if order.PayChannel != model.PayChannelWechat {
		return
	}
	// 刚下单 2 秒内的订单不查：微信侧可能还没落单，白跑一次
	if time.Since(order.CreatedAt) < 2*time.Second {
		return
	}
	if !s.allowQuery(order.OrderNo) {
		return
	}

	cli, _, err := s.clientFor(ctx)
	if err != nil {
		return // 未配置时静默（能力接口已如实标注不可用）
	}
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	tx, err := cli.QueryByOutTradeNo(queryCtx, order.OrderNo)
	if err != nil {
		log.Printf("[Wxpay] 主动查单失败: orderNo=%s err=%v", order.OrderNo, err)
		return
	}
	if !tx.Paid() {
		return
	}
	if err := s.chargeOrder(ctx, tx.OutTradeNo, tx.TransactionID, "主动查单"); err != nil {
		log.Printf("[Wxpay] 主动查单到账失败: orderNo=%s err=%v", order.OrderNo, err)
	}
}

// allowQuery 查单节流
func (s *WechatPayService) allowQuery(orderNo string) bool {
	now := time.Now()
	s.queryMu.Lock()
	defer s.queryMu.Unlock()
	if last, ok := s.queriedAt[orderNo]; ok && now.Sub(last) < wechatQueryThrottle {
		return false
	}
	// 顺手清理过期表项，避免长期运行后 map 无界增长
	for k, v := range s.queriedAt {
		if now.Sub(v) > 10*time.Minute {
			delete(s.queriedAt, k)
		}
	}
	s.queriedAt[orderNo] = now
	return true
}

// VerifyConfig 配置自检：用当前生效配置签名请求 GET /v3/certificates，
// 能通说明商户号 / 序列号 / 私钥 / APIv3 密钥都对。
//
// 后台「验证配置」按钮与对应路由已随配置页一起下线（配置只来自服务器，改配置要重启进程），
// 这里保留为**服务端自检工具**：启动日志（Prefetch）已经覆盖了同一件事，需要时也可直接调用。
func (s *WechatPayService) VerifyConfig(ctx context.Context) (string, error) {
	cfg := s.cfg.Effective(ctx)
	if !cfg.Ready() {
		return "", ErrWechatPayNotConfigured
	}
	cli, err := wxpay.NewClient(cfg)
	if err != nil {
		return "", ErrWechatPayNotConfigured
	}
	if strings.TrimSpace(cfg.PublicKey) != "" && strings.TrimSpace(cfg.PlatformCert) == "" {
		return "配置已加载（微信支付公钥模式，回调验签用公钥，无需拉取平台证书）", nil
	}
	checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	if err := cli.FetchPlatformCerts(checkCtx); err != nil {
		return "", err
	}
	return "配置校验通过：商户号 / 证书序列号 / 私钥 / APIv3 密钥均可用，平台证书可正常获取", nil
}
