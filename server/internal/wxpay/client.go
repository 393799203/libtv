package wxpay

import (
	"bytes"
	"context"
	"crypto/rsa"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// 包级错误（都作为业务失败处理，不 panic、不外泄敏感信息）
var (
	errCertEmpty        = errors.New("微信平台证书列表为空")
	errSerialMissing    = errors.New("回调缺少 Wechatpay-Serial")
	errSerialUnknown    = errors.New("回调证书序列号未知（平台证书未获取到）")
	errPublicKeyMissing = errors.New("微信支付公钥模式缺少公钥配置")
	errBadTimestamp     = errors.New("回调时间戳非法")
)

// maxResponseBytes 响应体读取上限（防御异常响应把内存吃满）
const maxResponseBytes = 1 << 20

// Client 微信支付 APIv3 客户端（一个配置实例一个客户端；配置变更时由上层重建）
type Client struct {
	cfg              Config
	priv             *rsa.PrivateKey
	httpClient       *http.Client
	platformKey      *rsa.PublicKey // 配置里写死的平台证书公钥（可空）
	staticCertSerial string         // 上面那张证书的序列号
	publicKey        *rsa.PublicKey // 微信支付公钥（公钥模式，可空）
	certs            *certCache
}

// NewClient 构建客户端；关键项缺失或私钥/证书解析失败时返回错误
func NewClient(cfg Config) (*Client, error) {
	if !cfg.Ready() {
		return nil, fmt.Errorf("微信支付配置不完整，缺少: %s", strings.Join(cfg.Missing(), "、"))
	}
	priv, err := parsePrivateKey(cfg.PrivateKey)
	if err != nil {
		return nil, fmt.Errorf("解析商户 API 私钥失败: %w", err)
	}
	c := &Client{
		cfg:        cfg,
		priv:       priv,
		certs:      newCertCache(),
		httpClient: &http.Client{Timeout: 10 * time.Second},
	}
	if strings.TrimSpace(cfg.PlatformCert) != "" {
		key, err := parsePublicKeyPEM(cfg.PlatformCert)
		if err != nil {
			return nil, fmt.Errorf("解析微信支付平台证书失败: %w", err)
		}
		c.platformKey = key
		if serial, err := serialFromPEM(cfg.PlatformCert); err == nil {
			c.staticCertSerial = serial
		} else {
			// 只给了公钥（非证书）时无法取序列号：按配置里的公钥 ID 兜底匹配
			c.staticCertSerial = cfg.PublicKeyID
		}
	}
	if strings.TrimSpace(cfg.PublicKey) != "" {
		key, err := parsePublicKeyPEM(cfg.PublicKey)
		if err != nil {
			return nil, fmt.Errorf("解析微信支付公钥失败: %w", err)
		}
		c.publicKey = key
	}
	return c, nil
}

// Config 返回客户端持有的配置副本
func (c *Client) Config() Config { return c.cfg }

// do 发起已签名的 APIv3 请求；urlPath 含查询串；body 为空表示无请求体
func (c *Client) do(ctx context.Context, method, urlPath, body string) ([]byte, error) {
	fullURL := c.cfg.APIBaseOr() + urlPath

	req, err := http.NewRequestWithContext(ctx, method, fullURL, bytes.NewReader([]byte(body)))
	if err != nil {
		return nil, err
	}
	auth, err := c.authorization(method, urlPath, body)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", auth)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "libtv-wxpay/1.0")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求微信支付接口失败: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, newAPIError(resp.StatusCode, raw)
	}
	return raw, nil
}

// authorization 构造 WECHATPAY2-SHA256-RSA2048 授权头
func (c *Client) authorization(method, urlPath, body string) (string, error) {
	timestamp := strconv.FormatInt(time.Now().Unix(), 10)
	nonce, err := randomNonce()
	if err != nil {
		return "", err
	}
	signature, err := signRSA(c.priv, buildRequestSignString(method, urlPath, timestamp, nonce, body))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf(
		`WECHATPAY2-SHA256-RSA2048 mchid="%s",nonce_str="%s",signature="%s",timestamp="%s",serial_no="%s"`,
		c.cfg.MchID, nonce, signature, timestamp, c.cfg.CertSerialNo,
	), nil
}

// APIError 微信支付返回的业务错误（HTTP 4xx/5xx）
type APIError struct {
	StatusCode int
	Code       string
	Message    string
}

