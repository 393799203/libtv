package service

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"

	"libtv/internal/config"
	"libtv/internal/pkg/apperror"
	"libtv/internal/wxpay"
)

// 微信支付配置**只来自服务器一处**（config.yaml 的 payment.wxpay + WXPAY_* 环境变量）：
// 这里锁住两件事 —— 生效配置就是服务器配置本身，以及回调地址的推导口径没变
// （回调 /api/payment/wechat/notify 必须仍然可达，地址由站点域名推导或显式配置）。
func TestWechatPayConfigComesFromServerOnly(t *testing.T) {
	base := config.WxpayConfig{
		Enabled:      true,
		AppID:        "wx-test-appid",
		MchID:        "1900000000",
		APIv3Key:     strings.Repeat("k", 32),
		CertSerialNo: "ABCDEF1234567890",
		PrivateKey:   "-----BEGIN PRIVATE KEY-----\nstub\n-----END PRIVATE KEY-----",
		H5Enabled:    true,
	}

	// 站点基地址留空 → 用启动参数里的 FRONTEND_BASE 兜底推导回调地址
	withFallback := NewWechatPayConfigService(base, false, "https://manwa.yunqueai.cloud")
	cfg := withFallback.Effective(context.Background())
	if cfg.NotifyURL != "https://manwa.yunqueai.cloud"+wxpay.NotifyPath {
		t.Fatalf("回调地址推导错误: got %q", cfg.NotifyURL)
	}
	if !cfg.Ready() {
		t.Fatal("服务器配置齐全时 Ready() 应为 true")
	}
	if cfg.AppID != base.AppID || cfg.MchID != base.MchID || cfg.APIv3Key != base.APIv3Key {
		t.Fatal("生效配置必须逐字等于服务器配置（不接受任何第二来源覆盖）")
	}
	if !cfg.H5Enabled {
		t.Fatal("h5_enabled 应来自服务器配置")
	}

	// 显式配置的 notify_url 优先于站点域名推导
	explicit := base
	explicit.NotifyURL = "https://pay.example.com/api/payment/wechat/notify"
	got := NewWechatPayConfigService(explicit, false, "").Effective(context.Background())
	if got.NotifyURL != explicit.NotifyURL {
		t.Fatalf("显式回调地址应优先: got %q", got.NotifyURL)
	}

	// 配置为空即「未配置」（前端置灰，不影响支付宝）
	empty := NewWechatPayConfigService(config.WxpayConfig{}, true, "").Effective(context.Background())
	if empty.Ready() {
		t.Fatal("空配置不应视为可用")
	}
}

// 未配置 / 配置不全时的优雅降级契约：
//   - 下单返回 400 业务错误（绝不是 500，也不创建垃圾订单）
//   - 能力接口如实返回 available=false + 原因
//   - 支付宝能力不受微信支付配置影响
func TestWechatPayDegradesWhenNotConfigured(t *testing.T) {
	cases := []struct {
		name    string
		base    config.WxpayConfig
		wantErr error
	}{
		{name: "开关未开（默认）", base: config.WxpayConfig{}, wantErr: ErrWechatPayDisabled},
		{
			name:    "开关开着但配置不全",
			base:    config.WxpayConfig{Enabled: true, AppID: "wx-test-appid", MchID: "1900000000"},
			wantErr: ErrWechatPayNotConfigured,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// db / billing 传 nil：降级路径必须在碰数据库之前就返回业务错误
			svc := NewWechatPayService(nil, nil, NewWechatPayConfigService(tc.base, true, ""))

			_, _, err := svc.CreateOrder(context.Background(), "user-1", "1", "pc", "127.0.0.1")
			if !errors.Is(err, tc.wantErr) {
				t.Fatalf("CreateOrder err = %v, want %v", err, tc.wantErr)
			}
			var ae *apperror.AppError
			if !errors.As(err, &ae) {
				t.Fatalf("下单错误应为 AppError：%v", err)
			}
			if ae.HTTPStatus != http.StatusBadRequest {
				t.Fatalf("未配置下单必须 400，实际 HTTP %d", ae.HTTPStatus)
			}

			methods := svc.Methods(context.Background())
			if methods.Wechat.Available || methods.Wechat.NativeAvailable || methods.Wechat.H5Available {
				t.Fatalf("未配置时微信必须不可用: %+v", methods.Wechat)
			}
			if methods.Wechat.Reason == "" {
				t.Fatal("未配置时微信必须给出不可用原因")
			}
			if !methods.Alipay.Available {
				t.Fatal("支付宝能力不应受微信支付配置影响")
			}
		})
	}
}