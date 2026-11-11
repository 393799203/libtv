package service

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"libtv/internal/cache"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const (
	// PasswordResetTTL 重置链接有效期。取 30 分钟：够用户去邮箱翻信、点进来改完，
	// 又不至于让一封被转发或泄露的邮件长期可用。
	PasswordResetTTL = 30 * time.Minute

	// 限流阈值：同一邮箱每分钟最多 3 封（防对某个用户轰炸邮箱），
	// 同一 IP 每分钟最多 10 次（防脚本批量扫邮箱）。
	passwordResetPerEmailPerMinute = 3
	passwordResetPerIPPerMinute    = 10
)

// 找回密码相关业务错误
var (
	// ErrResetTokenInvalid 令牌不存在 / 已用过 / 已过期。
	// 三种情况合并成同一句提示——分开就等于告诉攻击者「这个令牌曾经存在过」
	ErrResetTokenInvalid = apperror.New(2006, http.StatusBadRequest, "重置链接无效或已过期，请重新获取")
	ErrResetTooFrequent  = apperror.New(2007, http.StatusTooManyRequests, "操作过于频繁，请稍后再试")
	ErrResetMailFailed   = apperror.New(2008, http.StatusServiceUnavailable, "重置邮件发送失败，请稍后重试")
	ErrResetPwdTooShort  = ErrPasswordPolicy // Compatibility name; all password entry points share one policy.
	// ErrResetEmailNotFound 邮箱未注册。原实现对此静默返回成功（防枚举），
	// 现改为明确提示，取舍理由见 RequestReset 内 gorm.ErrRecordNotFound 分支的注释。
	ErrResetEmailNotFound = apperror.New(2010, http.StatusNotFound, "该邮箱未注册，请检查是否输错，或先去注册")
)

// PasswordResetMailer 重置邮件的发送方（*mail.Sender 实现）。
// 与 WelcomeMailer 同样抽成接口：service 层不必知道 SMTP 细节，未配邮件时可传 nil。
type PasswordResetMailer interface {
	Enabled() bool
	SendPasswordReset(to, nickname, token string, expireMinutes int) error
}

// PasswordResetService 「忘记密码」流程：签发一次性令牌并邮寄，再凭令牌改密。
type PasswordResetService struct {
	userRepo  repository.UserRepo
	resetRepo repository.PasswordResetRepo
	mailer    PasswordResetMailer
}

func NewPasswordResetService(userRepo repository.UserRepo, resetRepo repository.PasswordResetRepo, mailer PasswordResetMailer) *PasswordResetService {
	return &PasswordResetService{userRepo: userRepo, resetRepo: resetRepo, mailer: mailer}
}

// RequestReset 处理「忘记密码」请求：给该邮箱发一封带重置链接的邮件。
//
// 邮箱未注册时返回 ErrResetEmailNotFound（明确提示），不再静默成功；
// 取舍理由见函数内 gorm.ErrRecordNotFound 分支的注释。
func (s *PasswordResetService) RequestReset(ctx context.Context, email, clientIP string) error {
	email = strings.TrimSpace(email)
	if email == "" {
		return nil
	}
	// 邮箱维度用小写做限流 key，避免攻击者靠大小写变形绕过（查库仍用原文，见下）
	lower := strings.ToLower(email)
	if !s.allow(ctx, "email", lower, passwordResetPerEmailPerMinute) ||
		!s.allow(ctx, "ip", clientIP, passwordResetPerIPPerMinute) {
		return ErrResetTooFrequent
	}

	// 与登录同一套查找规则（精确保存、精确匹配）：能用哪个邮箱登录，就能用哪个邮箱找回。
	// 这里刻意不做大小写不敏感兜底——注册时邮箱原样入库，A@x.com 与 a@x.com 可能是
	// 两个不同账号，模糊匹配会认错人。
	user, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// 未注册就如实报错（2026-10-27 决策变更，原为「静默返回成功」防枚举）。
			//
			// 防枚举的初衷没错，但它在这里并没有真正生效：注册接口
			// /api/auth/register 对已注册邮箱直接返回 "email already registered"，
			// 任何人无需验证码就能把邮箱是否注册问出来。于是静默只剩代价——用户把邮箱
			// 打错一位（线上真实发生过：2484494687@qq.com vs 24844946872@qq.com），
			// 界面照样显示「已发送」，然后永远收不到信，也不知道错在哪一步。
			// 改为明确提示后，用户能立刻自查拼写或去注册。
			log.Printf("[Reset] 未注册邮箱的找回请求 email=%s", email)
			return ErrResetEmailNotFound
		}
		return err
	}

	// 邮件总开关放在「确认邮箱存在」之后判断：优先给出「该邮箱未注册」这个准确答案，
	// 而不是让全局邮件故障把它盖成含义完全不同的「发送失败」。
	if s.mailer == nil || !s.mailer.Enabled() {
		return ErrResetMailFailed
	}

	token, err := newResetToken()
	if err != nil {
		return err
	}

	// 先作废该用户此前的全部令牌：反复点「忘记密码」时只有最新一封邮件的链接有效，
	// 免得用户手上几封旧邮件的链接同时都能改密
	if err := s.resetRepo.DeleteByUserID(ctx, user.ID); err != nil {
		return err
	}
	// 顺带清理已过期记录，表不会无限增长（失败不影响主流程，只记日志）
	if err := s.resetRepo.DeleteExpired(ctx); err != nil {
		log.Printf("[Reset] 清理过期令牌失败: %v", err)
	}

	record := &model.PasswordResetToken{
		UserID:    user.ID,
		TokenHash: hashResetToken(token),
		ExpiresAt: time.Now().Add(PasswordResetTTL),
	}
	if err := s.resetRepo.Create(ctx, record); err != nil {
		return err
	}

	// 异步发信：不让用户干等 SMTP 握手（常有秒级延迟）。
	// 注：原实现还有第二个理由——抹平「邮箱存在 / 不存在」两条路径的耗时差以防枚举；
	// 未注册现在会明确报错，这个理由已不成立。
	s.sendResetAsync(user.Email, user.Nickname, token)
	return nil
}