func (e *APIError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("微信支付接口返回错误(%d): %s %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("微信支付接口返回错误(%d)", e.StatusCode)
}

// newAPIError 解析错误响应体
func newAPIError(status int, raw []byte) error {
	var payload struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal(raw, &payload)
	return &APIError{StatusCode: status, Code: payload.Code, Message: payload.Message}
}

// ==================== 下单 / 查单 ====================

// CreateOrderInput 下单入参（Native / H5 共用）
type CreateOrderInput struct {
	OutTradeNo    string
	Description   string
	AmountFen     int64
	Attach        string
	PayerClientIP string // H5 支付必填
	TimeExpire    string // RFC3339，可选
}

// orderRequest 组装统一下单请求体
func (c *Client) orderRequest(in CreateOrderInput) ([]byte, error) {
	body := map[string]interface{}{
		"appid":        c.cfg.AppID,
		"mchid":        c.cfg.MchID,
		"description":  in.Description,
		"out_trade_no": in.OutTradeNo,
		"notify_url":   c.cfg.NotifyURL,
		"amount": map[string]interface{}{
			"total":    in.AmountFen,
			"currency": "CNY",
		},
	}
	if in.Attach != "" {
		body["attach"] = in.Attach
	}
	if in.TimeExpire != "" {
		body["time_expire"] = in.TimeExpire
	}
	return json.Marshal(body)
}

// CreateNative PC 扫码（Native）下单，返回 code_url（前端据此出二维码 / 支付链接）
func (c *Client) CreateNative(ctx context.Context, in CreateOrderInput) (string, error) {
	payload, err := c.orderRequest(in)
	if err != nil {
		return "", err
	}
	raw, err := c.do(ctx, http.MethodPost, "/v3/pay/transactions/native", string(payload))
	if err != nil {
		return "", err
	}
	var resp struct {
		CodeURL string `json:"code_url"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", err
	}
	if resp.CodeURL == "" {
		return "", errors.New("微信支付未返回 code_url")
	}
	return resp.CodeURL, nil
}

// CreateH5 手机 H5 下单，返回 h5_url（跳转微信支付中间页）。
// H5 支付需在商户平台**单独申请开通**；未开通时微信返回业务错误，
// 上层据此把「H5 可用」标为不可用，前端回落扫码。
func (c *Client) CreateH5(ctx context.Context, in CreateOrderInput) (string, error) {
	body, err := c.orderRequest(in)
	if err != nil {
		return "", err
	}
	// scene_info 是 H5 支付的必填字段：payer_client_ip 必填，h5_info.type 必填
	var payload map[string]interface{}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	payload["scene_info"] = map[string]interface{}{
		"payer_client_ip": in.PayerClientIP,
		"h5_info": map[string]interface{}{
			"type": "Wap",
		},
	}
	merged, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	raw, err := c.do(ctx, http.MethodPost, "/v3/pay/transactions/h5", string(merged))
	if err != nil {
		return "", err
	}
	var resp struct {
		H5URL string `json:"h5_url"`
	}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return "", err
	}
	if resp.H5URL == "" {
		return "", errors.New("微信支付未返回 h5_url")
	}
	return resp.H5URL, nil
}

// Transaction 微信支付订单（查单 / 回调解密后的报文共用）
type Transaction struct {
	AppID          string `json:"appid"`
	MchID          string `json:"mchid"`
	OutTradeNo     string `json:"out_trade_no"`
	TransactionID  string `json:"transaction_id"`
	TradeType      string `json:"trade_type"`
	TradeState     string `json:"trade_state"`
	TradeStateDesc string `json:"trade_state_desc"`
	SuccessTime    string `json:"success_time"`
	Attach         string `json:"attach"`
	Amount         struct {
		Total      int64  `json:"total"`
		PayerTotal int64  `json:"payer_total"`
		Currency   string `json:"currency"`
	} `json:"amount"`
	Payer struct {
		OpenID string `json:"openid"`
	} `json:"payer"`
}

// Paid 是否已支付成功
func (t *Transaction) Paid() bool { return t.TradeState == "SUCCESS" }

// QueryByOutTradeNo 按商户订单号主动查单（前端轮询兜底 + 后台对账）
func (c *Client) QueryByOutTradeNo(ctx context.Context, outTradeNo string) (*Transaction, error) {
	urlPath := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(outTradeNo) +
		"?mchid=" + url.QueryEscape(c.cfg.MchID)
	raw, err := c.do(ctx, http.MethodGet, urlPath, "")
	if err != nil {
		return nil, err
	}
	var tx Transaction
	if err := json.Unmarshal(raw, &tx); err != nil {
		return nil, err
	}
	return &tx, nil
}

// CloseByOutTradeNo 关闭订单（超时未支付收尾用；关闭失败仅记日志，不影响主流程）
func (c *Client) CloseByOutTradeNo(ctx context.Context, outTradeNo string) error {
	payload, err := json.Marshal(map[string]string{"mchid": c.cfg.MchID})
	if err != nil {
		return err
	}
	urlPath := "/v3/pay/transactions/out-trade-no/" + url.PathEscape(outTradeNo) + "/close"
	_, err = c.do(ctx, http.MethodPost, urlPath, string(payload))
	return err
}

// NotifyEvent 回调通知报文
type NotifyEvent struct {
	ID           string `json:"id"`
	CreateTime   string `json:"create_time"`
	EventType    string `json:"event_type"`
	ResourceType string `json:"resource_type"`
	Summary      string `json:"summary"`
	Resource     struct {
		Algorithm      string `json:"algorithm"`
		Ciphertext     string `json:"ciphertext"`
		Nonce          string `json:"nonce"`
		AssociatedData string `json:"associated_data"`
		OriginalType   string `json:"original_type"`
	} `json:"resource"`
}

// ParseNotify 校验签名 → AES-256-GCM 解密 → 解析成功交易报文。
// 返回的 *Transaction 为空表示该通知不是「支付成功」事件（调用方直接 ACK 即可）。
func (c *Client) ParseNotify(ctx context.Context, headers http.Header, body []byte) (*Transaction, *NotifyEvent, error) {
	if err := c.VerifyNotify(ctx, headers, body); err != nil {
		return nil, nil, err
	}
	var event NotifyEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, nil, err
	}
	plain, err := DecryptResource(c.cfg.APIv3Key, event.Resource.Nonce, event.Resource.AssociatedData,
		event.Resource.Ciphertext, event.Resource.Algorithm)
	if err != nil {
		return nil, &event, err
	}
	var tx Transaction
	if err := json.Unmarshal(plain, &tx); err != nil {
		return nil, &event, err
	}
	return &tx, &event, nil
}
