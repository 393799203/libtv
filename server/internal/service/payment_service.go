package service

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"

	"gorm.io/gorm"

	"libtv/internal/config"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
)

// 支付相关业务错误
var (
	ErrPaymentDisabled    = apperror.New(400, http.StatusBadRequest, "支付功能未开启")
	ErrPaymentOrderFails  = apperror.New(400, http.StatusBadRequest, "订单创建失败")
	ErrPaymentOrderNotFound = apperror.New(404, http.StatusNotFound, "支付订单不存在")
)

// PaymentService 支付宝支付服务（积分超市购买积分）
type PaymentService struct {
	db      *gorm.DB
	billing *BillingService
	cfg     config.AlipayConfig

	privKey *rsa.PrivateKey
	pubKey  *rsa.PublicKey
}

// NewPaymentService 创建支付服务；签名密钥解析失败时返回错误
func NewPaymentService(db *gorm.DB, billing *BillingService, cfg config.AlipayConfig) (*PaymentService, error) {
	s := &PaymentService{db: db, billing: billing, cfg: cfg}

	if cfg.Enabled {
		privKey, err := parseRSA2PrivateKey(cfg.PrivateKey)
		if err != nil {
			return nil, fmt.Errorf("解析支付宝应用私钥失败: %w", err)
		}
		pubKey, err := parseRSA2PublicKey(cfg.AlipayPublicKey)
		if err != nil {
			return nil, fmt.Errorf("解析支付宝公钥失败: %w", err)
		}
		s.privKey = privKey
		s.pubKey = pubKey
	}
	return s, nil
}

// ==================== 签名 / 验签（RSA2）====================

// buildRequestSignString 构造**请求**待签名串（电脑网站支付网关验签串**包含** sign_type，仅剔除 sign）
func buildRequestSignString(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "sign" {
			continue
		}
		if params[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	return strings.Join(parts, "&")
}

// buildVerifySignString 构造**回执验证**待验签串（异步通知/同步跳转验签串不含 sign 与 sign_type）
func buildVerifySignString(params map[string]string) string {
	keys := make([]string, 0, len(params))
	for k := range params {
		if k == "sign" || k == "sign_type" {
			continue
		}
		if params[k] == "" {
			continue
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+params[k])
	}
	return strings.Join(parts, "&")
}

// signParams 用应用私钥对**请求**参数做 RSA2(SHA256withRSA) 签名，返回 base64 签名
func signParams(params map[string]string, privKey *rsa.PrivateKey) (string, error) {
	str := buildRequestSignString(params)
	digest := sha256.Sum256([]byte(str))
	sig, err := rsa.SignPKCS1v15(rand.Reader, privKey, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// verifyParams 用支付宝公钥对**回执**参数验签
func verifyParams(params map[string]string, pubKey *rsa.PublicKey) error {
	sign := params["sign"]
	if sign == "" {
		return errors.New("missing sign")
	}
	sig, err := base64.StdEncoding.DecodeString(sign)
	if err != nil {
		return err
	}
	str := buildVerifySignString(params)
	digest := sha256.Sum256([]byte(str))
	return rsa.VerifyPKCS1v15(pubKey, crypto.SHA256, digest[:], sig)
}

// parseRSA2PrivateKey 解析应用私钥（兼容 PKCS1 与 PKCS8）
func parseRSA2PrivateKey(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(pemStr)))
	if block == nil {
		return nil, errors.New("invalid pem")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	rsaKey, ok := k.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("not an rsa key")
	}
	return rsaKey, nil
}

// parseRSA2PublicKey 解析支付宝公钥（PKIX/SubjectPublicKeyInfo 格式，兼容 PKCS1）
func parseRSA2PublicKey(pemStr string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(pemStr)))
	if block == nil {
		return nil, errors.New("invalid pem")
	}
	if k, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		if rsaKey, ok := k.(*rsa.PublicKey); ok {
			return rsaKey, nil
		}
		return nil, errors.New("not an rsa key")
	}
	return x509.ParsePKCS1PublicKey(block.Bytes)
}

