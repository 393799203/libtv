// Package mail 极简 SMTP 发信：只用标准库（net/smtp + crypto/tls + mime），不引第三方依赖。
//
// 定位：只发「系统通知类邮件」（当前只有注册欢迎邮件）。三条硬性约定：
//  1. 未配置或未启用时 Enabled() 返回 false，调用方静默跳过 —— 主流程完全不受邮件影响；
//  2. 失败只把 error 交给调用方记日志，绝不阻断业务（注册成功不该因为邮件发不出去而失败）；
//  3. 不做附件、不做群发、不做队列重试 —— 真需要时再单独设计，别把这里长成邮件框架。
package mail

import (
	"crypto/rand"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"
)

// ErrDisabled 未启用/未配置 SMTP 时发送返回的错误（调用方通常直接忽略）
var ErrDisabled = errors.New("SMTP 未启用或未配置")

// Options 发信配置。由 config.SMTPConfig 映射而来 —— 本包不 import config，
// 保持「邮件库」与「配置结构」解耦，也方便单独跑起来验证。
type Options struct {
	Enabled    bool
	Host       string
	Port       int    // 465=隐式 TLS；587/25=明文 + STARTTLS
	Username   string // 一般是完整邮箱地址
	Password   string // 授权码/密码
	From       string // 发件地址，留空回退 Username
	FromName   string // 发件人显示名
	SiteURL    string // 邮件里「进入平台」按钮的跳转地址
	SkipVerify bool   // 自建 SMTP 用自签证书时才置 true
}

// Sender 邮件发送器（并发安全：每次发送各自建连接，无共享可变状态）
type Sender struct {
	opts Options
	from string
}

func New(opts Options) *Sender {
	if opts.Port == 0 {
		opts.Port = 465
	}
	if strings.TrimSpace(opts.FromName) == "" {
		opts.FromName = "漫蛙"
	}
	from := strings.TrimSpace(opts.From)
	if from == "" {
		from = strings.TrimSpace(opts.Username)
	}
	return &Sender{opts: opts, from: from}
}

// Enabled 是否具备发信条件：开关打开 + 有服务器 + 有发件地址
func (s *Sender) Enabled() bool {
	return s != nil && s.opts.Enabled && strings.TrimSpace(s.opts.Host) != "" && s.from != ""
}

// Send 投递一封邮件：text 是纯文本兜底，html 是主体（两者用 multipart/alternative 一起发出，
// 邮件客户端按支持情况自己挑一个显示）。
func (s *Sender) Send(to, subject, text, html string) error {
	to = strings.TrimSpace(to)
	if to == "" {
		return errors.New("收件地址为空")
	}
	if !s.Enabled() {
		return ErrDisabled
	}
	raw := s.buildMessage(to, subject, text, html)

	addr := net.JoinHostPort(s.opts.Host, strconv.Itoa(s.opts.Port))
	tlsCfg := &tls.Config{
		ServerName:         s.opts.Host,
		InsecureSkipVerify: s.opts.SkipVerify, //nolint:gosec // 仅在运维显式配置自签证书时打开
	}

	// 465 是「连上即 TLS」（隐式 TLS）；587/25 先明文再 STARTTLS 升级。
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	var (
		conn net.Conn
		err  error
	)
	if s.opts.Port == 465 {
		conn, err = tls.DialWithDialer(dialer, "tcp", addr, tlsCfg)
	} else {
		conn, err = dialer.Dial("tcp", addr)
	}
	if err != nil {
		return fmt.Errorf("连接 SMTP 服务器 %s 失败: %w", addr, err)
	}
	defer conn.Close()
	// 整轮对话（握手→认证→投递）共用 30 秒上限，避免卡住调用方的 goroutine
	_ = conn.SetDeadline(time.Now().Add(30 * time.Second))

	c, err := smtp.NewClient(conn, s.opts.Host)
	if err != nil {
		return fmt.Errorf("SMTP 握手失败: %w", err)
	}
	defer c.Close()

	if s.opts.Port != 465 {
		if ok, _ := c.Extension("STARTTLS"); ok {
			if err := c.StartTLS(tlsCfg); err != nil {
				return fmt.Errorf("STARTTLS 失败: %w", err)
			}
		}
	}
	if s.opts.Username != "" {
		// PlainAuth 只允许在 TLS 或本机连接上发送口令，明文链路会直接报错（这是它自带的保护）
		if err := c.Auth(smtp.PlainAuth("", s.opts.Username, s.opts.Password, s.opts.Host)); err != nil {
			return fmt.Errorf("SMTP 认证失败: %w", err)
		}
	}
	if err := c.Mail(s.from); err != nil {
		return fmt.Errorf("设置发件人失败: %w", err)
	}
	if err := c.Rcpt(to); err != nil {
		return fmt.Errorf("设置收件人失败: %w", err)
	}
	w, err := c.Data()
	if err != nil {
		return fmt.Errorf("开始投递失败: %w", err)
	}
	if _, err := w.Write([]byte(raw)); err != nil {
		_ = w.Close()
		return fmt.Errorf("写入邮件内容失败: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("提交邮件内容失败: %w", err)
	}
	return c.Quit()
}

// buildMessage 拼 RFC 5322 报文。
//
// 中文主题必须做 RFC 2047 编码（QEncoding），否则会变成乱码或被拒收；
// 正文用 base64 传输编码，绕开 8bit 与 998 字节行长限制（中文一行很容易超）。
func (s *Sender) buildMessage(to, subject, text, html string) string {
	boundary := "libtv-" + randomHex(16)
	var b strings.Builder
	b.WriteString("From: " + formatAddress(s.opts.FromName, s.from) + "\r\n")
	b.WriteString("To: " + to + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("utf-8", subject) + "\r\n")
	b.WriteString("Date: " + time.Now().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("Message-ID: <" + randomHex(12) + "@" + domainOf(s.from) + ">\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n")
	b.WriteString("\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	b.WriteString(base64Lines(text) + "\r\n")

	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=utf-8\r\n")
	b.WriteString("Content-Transfer-Encoding: base64\r\n\r\n")
	b.WriteString(base64Lines(html) + "\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return b.String()
}

// formatAddress 生成 "显示名 <地址>"；显示名是中文，同样要走 RFC 2047 编码
func formatAddress(name, addr string) string {
	if strings.TrimSpace(name) == "" {
		return addr
	}
	return mime.QEncoding.Encode("utf-8", name) + " <" + addr + ">"
}

// base64Lines base64 编码并按 76 字符折行（RFC 2045 要求）
func base64Lines(s string) string {
	enc := base64.StdEncoding.EncodeToString([]byte(s))
	var b strings.Builder
	for len(enc) > 76 {
		b.WriteString(enc[:76])
		b.WriteString("\r\n")
		enc = enc[76:]
	}
	b.WriteString(enc)
	return b.String()
}

func randomHex(n int) string {
	buf := make([]byte, n)
	if _, err := rand.Read(buf); err != nil {
		// 随机源不可用时退化成时间戳，仅用于 Message-ID/boundary 的唯一性，不涉安全
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf)
}

// domainOf 取地址里的域名部分（用于 Message-ID），取不到就给个占位
func domainOf(addr string) string {
	if i := strings.LastIndex(addr, "@"); i >= 0 && i+1 < len(addr) {
		if d := strings.TrimSpace(addr[i+1:]); d != "" {
			return d
		}
	}
	return "localhost"
}
