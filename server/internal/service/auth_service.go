package service

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"libtv/internal/config"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

var (
	ErrInvalidCredentials = apperror.New(2101, http.StatusUnauthorized, "邮箱或密码错误")
	ErrSessionExpired     = apperror.New(2102, http.StatusUnauthorized, "登录已失效，请重新登录")
	ErrSessionReplaced    = apperror.New(2111, http.StatusUnauthorized, "该账号已在其他地方登录，请重新登录")
	ErrEmailRegistered    = apperror.New(2103, http.StatusConflict, "该邮箱已注册，请直接登录")
	ErrInvalidEmail       = apperror.New(2104, http.StatusBadRequest, "请输入有效的邮箱地址")
	ErrPasswordPolicy     = apperror.New(2105, http.StatusBadRequest, "密码需至少 8 个字符，且不能超过 72 字节")
	ErrInvalidCode        = apperror.New(2106, http.StatusBadRequest, "验证码错误、已过期或尝试次数过多，请重新获取")
	ErrCodeCooldown       = apperror.New(2107, http.StatusTooManyRequests, "验证码发送过于频繁，请 60 秒后再试")
	ErrVerificationMail   = apperror.New(2108, http.StatusServiceUnavailable, "注册验证邮件暂时无法发送，请稍后重试")
)

const AccessTokenTTL = 15 * time.Minute

// A valid cost-10 bcrypt hash prevents a fast "email exists" timing oracle.
const dummyPasswordHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

type RegistrationMailer interface {
	Enabled() bool
	SendRegistrationCode(email, code string, minutes int) error
}

func ValidatePassword(password string) error {
	if !utf8.ValidString(password) || utf8.RuneCountInString(password) < 8 || len(password) > 72 {
		return ErrPasswordPolicy
	}
	return nil
}

// Preserve the local-part's case for compatibility with existing case-sensitive
// accounts. Domain names are case-insensitive.
func NormalizeEmail(email string) (string, error) {
	email = strings.TrimSpace(email)
	addr, err := mail.ParseAddress(email)
	if err != nil || addr.Address != email || len(email) > 255 || !strings.Contains(email, "@") {
		return "", ErrInvalidEmail
	}
	at := strings.LastIndex(email, "@")
	return email[:at] + "@" + strings.ToLower(email[at+1:]), nil
}

func (s *UserService) SetAuthRepository(repo repository.AuthRepo) { s.authRepo = repo }

