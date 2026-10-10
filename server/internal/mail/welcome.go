package mail

import (
	"fmt"
	"html"
	"strings"
)

// SendWelcome 发送注册欢迎邮件：一句欢迎 + 一个直接进入平台的按钮。
//
// 站内地址取 Options.SiteURL（main 里按 SMTP.SiteURL → FRONTEND_BASE →
// 支付配置的站点域名 → 默认域名 依次回退），所以邮件里的链接永远和当前环境一致。
func (s *Sender) SendWelcome(to, nickname string) error {
	if !s.Enabled() {
		return ErrDisabled
	}
	name := strings.TrimSpace(nickname)
	site := strings.TrimSpace(s.opts.SiteURL)
	if site == "" {
		site = "https://manwa.yunqueai.cloud"
	}
	// 昵称可以不填：填了就是「张三，你好：」，没填就直接「你好：」——
	// 否则会出现「你好，你好：」这种把人看笑的招呼
	greeting := "你好："
	if name != "" {
		greeting = name + "，你好："
	}

	subject := "欢迎加入漫蛙，你的账号已开通"
	return s.Send(to, subject, welcomeText(greeting, to, site), welcomeHTML(greeting, to, site))
}

// welcomeText 纯文本兜底（部分客户端、以及「只看纯文本」的用户会看到这一版）
func welcomeText(greeting, email, site string) string {
	return fmt.Sprintf(`%s

欢迎加入漫蛙！你的账号 %s 已注册成功。

漫蛙是一个「AI 视频创作工作台」—— 从一句创意出发，把故事、分镜、画面一路做到成片。

  · 脚本解析 · 分镜拆解 —— 一句创意，自动拆成分镜脚本
  · AI 生图 · AI 生视频 —— 主流模型随手切换
  · TTS 语音合成 —— 配音、旁白直接生成
  · 3D 预演 · 节点工作流 —— 角色镜头先排练，再用工作流串成片

现在就可以开始创作了：
%s

（如果链接点不开，请把它复制到浏览器地址栏打开。）

本邮件由系统自动发送，请勿直接回复。
`, greeting, email, site)
}

// welcomeHTML 邮件正文（HTML 版）。
//
// 刻意用「表格 + 内联样式」而不是 div/flex：邮件客户端对现代 CSS 支持极差，
// 外链样式表会被直接剥掉，只有内联样式才稳定。颜色用浅底白卡，暗色邮件在很多
// 客户端里会糊成一片。
func welcomeHTML(greeting, email, site string) string {
	// 用户昵称来自注册表单，必须转义后再进 HTML
	greeting = html.EscapeString(greeting)
	email = html.EscapeString(email)
	site = html.EscapeString(site)
	font := "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif"

	return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>欢迎加入漫蛙</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f4f7;">
<!-- 外层灰底：邮件客户端宽度不支持 max-width 时也能居中收窄 -->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f2f4f7;">
  <tr>
    <td align="center" style="padding:32px 12px;">
      <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:100%;background-color:#ffffff;border-radius:16px;border:1px solid #e9ecf1;">
        <!-- 顶部品牌色条：留一个纯色兜底，渐变不支持的客户端不会变成空白 -->
        <tr>
          <td height="4" style="height:4px;line-height:4px;font-size:0;background-color:#22d3ee;background-image:linear-gradient(90deg,#22d3ee,#7c3aed);border-radius:16px 16px 0 0;">&nbsp;</td>
        </tr>
        <tr>
          <td style="padding:32px 32px 0;font-family:` + font + `;">
            <img src="` + site + `/favicon-192x192.png" width="44" height="44" alt="漫蛙" style="display:block;width:44px;height:44px;border:0;border-radius:12px;">
            <h1 style="margin:20px 0 0;font-size:22px;line-height:1.45;color:#111827;font-weight:700;">欢迎加入漫蛙 🎉</h1>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.75;color:#374151;">` + greeting + `</p>
            <p style="margin:10px 0 0;font-size:15px;line-height:1.75;color:#374151;">
              你的账号 <span style="color:#111827;font-weight:600;">` + email + `</span> 已注册成功。
            </p>
            <p style="margin:14px 0 0;font-size:15px;line-height:1.75;color:#374151;">
              漫蛙是一个「AI 视频创作工作台」—— 从一句创意出发，把故事、分镜、画面一路做到成片。
            </p>
            <!-- 产品介绍：能力名取自站内真实功能（模型库分类 + 工作流节点 + 预演页），
                 不编造功能。每行「粗体能力名 + 全角空格 + 一句说明」，纯 <br> 排版，
                 不用 flex/grid —— 邮件客户端只认这种最土也最稳的写法 -->
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;background-color:#f7f9fb;border:1px solid #edf0f4;border-radius:12px;">
              <tr>
                <td style="padding:18px 20px;font-family:` + font + `;font-size:13px;line-height:2;color:#4b5563;">
                  <span style="color:#111827;font-weight:600;">脚本解析 · 分镜拆解</span>　一句创意，自动拆成分镜脚本<br>
                  <span style="color:#111827;font-weight:600;">AI 生图 · AI 生视频</span>　主流模型随手切换，画面即刻出片<br>
                  <span style="color:#111827;font-weight:600;">TTS 语音合成</span>　配音、旁白直接生成<br>
                  <span style="color:#111827;font-weight:600;">3D 预演 · 节点工作流</span>　角色镜头先排练，再用工作流串成片
                </td>
              </tr>
            </table>
            <!-- 主按钮：table 包一层，Outlook 里也点得动 -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
              <tr>
                <td align="center" bgcolor="#0891b2" style="border-radius:12px;">
                  <a href="` + site + `" target="_blank" style="display:inline-block;padding:14px 30px;font-family:` + font + `;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">立即进入漫蛙 →</a>
                </td>
              </tr>
            </table>
            <p style="margin:16px 0 0;font-size:12px;line-height:1.7;color:#9ca3af;">
              按钮点不动的话，把下面这个地址复制到浏览器打开：<br>
              <a href="` + site + `" target="_blank" style="color:#0891b2;text-decoration:none;word-break:break-all;">` + site + `</a><br>
              想先看看别人怎么做，可以逛逛 <a href="` + site + `/forum" target="_blank" style="color:#0891b2;text-decoration:none;">漫蛙社区</a>。
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
