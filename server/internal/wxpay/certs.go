package wxpay

import (
	"context"
	"crypto/rsa"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

// 平台证书缓存时长：证书会轮换，缓存到期即重新拉取；
// 另外「验签遇到未知序列号」时会**立即**刷新一次（轮换当天不必等缓存过期）。
const platformCertTTL = 6 * time.Hour

// certFetchTimeout 验签路径上拉平台证书的超时上限。
// 微信要求回调 5 秒内应答；拉证书是网络动作，必须自己掐表，
// 超时就判失败让微信重试，绝不能拖到超时才回。
const certFetchTimeout = 3 * time.Second

// certificatesResponse GET /v3/certificates 响应
type certificatesResponse struct {
	Data []struct {
		SerialNo           string `json:"serial_no"`
		EffectiveTime      string `json:"effective_time"`
		ExpireTime         string `json:"expire_time"`
		EncryptCertificate struct {
			Algorithm      string `json:"algorithm"`
			Nonce          string `json:"nonce"`
			AssociatedData string `json:"associated_data"`
			Ciphertext     string `json:"ciphertext"`
		} `json:"encrypt_certificate"`
	} `json:"data"`
}

// certCache 平台证书公钥缓存（按序列号索引）
type certCache struct {
	mu        sync.Mutex
	keys      map[string]*rsa.PublicKey
	fetchedAt time.Time
}

func newCertCache() *certCache {
	return &certCache{keys: make(map[string]*rsa.PublicKey)}
}

func (c *certCache) get(serial string) (*rsa.PublicKey, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	key, ok := c.keys[normalizeSerial(serial)]
	return key, ok
}

func (c *certCache) fresh() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.keys) > 0 && time.Since(c.fetchedAt) < platformCertTTL
}

func (c *certCache) replace(keys map[string]*rsa.PublicKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.keys = keys
	c.fetchedAt = time.Now()
}

// normalizeSerial 序列号统一成大写去空格，避免大小写导致匹配不上
func normalizeSerial(s string) string {
	return strings.ToUpper(strings.TrimSpace(s))
}

// refreshPlatformCerts 拉取并解密平台证书（GET /v3/certificates）。
// 平台证书本身也是加密下发的：用 APIv3 密钥 AES-256-GCM 解密后再解析公钥。
func (c *Client) refreshPlatformCerts(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, certFetchTimeout)
	defer cancel()

	raw, err := c.do(ctx, http.MethodGet, "/v3/certificates", "")
	if err != nil {
		return err
	}
	var resp certificatesResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return err
	}
	keys := make(map[string]*rsa.PublicKey, len(resp.Data))
	for _, item := range resp.Data {
		enc := item.EncryptCertificate
		plain, err := DecryptResource(c.cfg.APIv3Key, enc.Nonce, enc.AssociatedData, enc.Ciphertext, enc.Algorithm)
		if err != nil {
			// 单张证书解不开不影响其它证书；日志只带序列号，不带任何密钥
			log.Printf("[Wxpay] 平台证书解密失败: serial=%s err=%v", item.SerialNo, err)
			continue
		}
		pub, err := parsePublicKeyPEM(string(plain))
		if err != nil {
			log.Printf("[Wxpay] 平台证书解析失败: serial=%s err=%v", item.SerialNo, err)
			continue
		}
		keys[normalizeSerial(item.SerialNo)] = pub
	}
	if len(keys) == 0 {
		return errCertEmpty
	}
	c.certs.replace(keys)
	log.Printf("[Wxpay] 平台证书已更新: %d 张", len(keys))
	return nil
}

// FetchPlatformCerts 主动拉取一次平台证书并把结果返回给调用方（配置自检用）。
// 与预取的区别：这里把错误抛出去，让调用方看到具体原因（预取只记日志）。
func (c *Client) FetchPlatformCerts(ctx context.Context) error {
	return c.refreshPlatformCerts(ctx)
}

// PrefetchPlatformCerts 预取平台证书（配置就绪后服务端启动时调用）：
// 让第一笔回调不必现拉证书，稳稳落在 5 秒 ACK 预算内。
func (c *Client) PrefetchPlatformCerts(ctx context.Context) {
	if c.cfg.PublicKey != "" || c.cfg.PlatformCert != "" {
		return // 已静态配置，无需拉取
	}
	if c.certs.fresh() {
		return
	}
	if err := c.refreshPlatformCerts(ctx); err != nil {
		log.Printf("[Wxpay] 平台证书预取失败（回调时会再试）: %v", err)
	}
}

// publicKeyFor 取用于回调验签的微信侧公钥。
//
// 三种来源，按微信头 Wechatpay-Serial 选择：
//  1. PUB_KEY_ID_ 开头 → 「微信支付公钥」模式（配置里粘贴的公钥）
//  2. 静态配置的平台证书序列号命中 → 用配置里的证书
//  3. 其余 → 平台证书缓存；未命中则立即刷新一次再取（覆盖证书轮换）
func (c *Client) publicKeyFor(ctx context.Context, serial string) (*rsa.PublicKey, error) {
	serial = normalizeSerial(serial)
	if serial == "" {
		return nil, errSerialMissing
	}
	if strings.HasPrefix(serial, "PUB_KEY_ID_") {
		if c.publicKey == nil {
			return nil, errPublicKeyMissing
		}
		return c.publicKey, nil
	}
	if c.platformKey != nil && normalizeSerial(c.staticCertSerial) == serial {
		return c.platformKey, nil
	}
	if key, ok := c.certs.get(serial); ok {
		return key, nil
	}
	// 未知序列号：可能是证书刚轮换，刷新后重试一次
	if err := c.refreshPlatformCerts(ctx); err != nil {
		return nil, err
	}
	if key, ok := c.certs.get(serial); ok {
		return key, nil
	}
	return nil, errSerialUnknown
}

// VerifyNotify 校验微信回调签名。
//
// 签名串 = 时间戳 \n 随机串 \n 报文主体 \n（报文必须是**原始 body**，不能被解析后重新序列化）。
// 同时校验时间戳偏差（>5 分钟视为重放，拒绝）。
func (c *Client) VerifyNotify(ctx context.Context, headers http.Header, body []byte) error {
	timestamp := strings.TrimSpace(headers.Get("Wechatpay-Timestamp"))
	nonce := strings.TrimSpace(headers.Get("Wechatpay-Nonce"))
	signature := strings.TrimSpace(headers.Get("Wechatpay-Signature"))
	serial := strings.TrimSpace(headers.Get("Wechatpay-Serial"))

	if timestamp == "" || nonce == "" || signature == "" || serial == "" {
		return ErrSignature
	}
	// 防重放：时间戳与本机时间偏差不得超过 5 分钟
	ts, err := parseUnixSeconds(timestamp)
	if err != nil {
		return ErrSignature
	}
	if diff := time.Since(ts); diff > 5*time.Minute || diff < -5*time.Minute {
		return ErrSignature
	}

	pub, err := c.publicKeyFor(ctx, serial)
	if err != nil {
		return err
	}
	message := buildResponseSignString(timestamp, nonce, string(body))
	return verifyRSA(pub, message, signature)
}

// parseUnixSeconds 解析秒级时间戳字符串
func parseUnixSeconds(s string) (time.Time, error) {
	var sec int64
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			return time.Time{}, errBadTimestamp
		}
		sec = sec*10 + int64(ch-'0')
	}
	if sec <= 0 {
		return time.Time{}, errBadTimestamp
	}
	return time.Unix(sec, 0), nil
}
