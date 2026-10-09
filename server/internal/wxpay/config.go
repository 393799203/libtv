// Package wxpay 微信支付 APIv3 的最小可用实现（**只用标准库**，不引入任何第三方 SDK）。
//
// 覆盖接入所需的四件事：
//  1. 商户请求签名（WECHATPAY2-SHA256-RSA2048，Authorization 头）
//  2. 回调验签（平台证书 / 微信支付公钥，证书会轮换 → 缓存 + 可刷新）
//  3. 回调报文解密（AEAD_AES_256_GCM，APIv3 密钥）
//  4. Native / H5 下单、按商户订单号主动查单
//
// 与本项目的支付宝实现平级：两者共用同一张 payment_orders 表与同一套到账路径，
// 本包只负责「微信侧的协议」，业务编排在 service.WechatPayService。
//
// 安全约定：本包任何日志都不打印私钥 / APIv3 密钥 / 签名串原文；
// 配置里出现的密钥只来自服务器一处 —— 环境变量（WXPAY_*）或 config.yaml（仓库内留空），
// 绝不写入代码或仓库。
package wxpay

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// DefaultAPIBase 微信支付 APIv3 正式环境域名；沙箱/自测可通过配置覆盖
const DefaultAPIBase = "https://api.mch.weixin.qq.com"

// NotifyPath 异步通知回调路径：站点域名（https）+ 该路径即回调地址
const NotifyPath = "/api/payment/wechat/notify"

// Config 微信支付运行时配置。
//
// 必填（缺任一项即视为「未配置」，下单返回「微信支付暂未开通」而不是 500）：
// Enabled / AppID / MchID / APIv3Key（32 字节）/ CertSerialNo / PrivateKey / NotifyURL。
//
// 平台证书与微信支付公钥二选一即可（都可留空）：
//   - 都留空 → 运行时调用 GET /v3/certificates 动态获取并缓存平台证书（证书轮换自动跟上）
//   - PlatformCert 填了 → 直接用该证书验签（匹配 Wechatpay-Serial）
//   - PublicKey + PublicKeyID 填了 → 走「微信支付公钥」模式（Serial 以 PUB_KEY_ID_ 开头）
type Config struct {
	Enabled      bool   // 启用开关（未启用 = 前端置灰「暂未开通」）
	AppID        string // 公众号 / 小程序 / App 的 AppID（必须与商户号绑定，APIv3 下单必填）
	MchID        string // 商户号
	APIv3Key     string // APIv3 密钥（32 字节，商户平台「账户中心-API安全」设置）
	CertSerialNo string // 商户 API 证书序列号（apiclient_cert.pem 的序列号）
	MerchantCert string // 商户 API 证书 PEM（apiclient_cert.pem，可选：填了自动解析出序列号）
	PrivateKey   string // 商户 API 私钥 PEM（apiclient_key.pem）

	PlatformCert string // 微信支付平台证书 PEM（可留空：留空则动态获取）
	PublicKey    string // 微信支付公钥 PEM（公钥模式，可留空）
	PublicKeyID  string // 微信支付公钥 ID（PUB_KEY_ID_ 开头，配合 PublicKey 使用）

	NotifyURL   string // 异步回调地址（公网可达）；留空时按站点域名推导（见 SuggestNotifyURL）
	SiteBaseURL string // 站点基地址（用于推导回调地址，如 https://manwa.yunqueai.cloud）
	APIBase     string // API 域名覆盖（默认官方域名；沙箱或自测时用）

	H5Enabled bool // H5 支付权限是否已开通（需在商户平台单独申请）
}

// Normalize 补齐可推导的字段：证书序列号留空时，从商户 API 证书里解析出来。
// 商户平台要另开页面才能查到序列号，直接粘贴 apiclient_cert.pem 更省事、也不容易抄错。
func (c Config) Normalize() Config {
	if strings.TrimSpace(c.CertSerialNo) == "" && strings.TrimSpace(c.MerchantCert) != "" {
		if serial, err := DeriveSerialFromCert(c.MerchantCert); err == nil {
			c.CertSerialNo = serial
		}
	}
	return c
}

// Ready 下单 / 回调所需的关键项是否齐全（缺项 = 未配置，走优雅降级）
func (c Config) Ready() bool {
	if !c.Enabled {
		return false
	}
	if strings.TrimSpace(c.AppID) == "" || strings.TrimSpace(c.MchID) == "" {
		return false
	}
	if strings.TrimSpace(c.CertSerialNo) == "" || strings.TrimSpace(c.PrivateKey) == "" {
		return false
	}
	if len(c.APIv3Key) != 32 {
		return false
	}
	if strings.TrimSpace(c.NotifyURL) == "" {
		return false
	}
	return true
}

// Missing 返回缺失项的中文名（用于前端提示「还缺什么」；不含任何密钥内容）
func (c Config) Missing() []string {
	missing := make([]string, 0, 6)
	if strings.TrimSpace(c.AppID) == "" {
		missing = append(missing, "AppID")
	}
	if strings.TrimSpace(c.MchID) == "" {
		missing = append(missing, "商户号")
	}
	if strings.TrimSpace(c.CertSerialNo) == "" {
		missing = append(missing, "证书序列号")
	}
	if strings.TrimSpace(c.PrivateKey) == "" {
		missing = append(missing, "商户 API 私钥")
	}
	if len(c.APIv3Key) != 32 {
		missing = append(missing, "APIv3 密钥（须 32 字节）")
	}
	if strings.TrimSpace(c.NotifyURL) == "" {
		missing = append(missing, "回调地址")
	}
	return missing
}

// APIBaseOr 返回生效的 API 域名
func (c Config) APIBaseOr() string {
	if strings.TrimSpace(c.APIBase) == "" {
		return DefaultAPIBase
	}
	return strings.TrimRight(strings.TrimSpace(c.APIBase), "/")
}

// Fingerprint 配置指纹：用于「配置变了就重建客户端」的判断。
// 只做哈希，不泄露任何字段原文。
func (c Config) Fingerprint() string {
	h := sha256.New()
	fields := []string{
		fmt.Sprintf("%t", c.Enabled), c.AppID, c.MchID, c.APIv3Key, c.CertSerialNo,
		c.PrivateKey, c.PlatformCert, c.PublicKey, c.PublicKeyID, c.NotifyURL, c.APIBase,
	}
	for _, f := range fields {
		h.Write([]byte(f))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// SuggestNotifyURL 推导建议回调地址（也用于日志里核对生效的回调地址）。
// 优先级：显式配置的 notify_url > 站点基地址（site_base_url / FRONTEND_BASE / CORS 域名）。
func SuggestNotifyURL(explicit, siteBase string) string {
	if u := strings.TrimSpace(explicit); u != "" {
		return u
	}
	base := strings.TrimRight(strings.TrimSpace(siteBase), "/")
	if base == "" {
		return ""
	}
	return base + NotifyPath
}

// MaskSecret 密钥脱敏：只保留后 4 位，其余用 * 代替。
// 空值返回空串（前端据此显示「未配置」），长度不足 4 位一律全遮。
func MaskSecret(v string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return ""
	}
	runes := []rune(v)
	if len(runes) <= 4 {
		return "****"
	}
	return "****" + string(runes[len(runes)-4:])
}