// ==================== 下单 ====================

// CreateOrder 创建充值订单并返回支付宝收银台支付 URL
func (s *PaymentService) CreateOrder(ctx context.Context, userID string, packageID string) (*model.PaymentOrder, string, error) {
	if !s.cfg.Enabled {
		return nil, "", ErrPaymentDisabled
	}
	var pkg model.PointsPackage
	if err := s.db.WithContext(ctx).First(&pkg, "id = ? AND enabled = true", packageID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", apperror.New(400, http.StatusBadRequest, "套餐不存在或已下架")
		}
		return nil, "", err
	}
	if pkg.Price <= 0 || pkg.Points <= 0 {
		return nil, "", ErrPaymentOrderFails
	}

	order := &model.PaymentOrder{
		OrderNo:     genOrderNo(),
		UserID:      userID,
		PackageID:   strconv.FormatInt(pkg.ID, 10),
		PackageName: pkg.Name,
		Points:      pkg.Points,
		AmountFen:   int64(math.Round(pkg.Price * 100)),
		Status:      "pending",
	}
	if err := s.db.WithContext(ctx).Create(order).Error; err != nil {
		log.Printf("[Payment] 创建订单失败: userID=%s err=%v", userID, err)
		return nil, "", ErrPaymentOrderFails
	}

	payURL, err := s.buildPagePayURL(order)
	if err != nil {
		log.Printf("[Payment] 构建支付链接失败: orderNo=%s err=%v", order.OrderNo, err)
		return nil, "", ErrPaymentOrderFails
	}
	log.Printf("[Payment] 创建订单: orderNo=%s userID=%s pkg=%s amountFen=%d points=%d", order.OrderNo, userID, pkg.Name, order.AmountFen, pkg.Points)
	return order, payURL, nil
}

// GetOrder 查询订单状态（前端轮询用）
func (s *PaymentService) GetOrder(ctx context.Context, orderNo, userID string) (*model.PaymentOrder, error) {
	var order model.PaymentOrder
	if err := s.db.WithContext(ctx).First(&order, "order_no = ? AND user_id = ?", orderNo, userID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrPaymentOrderNotFound
		}
		return nil, err
	}
	return &order, nil
}

///////////////////// 支付宝「电脑网站支付」(alipay.trade.page.pay) /////////////////////

func (s *PaymentService) buildPagePayURL(order *model.PaymentOrder) (string, error) {
	bizContent, err := json.Marshal(map[string]string{
		"out_trade_no": order.OrderNo,
		"product_code": "FAST_INSTANT_TRADE_PAY",
		"total_amount": fmt.Sprintf("%.2f", float64(order.AmountFen)/100),
		"subject":      s.orderSubject(order),
	})
	if err != nil {
		return "", err
	}

	params := map[string]string{
		"app_id":      s.cfg.AppID,
		"method":      "alipay.trade.page.pay",
		"format":      "JSON",
		"charset":     "utf-8",
		"sign_type":   "RSA2",
		"timestamp":   time.Now().Format("2006-01-02 15:04:05"),
		"version":     "1.0",
		"notify_url":  s.cfg.NotifyURL,
		"return_url":  s.cfg.ReturnURL,
		"biz_content": string(bizContent),
	}

	sign, err := signParams(params, s.privKey)
	if err != nil {
		return "", err
	}
	params["sign"] = sign

	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	return s.cfg.Gateway + "?" + q.Encode(), nil
}

func (s *PaymentService) orderSubject(order *model.PaymentOrder) string {
	prefix := s.cfg.SubjectPrefix
	if prefix == "" {
		prefix = "漫蛙AI积分"
	}
	subject := prefix + "-" + order.PackageName
	if len([]rune(subject)) > 240 {
		subject = string([]rune(subject)[:240])
	}
	return subject
}

///////////////////// 异步通知（notify） /////////////////////

