package mail

import "fmt"

func (s *Sender) SendRegistrationCode(to, code string, minutes int) error {
	text := fmt.Sprintf("你的漫蛙注册验证码是：%s\n验证码在 %d 分钟内有效，请勿向他人透露。如非本人操作，请忽略此邮件。", code, minutes)
	html := fmt.Sprintf("<p>你的漫蛙注册验证码是：</p><p><strong>%s</strong></p><p>验证码在 %d 分钟内有效，请勿向他人透露。如非本人操作，请忽略此邮件。</p>", code, minutes)
	return s.Send(to, "漫蛙注册验证码", text, html)
}
