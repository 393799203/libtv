package wxpay

import (
	"context"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// 本文件是微信支付协议实现的离线自测：全部密钥/证书都在测试里**现场生成**，
// 不依赖任何真实商户号、也不联网（平台证书用 httptest 假服务返回）。
// 覆盖：AES-256-GCM 解密、回调验签（含篡改/重放拒绝）、平台证书动态获取与缓存。

const testAPIv3Key = "01234567890123456789012345678901" // 32 字节，仅测试用

// genKeyAndCertPEM 生成 RSA 私钥与自签证书（返回私钥、证书 PEM、序列号十六进制）
func genKeyAndCertPEM(t *testing.T, cn string) (*rsa.PrivateKey, string, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("生成 RSA 私钥失败: %v", err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano() % 1000000000),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("生成自签证书失败: %v", err)
	}
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("解析自签证书失败: %v", err)
	}
	certPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	return key, certPEM, certSerialHex(cert)
}

// privateKeyPEM 私钥 PEM（PKCS8）
func privateKeyPEM(t *testing.T, key *rsa.PrivateKey) string {
	t.Helper()
	der, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("序列化私钥失败: %v", err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}))
}

// sealGCM AES-256-GCM 加密（模拟微信侧下发的密文）
func sealGCM(t *testing.T, key, nonce, aad, plaintext string) string {
	t.Helper()
	block, err := aes.NewCipher([]byte(key))
	if err != nil {
		t.Fatalf("构造 AES 失败: %v", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("构造 GCM 失败: %v", err)
	}
	sealed := gcm.Seal(nil, []byte(nonce), []byte(plaintext), []byte(aad))
	return base64.StdEncoding.EncodeToString(sealed)
}

// signNotify 用平台私钥对回调报文签名并生成微信要求的请求头
func signNotify(t *testing.T, platformKey *rsa.PrivateKey, serial string, body []byte, ts time.Time) http.Header {
	t.Helper()
	h := http.Header{}
	nonce := "test-nonce-123456"
	timestamp := fmt.Sprintf("%d", ts.Unix())
	digest := sha256.Sum256([]byte(buildResponseSignString(timestamp, nonce, string(body))))
	sig, err := rsa.SignPKCS1v15(rand.Reader, platformKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("签名失败: %v", err)
	}
	h.Set("Wechatpay-Timestamp", timestamp)
	h.Set("Wechatpay-Nonce", nonce)
	h.Set("Wechatpay-Signature", base64.StdEncoding.EncodeToString(sig))
	h.Set("Wechatpay-Serial", serial)
	return h
}

// buildNotifyBody 构造 TRANSACTION.SUCCESS 通知报文（resource 用 APIv3 密钥加密）
func buildNotifyBody(t *testing.T, tx map[string]interface{}) []byte {
	t.Helper()
	plain, err := json.Marshal(tx)
	if err != nil {
		t.Fatalf("序列化交易报文失败: %v", err)
	}
	event := map[string]interface{}{
		"id":            "EV-20260101-0001",
		"create_time":   time.Now().Format(time.RFC3339),
		"event_type":    "TRANSACTION.SUCCESS",
		"resource_type": "encrypt-resource",
		"summary":       "支付成功",
		"resource": map[string]interface{}{
			"original_type":   "transaction",
			"algorithm":       "AEAD_AES_256_GCM",
			"nonce":           "abcdefghijkl",
			"associated_data": "transaction",
			"ciphertext":      sealGCM(t, testAPIv3Key, "abcdefghijkl", "transaction", string(plain)),
		},
	}
	body, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("序列化通知报文失败: %v", err)
	}
	return body
}

func testTransaction() map[string]interface{} {
	return map[string]interface{}{
		"appid":            "wxtestappid000001",
		"mchid":            "1900000001",
		"out_trade_no":     "P202601010000000000001",
		"transaction_id":   "4200001234202601011234567890",
		"trade_type":       "NATIVE",
		"trade_state":      "SUCCESS",
		"trade_state_desc": "支付成功",
		"success_time":     time.Now().Format(time.RFC3339),
		"amount":           map[string]interface{}{"total": 9900, "payer_total": 9900, "currency": "CNY"},
	}
}