// ResetPassword 凭令牌设置新密码。成功后该账号所有旧登录态立即失效。
func (s *PasswordResetService) ResetPassword(ctx context.Context, token, newPassword string) error {
	if err := ValidatePassword(newPassword); err != nil {
		return err
	}
	token = strings.TrimSpace(token)
	if token == "" {
		return ErrResetTokenInvalid
	}

	record, err := s.resetRepo.FindValidByHash(ctx, hashResetToken(token))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrResetTokenInvalid
		}
		return err
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	// 先抢占令牌、再改密码：并发下同一个链接只有一个请求能抢到，
	// 避免两个请求拿着同一链接改出两个不同密码（后者覆盖前者，用户莫名其妙登不上）
	ok, err := s.resetRepo.Consume(ctx, record.ID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrResetTokenInvalid
	}

	// 复用既有实现：写新哈希的同时把 password_version +1，
	// 使该账号在其它设备上的旧 token 全部失效
	return s.userRepo.UpdatePasswordHash(ctx, record.UserID, string(hash))
}

// sendResetAsync 异步发送重置邮件（未配 SMTP 时静默跳过）。
// 单独 recover：邮件库里的任何意外都不该把整个进程带崩。
func (s *PasswordResetService) sendResetAsync(email, nickname, token string) {
	if s.mailer == nil || !s.mailer.Enabled() {
		return
	}
	minutes := int(PasswordResetTTL.Minutes())
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[Reset] ⚠️ 重置邮件发送异常 to=%s: %v", email, r)
			}
		}()
		if err := s.mailer.SendPasswordReset(email, nickname, token, minutes); err != nil {
			log.Printf("[Reset] ⚠️ 重置邮件发送失败 to=%s: %v", email, err)
			return
		}
		log.Printf("[Reset] ✅ 重置邮件已发送 to=%s", email)
	}()
}

// allow 按「用途:维度」做每分钟限流；Redis 不可用时放行（限流属增强能力，不阻断主流程）
func (s *PasswordResetService) allow(ctx context.Context, scope, id string, perMinute int) bool {
	if id == "" {
		return true
	}
	ok, _, err := cache.AllowRateScoped(ctx, "reset:"+scope, id, perMinute)
	if err != nil && !errors.Is(err, cache.ErrUnavailable) {
		log.Printf("[Reset] 限流检查失败，放行 scope=%s id=%s: %v", scope, id, err)
	}
	return ok
}

// newResetToken 生成 32 字节（256 位）随机令牌，hex 编码后 64 字符。
// 用 crypto/rand 而非 math/rand：令牌一旦可预测，任何人都能重置别人的密码。
func newResetToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// hashResetToken 令牌入库前的单向哈希（hex 的 SHA-256，64 字符）。
// 令牌本身是 256 位随机数，无法被枚举，因此不需要加盐或 bcrypt。
func hashResetToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
