package service

import (
	"context"
	"strings"

	"libtv/internal/config"
	"libtv/internal/wxpay"
)

// WechatPayConfigService 微信支付配置：**只认服务器配置**。
//
// 唯一的配置来源（刻意如此，与支付宝完全一致）：
//   - config.yaml 的 payment.wxpay 段（仓库里只留空占位）
//   - 部署机环境变量 WXPAY_*（含 WXPAY_PRIVATE_KEY_FILE / WXPAY_PLATFORM_CERT_FILE / WXPAY_PUBLIC_KEY_FILE 读 PEM）
//
// **不再读 settings 表**：密钥类配置只保留服务器一处来源，
// 后台「商务配置 → 支付配置」页已下线，不存在「后台填的值覆盖环境变量」这种双来源。
// 配置在进程启动时确定（环境变量注入的内容运行期不会变），因此这里只在构造时算一次，
// 之后每次调用返回同一份快照 —— 没有数据库查询、没有缓存失效逻辑。
type WechatPayConfigService struct {
	base          config.WxpayConfig
	effective     wxpay.Config
	alipayEnabled bool
	frontendBase  string
}

// NewWechatPayConfigService 创建配置服务。
// base 为 config.yaml + 环境变量解析后的微信支付配置（见 config.loadFromEnv），
// alipayEnabled 用于前台收银台如实标注支付宝是否可用，frontendBase 是回调地址推导的最后兜底。
func NewWechatPayConfigService(base config.WxpayConfig, alipayEnabled bool, frontendBase string) *WechatPayConfigService {
	s := &WechatPayConfigService{base: base, alipayEnabled: alipayEnabled, frontendBase: frontendBase}
	s.effective = s.compute()
	return s
}

// compute 按服务器配置组装生效配置（启动时算一次）
func (s *WechatPayConfigService) compute() wxpay.Config {
	// 站点基地址：config.yaml 的 site_base_url（环境变量 SITE_BASE_URL / FRONTEND_BASE 也会写进这里）
	// 留空时回落到启动参数里的 FRONTEND_BASE
	siteBase := strings.TrimSpace(s.base.SiteBaseURL)
	if siteBase == "" {
		siteBase = strings.TrimSpace(s.frontendBase)
	}
	// 显式配置的回调地址优先（WXPAY_NOTIFY_URL / yaml），否则由站点域名推导
	notify := strings.TrimSpace(s.base.NotifyURL)
	if notify == "" {
		notify = wxpay.SuggestNotifyURL("", siteBase)
	}

	cfg := wxpay.Config{
		Enabled:      s.base.Enabled,
		AppID:        strings.TrimSpace(s.base.AppID),
		MchID:        strings.TrimSpace(s.base.MchID),
		APIv3Key:     strings.TrimSpace(s.base.APIv3Key),
		CertSerialNo: strings.TrimSpace(s.base.CertSerialNo),
		PrivateKey:   strings.TrimSpace(s.base.PrivateKey),
		PlatformCert: strings.TrimSpace(s.base.PlatformCert),
		PublicKey:    strings.TrimSpace(s.base.PublicKey),
		PublicKeyID:  strings.TrimSpace(s.base.PublicKeyID),
		NotifyURL:    notify,
		SiteBaseURL:  siteBase,
		APIBase:      s.base.APIBase,
		H5Enabled:    s.base.H5Enabled,
	}
	return cfg.Normalize()
}

// Effective 返回生效的微信支付配置（只来自服务器配置，启动后固定不变）
func (s *WechatPayConfigService) Effective(_ context.Context) wxpay.Config {
	return s.effective
}