// TestDecryptResource AES-256-GCM：三段（key/nonce/AAD）缺一不可
func TestDecryptResource(t *testing.T) {
	cipherText := sealGCM(t, testAPIv3Key, "nonce1234567", "transaction", `{"hello":"微信支付"}`)

	plain, err := DecryptResource(testAPIv3Key, "nonce1234567", "transaction", cipherText, "AEAD_AES_256_GCM")
	if err != nil {
		t.Fatalf("正常解密失败: %v", err)
	}
	if string(plain) != `{"hello":"微信支付"}` {
		t.Fatalf("解密结果不对: %s", plain)
	}

	// 错误密钥 / 错误 AAD / 错误算法 都必须失败
	if _, err := DecryptResource("12345678901234567890123456789012", "nonce1234567", "transaction", cipherText, ""); err == nil {
		t.Fatal("错误 APIv3 密钥竟然解密成功")
	}
	if _, err := DecryptResource(testAPIv3Key, "nonce1234567", "certificate", cipherText, ""); err == nil {
		t.Fatal("错误 associated_data 竟然解密成功")
	}
	if _, err := DecryptResource(testAPIv3Key, "nonce1234567", "transaction", cipherText, "AEAD_AES_128_GCM"); err == nil {
		t.Fatal("不支持的算法竟然通过")
	}
	if _, err := DecryptResource("short-key", "nonce1234567", "transaction", cipherText, ""); err == nil {
		t.Fatal("非 32 字节密钥竟然通过")
	}
}

// TestParseNotifyWithStaticPlatformCert 静态平台证书模式：验签 + 解密 + 篡改/重放拒绝
func TestParseNotifyWithStaticPlatformCert(t *testing.T) {
	platformKey, platformCertPEM, platformSerial := genKeyAndCertPEM(t, "Tenpay Platform")
	merchantKey, _, merchantSerial := genKeyAndCertPEM(t, "Merchant")

	cfg := Config{
		Enabled:      true,
		AppID:        "wxtestappid000001",
		MchID:        "1900000001",
		APIv3Key:     testAPIv3Key,
		CertSerialNo: merchantSerial,
		PrivateKey:   privateKeyPEM(t, merchantKey),
		PlatformCert: platformCertPEM,
		NotifyURL:    "https://example.com/api/payment/wechat/notify",
	}
	cli, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("构造客户端失败: %v", err)
	}

	body := buildNotifyBody(t, testTransaction())
	headers := signNotify(t, platformKey, platformSerial, body, time.Now())

	tx, event, err := cli.ParseNotify(context.Background(), headers, body)
	if err != nil {
		t.Fatalf("正常回调解析失败: %v", err)
	}
	if event.EventType != "TRANSACTION.SUCCESS" {
		t.Fatalf("事件类型不对: %s", event.EventType)
	}
	if tx.OutTradeNo != "P202601010000000000001" || tx.TransactionID == "" || !tx.Paid() {
		t.Fatalf("交易报文解析不对: %+v", tx)
	}

	// 1) 缺少签名头 → 拒绝
	if _, _, err := cli.ParseNotify(context.Background(), http.Header{}, body); err == nil {
		t.Fatal("缺少签名头竟然通过")
	}
	// 2) 篡改报文（签名不再匹配）→ 拒绝
	tampered := buildNotifyBody(t, map[string]interface{}{
		"out_trade_no": "P202601010000000000001", "trade_state": "SUCCESS",
		"amount": map[string]interface{}{"total": 1},
	})
	if _, _, err := cli.ParseNotify(context.Background(), headers, tampered); err == nil {
		t.Fatal("报文被篡改竟然通过验签")
	}
	// 3) 重放（时间戳超 5 分钟）→ 拒绝
	oldHeaders := signNotify(t, platformKey, platformSerial, body, time.Now().Add(-10*time.Minute))
	if _, _, err := cli.ParseNotify(context.Background(), oldHeaders, body); err == nil {
		t.Fatal("超时重放竟然通过")
	}
	// 4) 未知证书序列号（且平台证书未配置、也拉不到）→ 拒绝
	unknownKey, _, unknownSerial := genKeyAndCertPEM(t, "Attacker")
	unknownHeaders := signNotify(t, unknownKey, unknownSerial, body, time.Now())
	if _, _, err := cli.ParseNotify(context.Background(), unknownHeaders, body); err == nil {
		t.Fatal("未知序列号竟然通过")
	}
}