// HandleNotify 处理支付宝异步通知；返回 handled=true 表示通知已消费（应回 success）
// 幂等：同一订单重复通知只到账一次
func (s *PaymentService) HandleNotify(values url.Values) (bool, error) {
	if !s.cfg.Enabled {
		return false, ErrPaymentDisabled
	}
	params := make(map[string]string, len(values))
	for k, v := range values {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}

	// 验签失败：不消费，让支付宝重试
	if err := verifyParams(params, s.pubKey); err != nil {
		log.Printf("[Payment] notify 验签失败: %v", err)
		return false, err
	}

	tradeStatus := params["trade_status"]
	if tradeStatus != "TRADE_SUCCESS" && tradeStatus != "TRADE_FINISHED" {
		log.Printf("[Payment] notify 非成功状态: status=%s", tradeStatus)
		return true, nil
	}

	orderNo := params["out_trade_no"]
	alipayTradeNo := params["trade_no"]
	return s.chargeOrder(context.Background(), orderNo, alipayTradeNo)
}

// chargeOrder 到账（幂等）：原子抢占 pending 订单后调用 Recharge 增加积分
func (s *PaymentService) chargeOrder(ctx context.Context, orderNo, alipayTradeNo string) (bool, error) {
	var order model.PaymentOrder
	if err := s.db.WithContext(ctx).First(&order, "order_no = ?", orderNo).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("[Payment] 通知订单不存在: orderNo=%s", orderNo)
			return true, nil // 未知订单直接消费，避免支付宝持续重试
		}
		return false, err
	}

	// 原子抢占：只有 pending → paid 成功的那一次才执行到账
	now := time.Now()
	res := s.db.Model(&model.PaymentOrder{}).
		Where("order_no = ? AND status = 'pending'", orderNo).
		Updates(map[string]interface{}{
			"status":          "paid",
			"alipay_trade_no": alipayTradeNo,
			"paid_at":         now,
		})
	if res.Error != nil {
		return false, res.Error
	}
	if res.RowsAffected == 0 {
		// 已处理过（幂等）或订单已关闭
		return true, nil
	}

	// 到账：调用既有 Recharge（加分 + 记账单）
	remark := fmt.Sprintf("支付宝购买「%s」", order.PackageName)
	if err := s.billing.Recharge(ctx, order.UserID, order.Points, "积分充值", remark); err != nil {
		log.Printf("[Payment] ⚠️ 到账失败，回滚订单状态: orderNo=%s userID=%s points=%d err=%v", orderNo, order.UserID, order.Points, err)
		// 回滚抢占状态，让支付宝重试
		s.db.Model(&model.PaymentOrder{}).Where("order_no = ?", orderNo).
			Updates(map[string]interface{}{"status": "pending", "alipay_trade_no": "", "paid_at": nil})
		return false, err
	}

	log.Printf("[Payment] ✅ 充值到账: orderNo=%s userID=%s points=%d tradeNo=%s", orderNo, order.UserID, order.Points, alipayTradeNo)
	return true, nil
}

// VerifyReturn 校验同步跳转（return）参数；通过则返回订单号与支付是否成功
func (s *PaymentService) VerifyReturn(values url.Values) (orderNo string, success bool, err error) {
	if !s.cfg.Enabled {
		return "", false, ErrPaymentDisabled
	}
	params := make(map[string]string, len(values))
	for k, v := range values {
		if len(v) > 0 {
			params[k] = v[0]
		}
	}
	if err := verifyParams(params, s.pubKey); err != nil {
		return "", false, err
	}
	return params["out_trade_no"], params["trade_status"] == "TRADE_SUCCESS" || params["trade_status"] == "TRADE_FINISHED", nil
}

// genOrderNo 生成商户订单号：P + 时间戳 + 8位随机数
func genOrderNo() string {
	randBytes := make([]byte, 4)
	_, _ = rand.Read(randBytes)
	n := time.Now().UnixNano() % 100000000
	return fmt.Sprintf("P%s%08d%08d", time.Now().Format("20060102150405"), n, int(uint32(randBytes[0])<<24|uint32(randBytes[1])<<16|uint32(randBytes[2])<<8|uint32(randBytes[3]))%100000000)
}