func (s *UserService) StartAuthMaintenance(ctx context.Context) {
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for {
			cleanupCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
			err := s.authRepo.DeleteExpired(cleanupCtx)
			cancel()
			if err != nil && ctx.Err() == nil {
				log.Printf("[Auth] 清理过期会话与验证码失败: %v", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (s *UserService) CheckAuthRate(ctx context.Context, scope, id string, limit int, window time.Duration) error {
	if s.authRepo == nil {
		return errors.New("auth repository unavailable")
	}
	ok, err := s.authRepo.AllowAttempt(ctx, hashResetToken(scope+"\x00"+id), limit, window)
	if err != nil {
		return err
	}
	if !ok {
		return apperror.New(2110, http.StatusTooManyRequests, "操作过于频繁，请稍后再试")
	}
	return nil
}

func (s *UserService) CheckLoginRate(ctx context.Context, email string) error {
	return s.CheckAuthRate(ctx, "login:email", strings.ToLower(strings.TrimSpace(email)), 10, 15*time.Minute)
}

type SessionResult struct {
	Token        string             `json:"token"`
	User         *model.User        `json:"user"`
	ExpiresAt    time.Time          `json:"expires_at"`
	SessionUntil time.Time          `json:"session_expires_at"`
	Session      *model.AuthSession `json:"-"`
	RefreshToken string             `json:"-"`
}

func (s *UserService) StartSession(ctx context.Context, email, password string, remember bool) (*SessionResult, error) {
	user, err := s.authenticate(ctx, email, password)
	if err != nil {
		return nil, err
	}
	if s.authRepo == nil {
		return nil, errors.New("auth repository unavailable")
	}
	raw, err := newResetToken()
	if err != nil {
		return nil, err
	}
	ttl := 24 * time.Hour
	if remember {
		ttl = 30 * 24 * time.Hour
	}
	session := &model.AuthSession{
		ID: uuid.NewString(), UserID: user.ID, RefreshHash: hashResetToken(raw),
		PasswordVersion: user.PasswordVersion, RememberMe: remember,
		ExpiresAt: time.Now().Add(ttl),
	}
	if err := s.authRepo.CreateSession(ctx, session); err != nil {
		return nil, err
	}
	result, err := s.sessionResult(user, session)
	if err != nil {
		return nil, err
	}
	result.RefreshToken = raw
	return result, nil
}

func (s *UserService) sessionResult(user *model.User, session *model.AuthSession) (*SessionResult, error) {
	now := time.Now()
	exp := now.Add(AccessTokenTTL)
	if session.ExpiresAt.Before(exp) {
		exp = session.ExpiresAt
	}
	claims := jwt.MapClaims{
		"user_id": user.ID, "email": user.Email, "pwd_ver": session.PasswordVersion,
		"sid": session.ID, "iat": now.Unix(), "exp": exp.Unix(), "iss": "libtv",
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(config.C.JWT.Secret))
	if err != nil {
		return nil, err
	}
	return &SessionResult{Token: token, User: user, ExpiresAt: exp, SessionUntil: session.ExpiresAt, Session: session}, nil
}

func (s *UserService) RefreshSession(ctx context.Context, raw string) (*SessionResult, error) {
	if s.authRepo == nil || len(raw) != 64 {
		return nil, ErrSessionExpired
	}
	session, err := s.authRepo.FindRefreshSession(ctx, hashResetToken(raw))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSessionExpired
	}
	if err != nil {
		return nil, err
	}
	if session.RevokedAt != nil {
		if session.RevokedReason == "replaced" {
			return nil, ErrSessionReplaced
		}
		return nil, ErrSessionExpired
	}
	user, err := s.userRepo.FindByID(ctx, session.UserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrSessionExpired
	}
	if err != nil {
		return nil, err
	}
	if user.PasswordVersion != session.PasswordVersion {
		return nil, ErrSessionExpired
	}
	return s.sessionResult(user, session)
}

func (s *UserService) EndSession(ctx context.Context, raw string) error {
	if s.authRepo == nil || len(raw) != 64 {
		return nil
	}
	session, err := s.authRepo.FindRefreshSession(ctx, hashResetToken(raw))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	return s.authRepo.RevokeSession(ctx, session.ID)
}

func codeDigest(email, code string) string {
	h := hmac.New(sha256.New, []byte(config.C.JWT.Secret))
	h.Write([]byte("register\x00" + email + "\x00" + code))
	return hex.EncodeToString(h.Sum(nil))
}

func (s *UserService) SendRegistrationCode(ctx context.Context, email string) error {
	email, err := NormalizeEmail(email)
	if err != nil {
		return err
	}
	user, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	if user != nil {
		return ErrEmailRegistered
	}
	mailer, ok := s.mailer.(RegistrationMailer)
	if !ok || !mailer.Enabled() || s.authRepo == nil {
		return ErrVerificationMail
	}
	n, err := rand.Int(rand.Reader, big.NewInt(1000000))
	if err != nil {
		return err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	record := &model.RegistrationCode{
		Email: email, CodeHash: codeDigest(email, code), ExpiresAt: time.Now().Add(10 * time.Minute), CreatedAt: time.Now(),
	}
	saved, err := s.authRepo.SaveCode(ctx, record)
	if err != nil {
		return err
	}
	if !saved {
		return ErrCodeCooldown
	}
	// Confirm SMTP accepted the message before reporting success.
	if err := mailer.SendRegistrationCode(email, code, 10); err != nil {
		_ = s.authRepo.DeleteCode(ctx, email, record.CodeHash)
		return ErrVerificationMail
	}
	return nil
}

func (s *UserService) RegisterVerified(ctx context.Context, email, password, nickname, channel, referral, code string) (*model.User, error) {
	email, err := NormalizeEmail(email)
	if err != nil {
		return nil, err
	}
	if err := ValidatePassword(password); err != nil {
		return nil, err
	}
	if s.authRepo == nil || len(code) != 6 || strings.Trim(code, "0123456789") != "" {
		return nil, ErrInvalidCode
	}
	if utf8.RuneCountInString(strings.TrimSpace(nickname)) < 1 || utf8.RuneCountInString(strings.TrimSpace(nickname)) > 50 {
		return nil, apperror.New(2109, http.StatusBadRequest, "昵称需为 1 至 50 个字符")
	}
	// Validate invitation before consuming the code, so a typo is recoverable.
	if strings.TrimSpace(referral) != "" && s.referrals != nil {
		if _, err := s.referrals.ResolveInviter(ctx, referral); err != nil {
			return nil, err
		}
	}
	valid, err := s.authRepo.ConsumeCode(ctx, email, codeDigest(email, code))
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, ErrInvalidCode
	}
	return s.RegisterWithChannel(ctx, email, password, nickname, channel, referral)
}