// TestPlatformCertFetchAndVerify 平台证书**动态获取**链路：
// 用假微信服务返回加密的平台证书 → 客户端拉取解密 → 用它验签成功（覆盖证书轮换后的自动刷新）
func TestPlatformCertFetchAndVerify(t *testing.T) {
	platformKey, platformCertPEM, platformSerial := genKeyAndCertPEM(t, "Tenpay Platform")
	merchantKey, _, merchantSerial := genKeyAndCertPEM(t, "Merchant")

	// 假微信服务：GET /v3/certificates 返回「加密后的平台证书」
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v3/certificates" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		// 商户请求必须带 APIv3 授权头（签名）
		if !strings.HasPrefix(r.Header.Get("Authorization"), "WECHATPAY2-SHA256-RSA2048") {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		cipherText := sealGCM(t, testAPIv3Key, "certnonce123", "certificate", platformCertPEM)
		_ = json.NewEncoder(w).Encode(map[string]interface{}{
			"data": []map[string]interface{}{{
				"serial_no":      platformSerial,
				"effective_time": time.Now().Format(time.RFC3339),
				"expire_time":    time.Now().Add(365 * 24 * time.Hour).Format(time.RFC3339),
				"encrypt_certificate": map[string]interface{}{
					"algorithm":       "AEAD_AES_256_GCM",
					"nonce":           "certnonce123",
					"associated_data": "certificate",
					"ciphertext":      cipherText,
				},
			}},
		})
	}))
	defer srv.Close()

	cfg := Config{
		Enabled:      true,
		AppID:        "wxtestappid000001",
		MchID:        "1900000001",
		APIv3Key:     testAPIv3Key,
		CertSerialNo: merchantSerial,
		PrivateKey:   privateKeyPEM(t, merchantKey),
		NotifyURL:    "https://example.com/api/payment/wechat/notify",
		APIBase:      srv.URL,
	}
	cli, err := NewClient(cfg)
	if err != nil {
		t.Fatalf("构造客户端失败: %v", err)
	}
	if err := cli.FetchPlatformCerts(context.Background()); err != nil {
		t.Fatalf("拉取平台证书失败: %v", err)
	}
	if _, ok := cli.certs.get(platformSerial); !ok {
		t.Fatal("平台证书未进入缓存")
	}

	body := buildNotifyBody(t, testTransaction())
	headers := signNotify(t, platformKey, platformSerial, body, time.Now())
	if _, _, err := cli.ParseNotify(context.Background(), headers, body); err != nil {
		t.Fatalf("用动态获取的平台证书验签失败: %v", err)
	}
}

// TestConfigReadyAndMask 配置完备性与脱敏
func TestConfigReadyAndMask(t *testing.T) {
	empty := Config{}
	if empty.Ready() {
		t.Fatal("空配置不应视为可用")
	}
	missing := empty.Missing()
	if len(missing) == 0 {
		t.Fatal("空配置应列出缺失项")
	}
	for _, m := range missing {
		if strings.Contains(m, testAPIv3Key) {
			t.Fatal("缺失项列表泄露了密钥")
		}
	}

	full := Config{
		Enabled: true, AppID: "wx1", MchID: "1900000001", APIv3Key: testAPIv3Key,
		CertSerialNo: "ABC", PrivateKey: "-----BEGIN PRIVATE KEY-----",
		NotifyURL: "https://example.com/api/payment/wechat/notify",
	}
	if !full.Ready() {
		t.Fatalf("完整配置应可用，缺失: %v", full.Missing())
	}

	if got := MaskSecret("1234567890"); got != "****7890" {
		t.Fatalf("脱敏结果不对: %s", got)
	}
	if got := MaskSecret("123"); got != "****" {
		t.Fatalf("短值应全遮: %s", got)
	}
	if got := MaskSecret(""); got != "" {
		t.Fatalf("空值应为空串: %s", got)
	}
}
