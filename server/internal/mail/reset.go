package mail

import (
	"fmt"
	"html"
	"net/url"
	"strings"
)

// ResetPath 找回密码的重置页路径。邮件里的链接由此拼出，前端路由须与之一致。
const ResetPath = "/reset-password"

// SendPasswordReset 发送「重置密码」邮件：一个直达重置页的按钮 + 有效期说明。
//
// token 是明文令牌（服务端只存哈希），只在这封邮件里出现一次。
// expireMinutes 决定邮件里「链接 X 分钟内有效」的文案——由调用方（service）传入，
// 保证文案与后端真实过期时间永远一致，不会各写各的。
func (s *Sender) SendPasswordReset(to, nickname, token string, expireMinutes int) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	name := strings.TrimSpace(nickname)
	site := strings.TrimSpace(s.opts.SiteURL)
	if site == "" {
		site = "https://manwa.yunqueai.cloud"
	}
	// 与欢迎邮件同款处理：没填昵称就直接「你好：」，避免出现「你好，你好：」
	greeting := "你好："
	if name != "" {
		greeting = name + "，你好："
	}

	// 令牌进 URL 前做一次转义；hex 串本身无特殊字符，这里是防御性写法
	link := resetLink(site, token)

	subject := "重置你的漫蛙密码"
	return s.Send(to, subject,
		resetText(greeting, link, expireMinutes),
		resetHTML(greeting, link, expireMinutes))
}

// resetLink 拼出邮件里的重置链接。抽成独立函数是为了能单测——
// 这串地址的另一端是前端的 ResetPath 路由，两边一旦对不上，用户点邮件就是 404，
// 而那种错在本地开发时几乎不会暴露（没人会去点自己的测试邮件）。
func resetLink(site, token string) string {
	if strings.TrimSpace(site) == "" {
		site = "https://manwa.yunqueai.cloud"
	}
	return strings.TrimRight(site, "/") + ResetPath + "?token=" + url.QueryEscape(token)
}

// resetText 纯文本兜底版
func resetText(greeting, link string, expireMinutes int) string {
	return fmt.Sprintf(`%s

我们收到了重置漫蛙账号密码的请求。点击下面的链接设置新密码：

%s

该链接 %d 分钟内有效，且只能使用一次。

如果这不是你本人的操作，忽略本邮件即可，你的密码不会有任何变化。

本邮件由系统自动发送，请勿直接回复。
`, greeting, link, expireMinutes)
}

// resetHTML 邮件正文（HTML 版），结构与 welcomeHTML 保持一致：
// 表格 + 内联样式（邮件客户端对外链样式表支持极差）、浅底白卡、table 包按钮。
func resetHTML(greeting, link string, expireMinutes int) string {
	greeting = html.EscapeString(greeting)
	link = html.EscapeString(link)
	font := "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>重置你的漫蛙密码</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f4f7;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;background-color:#ffffff;border-radius:16px;border:1px solid #e9ecf1;">
        <tr>
          <td height="4" style="height:4px;line-height:4px;font-size:0;background-color:#22d3ee;background-image:linear-gradient(90deg,#22d3ee,#7c3aed);border-radius:16px 16px 0 0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:32px 32px 0;font-family:` + font + `;">
            <img src="` + strings.TrimRight(html.EscapeString(safeSite(link)), "/") + `/favicon-192x192.png" width="44" height="44" alt="漫蛙" style="display:block;width:44px;height:44px;border:0;border-radius:12px;">
            <h1 style="margin:20px 0 0;font-size:22px;line-height:1.45;color:#111827;font-weight:700;">重置密码</h1>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.75;color:#374151;">` + greeting + `</p>
            <p style="margin:10px 0 0;font-size:15px;line-height:1.75;color:#374151;">
              我们收到了重置你漫蛙账号密码的请求。点下面的按钮设置新密码：
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
              <tr>
                <td align="center" bgcolor="#0891b2" style="border-radius:12px;">
                  <a href="` + link + `" target="_blank" style="display:inline-block;padding:14px 30px;font-family:` + font + `;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">设置新密码 →</a>
                </td>
              </tr>
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;background-color:#f7f9fb;border:1px solid #edf0f4;border-radius:12px;">
              <tr>
                <td style="padding:16px 20px;font-family:` + font + `;font-size:13px;line-height:1.9;color:#4b5563;">
                  · 该链接 <span style="color:#111827;font-weight:600;">` + fmt.Sprint(expireMinutes) + ` 分钟内</span>有效，且<b>只能使用一次</b><br>
                  · 设置成功后，你在其他设备上的登录状态会全部失效，需重新登录
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#9ca3af;">
              按钮点不动的话，把下面这个地址复制到浏览器打开：<br>
              <a href="` + link + `" target="_blank" style="color:#0891b2;text-decoration:none;word-break:break-all;">` + link + `</a>
            </p>
            <p style="margin:16px 0 0;font-size:13px;line-height:1.75;color:#6b7280;">
              <b style="color:#374151;">如果这不是你本人的操作</b>，忽略本邮件即可，你的密码不会有任何变化。
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px 28px;font-family:` + font + `;">
            <div style="height:1px;line-height:1px;font-size:0;background-color:#eef0f3;">&nbsp;</div>
            <p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#9ca3af;">
              本邮件由系统自动发送，请勿直接回复。<br>
              © 漫蛙 · 用 AI 把想法变成画面
            </p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`
}

// safeSite 从重置链接里截出站点根地址，供邮件头部的 logo 使用。
// 解析失败时回退到链接本身（宁可 logo 不显示，也不能让整封邮件报错发不出去）。
func safeSite(link string) string {
	u, err := url.Parse(link)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return link
	}
	return u.Scheme + "://" + u.Host
}
