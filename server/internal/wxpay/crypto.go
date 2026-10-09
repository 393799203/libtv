package wxpay

import (
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"strings"
)

// ErrSignature 回调验签失败（缺失 / 篡改 / 未知证书序列号）
var ErrSignature = errors.New("微信支付回调验签失败")

// parsePrivateKey 解析商户 API 私钥（apiclient_key.pem，PKCS8 为主，兼容 PKCS1）
func parsePrivateKey(pemStr string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(pemStr)))
	if block == nil {
		return nil, errors.New("私钥不是合法的 PEM")
	}
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rsaKey, ok := k.(*rsa.PrivateKey); ok {
			return rsaKey, nil
		}
		return nil, errors.New("私钥不是 RSA 类型")
	}
	return x509.ParsePKCS1PrivateKey(block.Bytes)
}

// parsePublicKeyPEM 解析 PEM 公钥 / 证书：证书取其中的公钥（PKIX 与 PKCS1 都兼容）
func parsePublicKeyPEM(pemStr string) (*rsa.PublicKey, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(pemStr)))
	if block == nil {
		return nil, errors.New("公钥/证书不是合法的 PEM")
	}
	if cert, err := x509.ParseCertificate(block.Bytes); err == nil {
		rsaKey, ok := cert.PublicKey.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("证书里的公钥不是 RSA 类型")
		}
		return rsaKey, nil
	}
	if k, err := x509.ParsePKIXPublicKey(block.Bytes); err == nil {
		rsaKey, ok := k.(*rsa.PublicKey)
		if !ok {
			return nil, errors.New("公钥不是 RSA 类型")
		}
		return rsaKey, nil
	}
	return x509.ParsePKCS1PublicKey(block.Bytes)
}

// certSerialHex 取证书序列号的大写十六进制（与微信回调头 Wechatpay-Serial 同格式）
func certSerialHex(cert *x509.Certificate) string {
	return strings.ToUpper(hex.EncodeToString(cert.SerialNumber.Bytes()))
}

// serialFromPEM 从证书 PEM 里取序列号（配置了平台证书时用于匹配 Wechatpay-Serial）
func serialFromPEM(pemStr string) (string, error) {
	block, _ := pem.Decode([]byte(strings.TrimSpace(pemStr)))
	if block == nil {
		return "", errors.New("证书不是合法的 PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", err
	}
	return certSerialHex(cert), nil
}

// randomNonce 生成 32 位随机串（APIv3 请求随机串）
func randomNonce() (string, error) {
	const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	buf := make([]byte, 32)
	for i := range buf {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(charset))))
		if err != nil {
			return "", err
		}
		buf[i] = charset[n.Int64()]
	}
	return string(buf), nil
}

// buildRequestSignString 构造商户**请求**签名串（5 行，每行以 \n 结尾）
func buildRequestSignString(method, urlPath, timestamp, nonce, body string) string {
	return method + "\n" + urlPath + "\n" + timestamp + "\n" + nonce + "\n" + body + "\n"
}

// buildResponseSignString 构造**回调**验签串（时间戳 \n 随机串 \n 报文主体 \n）
func buildResponseSignString(timestamp, nonce, body string) string {
	return timestamp + "\n" + nonce + "\n" + body + "\n"
}

// signRSA 用商户私钥做 SHA256withRSA 签名（base64）
func signRSA(priv *rsa.PrivateKey, message string) (string, error) {
	digest := sha256.Sum256([]byte(message))
	sig, err := rsa.SignPKCS1v15(rand.Reader, priv, crypto.SHA256, digest[:])
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(sig), nil
}

// verifyRSA 用微信侧公钥校验回调签名（base64 签名）
func verifyRSA(pub *rsa.PublicKey, message, signature string) error {
	sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(signature))
	if err != nil {
		return fmt.Errorf("%w: 签名不是合法 base64", ErrSignature)
	}
	digest := sha256.Sum256([]byte(message))
	if err := rsa.VerifyPKCS1v15(pub, crypto.SHA256, digest[:], sig); err != nil {
		return fmt.Errorf("%w: %v", ErrSignature, err)
	}
	return nil
}

// DecryptResource AES-256-GCM 解密（回调 resource / 平台证书 encrypt_certificate）。
//
// 三段缺一不可：key = APIv3 密钥（32 字节）、nonce（12 字节字符串）、associated_data（附加数据）；
// 密文 base64 解码后为「密文 ‖ 16 字节 GCM tag」，正好是 Go cipher.AEAD.Open 期望的格式。
func DecryptResource(apiV3Key, nonce, associatedData, ciphertext, algorithm string) ([]byte, error) {
	if algorithm != "" && algorithm != "AEAD_AES_256_GCM" {
		return nil, fmt.Errorf("不支持的加密算法: %s", algorithm)
	}
	key := []byte(apiV3Key)
	if len(key) != 32 {
		return nil, errors.New("APIv3 密钥长度不是 32 字节")
	}
	raw, err := base64.StdEncoding.DecodeString(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("密文不是合法 base64: %w", err)
	}
	if len(nonce) == 0 {
		return nil, errors.New("缺少 nonce")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, []byte(nonce), raw, []byte(associatedData))
	if err != nil {
		// 常见原因：APIv3 密钥填错 / 报文被改动。这里不回显密钥，只说结论
		return nil, fmt.Errorf("AES-256-GCM 解密失败（APIv3 密钥或报文不匹配）: %w", err)
	}
	return plain, nil
}
