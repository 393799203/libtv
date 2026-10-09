package wxpay

import (
	"fmt"
	"strings"
)

// 本文件是微信支付配置的校验/推导入口：
// 用服务器配置（WXPAY_* / config.yaml）自检时，希望当场判出「填的东西能不能用」，
// 而不是等真实下单才炸（启动日志里的「缺少：…」与配置自检都基于这里）。
// 所有错误信息都只描述问题，绝不回显密钥原文。

// ValidateAPIv3Key 校验 APIv3 密钥（必须是 32 字节）
func ValidateAPIv3Key(key string) error {
	if strings.TrimSpace(key) == "" {
		return fmt.Errorf("APIv3 密钥不能为空")
	}
	if len(key) != 32 {
		return fmt.Errorf("APIv3 密钥长度必须是 32 字节（当前 %d 字节）", len(key))
	}
	return nil
}

// ValidatePrivateKey 校验商户 API 私钥 PEM（apiclient_key.pem）
func ValidatePrivateKey(pemStr string) error {
	if strings.TrimSpace(pemStr) == "" {
		return fmt.Errorf("商户 API 私钥不能为空")
	}
	if _, err := parsePrivateKey(pemStr); err != nil {
		return fmt.Errorf("商户 API 私钥无法解析（应为 apiclient_key.pem 的内容）: %v", err)
	}
	return nil
}

// ValidateMerchantCert 校验商户 API 证书 PEM（apiclient_cert.pem）
func ValidateMerchantCert(pemStr string) error {
	if _, err := serialFromPEM(pemStr); err != nil {
		return fmt.Errorf("商户 API 证书无法解析（应为 apiclient_cert.pem 的内容）: %v", err)
	}
	return nil
}

// DeriveSerialFromCert 从商户 API 证书里解析证书序列号（大写十六进制，与微信侧一致）
func DeriveSerialFromCert(pemStr string) (string, error) {
	return serialFromPEM(pemStr)
}

// ValidateWechatPublicKey 校验微信支付平台证书 / 微信支付公钥 PEM
func ValidateWechatPublicKey(pemStr string) error {
	if _, err := parsePublicKeyPEM(pemStr); err != nil {
		return fmt.Errorf("平台证书/微信支付公钥无法解析（应为证书或公钥 PEM）: %v", err)
	}
	return nil
}

// ValidateNotifyURL 校验回调地址（微信要求公网可达的 HTTPS 地址）
func ValidateNotifyURL(u string) error {
	u = strings.TrimSpace(u)
	if u == "" {
		return fmt.Errorf("回调地址为空")
	}
	if !strings.HasPrefix(u, "https://") {
		return fmt.Errorf("回调地址必须是 https:// 开头的公网地址（微信支付要求）")
	}
	return nil
}
