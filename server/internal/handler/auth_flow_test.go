package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"libtv/internal/config"
	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type verificationMailer struct {
	code string
}

func (m *verificationMailer) Enabled() bool                    { return true }
func (m *verificationMailer) SendWelcome(string, string) error { return nil }
func (m *verificationMailer) SendRegistrationCode(_ string, code string, _ int) error {
	m.code = code
	return nil
}

func authFixture(t *testing.T) (*gorm.DB, *service.UserService, *verificationMailer, *gin.Engine) {
	t.Helper()
	dsn := os.Getenv("AUTH_TEST_DSN")
	if dsn == "" {
		dsn = "host=localhost user=libtv password=libtv123 dbname=libtv port=5432 sslmode=disable"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skipf("local Postgres unavailable: %v", err)
	}
	conn, _ := db.DB()
	conn.SetMaxOpenConns(8)
	schema := fmt.Sprintf("auth_test_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	// Each pooled connection must use the isolated schema, including concurrent logins.
	conn.Close()
	db, err = gorm.Open(postgres.Open(dsn+" search_path="+schema), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	conn, _ = db.DB()
	t.Cleanup(func() { db.Exec("DROP SCHEMA " + schema + " CASCADE"); conn.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AuthSession{}, &model.RegistrationCode{}, &model.AuthRateBucket{}, &model.PasswordResetToken{}); err != nil {
		t.Fatal(err)
	}
	oldConfig := config.C
	config.C.JWT.Secret = strings.Repeat("test-secret-", 4)
	config.C.JWT.CookieDomain = "example.test"
	t.Cleanup(func() { config.C = oldConfig })
	mailer := &verificationMailer{}
	users := service.NewUserService(repository.NewUserRepo(db), nil, mailer)
	users.SetAuthRepository(repository.NewAuthRepo(db))
	h := NewUserHandler(users, nil)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.POST("/api/auth/register-code", h.SendRegistrationCode)
	r.POST("/api/auth/register", h.Register)
	r.POST("/api/auth/login", h.Login)
	r.POST("/api/auth/refresh", middleware.AuthCookieGuard(), h.Refresh)
	r.POST("/api/auth/logout", middleware.AuthCookieGuard(), h.Logout)
	r.GET("/api/auth/me", middleware.Auth(users, nil), h.Me)
	r.PUT("/api/auth/password", middleware.Auth(users, nil), h.ChangePassword)
	r.PUT("/api/users/:id/role", middleware.Auth(users, nil), middleware.RequireAdmin(users), h.UpdateRole)
	r.DELETE("/api/users/:id", middleware.Auth(users, nil), middleware.RequireAdmin(users), h.Delete)
	return db, users, mailer, r
}

func authRequest(r *gin.Engine, method, path string, body any, token string, cookie *http.Cookie) *httptest.ResponseRecorder {
	data, _ := json.Marshal(body)
	req := httptest.NewRequest(method, "https://app.example.test"+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Requested-With", "libtv")
	req.Header.Set("Origin", "https://app.example.test")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cookie != nil {
		req.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func decodeSession(t *testing.T, w *httptest.ResponseRecorder) (service.SessionResult, *http.Cookie) {
	t.Helper()
	if w.Code != 200 && w.Code != 201 {
		t.Fatalf("status=%d body=%s", w.Code, w.Body)
	}
	var envelope struct {
		Data service.SessionResult `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	var cookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == sessionCookieName {
			cookie = c
		}
	}
	if envelope.Data.Token == "" {
		t.Fatalf("missing access token: %s", w.Body)
	}
	return envelope.Data, cookie
}

func TestAuthRegistrationSessionsAndSingleLogin(t *testing.T) {
	db, users, mailer, r := authFixture(t)
	const email, password = "creator@example.test", "correct horse battery staple"
	registration := map[string]any{"email": email, "password": password, "nickname": "创作者", "code": "000000"}
	registration["role"] = "admin" // Registration must never accept a client-chosen role.
	if w := authRequest(r, "POST", "/api/auth/register", registration, "", nil); w.Code != 400 {
		t.Fatalf("registration without verification accepted: %s", w.Body)
	}
	if w := authRequest(r, "POST", "/api/auth/register-code", map[string]string{"email": email}, "", nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	code := mailer.code
	if len(code) != 6 {
		t.Fatal("mail did not contain code")
	}
	var record model.RegistrationCode
	db.First(&record)
	if record.CodeHash == code || len(record.CodeHash) != 64 {
		t.Fatal("plaintext code persisted")
	}
	if w := authRequest(r, "POST", "/api/auth/register-code", map[string]string{"email": email}, "", nil); w.Code != 429 {
		t.Fatal("resend cooldown missing")
	}
	registration["code"] = code
	first, firstCookie := decodeSession(t, authRequest(r, "POST", "/api/auth/register", registration, "", nil))
	if first.User.Role != "user" {
		t.Fatal("registration granted a privileged role")
	}
	if firstCookie == nil || !firstCookie.HttpOnly || !firstCookie.Secure || firstCookie.Domain != "example.test" ||
		firstCookie.SameSite != http.SameSiteLaxMode || firstCookie.Path != "/api/auth" || firstCookie.MaxAge != 0 {
		t.Fatalf("unsafe non-remembered cookie: %+v", firstCookie)
	}
	if strings.Contains(first.Token, firstCookie.Value) {
		t.Fatal("refresh token leaked in access token")
	}
	if remaining := time.Until(first.ExpiresAt); remaining > 15*time.Minute || remaining < 14*time.Minute {
		t.Fatalf("wrong access lifetime: %s", remaining)
	}
	if remaining := time.Until(first.SessionUntil); remaining > 24*time.Hour || remaining < 23*time.Hour {
		t.Fatalf("wrong default lifetime: %s", remaining)
	}
	renewed, _ := decodeSession(t, authRequest(r, "POST", "/api/auth/refresh", nil, "", firstCookie))
	if delta := renewed.SessionUntil.Sub(first.SessionUntil); delta < -time.Microsecond || delta > time.Microsecond {
		t.Fatal("refresh extended absolute deadline")
	}
	login := map[string]any{"email": email, "password": password, "remember_me": true}
	second, secondCookie := decodeSession(t, authRequest(r, "POST", "/api/auth/login", login, "", nil))
	if secondCookie.MaxAge < 29*24*60*60 || time.Until(second.SessionUntil) > 30*24*time.Hour {
		t.Fatal("remember-me duration is incorrect")
	}
	if w := authRequest(r, "GET", "/api/auth/me", nil, first.Token, nil); w.Code != 401 {
		t.Fatal("previous device access remained valid")
	}
	if w := authRequest(r, "POST", "/api/auth/refresh", nil, "", firstCookie); w.Code != 401 || !strings.Contains(w.Body.String(), "其他地方登录") {
		t.Fatalf("previous device refresh remained valid: %s", w.Body)
	}
	// Logging out from a displaced device must not revoke the new device.
	authRequest(r, "POST", "/api/auth/logout", nil, "", firstCookie)
	if w := authRequest(r, "GET", "/api/auth/me", nil, second.Token, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := authRequest(r, "POST", "/api/auth/logout", nil, "", secondCookie); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := authRequest(r, "GET", "/api/auth/me", nil, second.Token, nil); w.Code != 401 {
		t.Fatal("logout did not revoke access")
	}
	if w := authRequest(r, "POST", "/api/auth/refresh", nil, "", secondCookie); w.Code != 401 {
		t.Fatal("logout did not revoke refresh")
	}

	// Simultaneous logins serialize on the user row and leave exactly one valid session.
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := users.StartSession(context.Background(), email, password, false)
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	var active int64
	db.Model(&model.AuthSession{}).Where("revoked_at IS NULL AND expires_at > ?", time.Now()).Count(&active)
	if active != 1 {
		t.Fatalf("concurrent logins left %d active sessions", active)
	}

	third, thirdCookie := decodeSession(t, authRequest(r, "POST", "/api/auth/login", login, "", nil))
	change := map[string]string{"old_password": password, "new_password": "a different strong password"}
	if w := authRequest(r, "PUT", "/api/auth/password", change, third.Token, thirdCookie); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := authRequest(r, "GET", "/api/auth/me", nil, third.Token, nil); w.Code != 401 {
		t.Fatal("password change left access valid")
	}
	if w := authRequest(r, "POST", "/api/auth/refresh", nil, "", thirdCookie); w.Code != 401 {
		t.Fatal("password change left refresh valid")
	}
}

func TestAuthCodeExpiryAttemptsAndRateLimits(t *testing.T) {
	db, users, mailer, r := authFixture(t)
	ctx := context.Background()
	email := "verify@example.test"
	if err := users.SendRegistrationCode(ctx, email); err != nil {
		t.Fatal(err)
	}
	code := mailer.code
	wrong := "000000"
	if wrong == code {
		wrong = "111111"
	}
	for i := 0; i < 5; i++ {
		if _, err := users.RegisterVerified(ctx, email, "long password", "name", "", "", wrong); err != service.ErrInvalidCode {
			t.Fatalf("wrong code accepted: %v", err)
		}
	}
	if _, err := users.RegisterVerified(ctx, email, "long password", "name", "", "", code); err != service.ErrInvalidCode {
		t.Fatal("code remained valid after five failed attempts")
	}
	db.Model(&model.RegistrationCode{}).Where("email = ?", email).Updates(map[string]any{"attempts": 0, "expires_at": time.Now().Add(-time.Second)})
	if _, err := users.RegisterVerified(ctx, email, "long password", "name", "", "", code); err != service.ErrInvalidCode {
		t.Fatal("expired code accepted")
	}
	// Limits remain effective without Redis.
	for i := 0; i < 10; i++ {
		if err := users.CheckLoginRate(ctx, email); err != nil {
			t.Fatal(err)
		}
	}
	if err := users.CheckLoginRate(ctx, strings.ToUpper(email)); err == nil {
		t.Fatal("email login limit bypassed by case")
	}
	for _, password := range []string{"1234567", strings.Repeat("中", 25)} {
		if err := service.ValidatePassword(password); err == nil {
			t.Fatal("unsafe password accepted")
		}
	}
	// A session's hard deadline overrides a still-valid access JWT.
	user, err := users.Register(ctx, "expiry@example.test", "valid password", "user")
	if err != nil {
		t.Fatal(err)
	}
	result, err := users.StartSession(ctx, user.Email, "valid password", false)
	if err != nil {
		t.Fatal(err)
	}
	db.Model(&model.AuthSession{}).Where("id = ?", result.Session.ID).Update("expires_at", time.Now().Add(-time.Second))
	if w := authRequest(r, "GET", "/api/auth/me", nil, result.Token, nil); w.Code != 401 {
		t.Fatal("expired server session accepted")
	}
	if _, err := users.RefreshSession(ctx, result.RefreshToken); err != service.ErrSessionExpired {
		t.Fatal("expired server session refreshed")
	}
}

func TestAuthRejectsMissingExpiryWrongAlgorithmAndCSRF(t *testing.T) {
	_, users, _, r := authFixture(t)
	ctx := context.Background()
	user, err := users.Register(ctx, "jwt@example.test", "valid password", "user")
	if err != nil {
		t.Fatal(err)
	}
	session, err := users.StartSession(ctx, user.Email, "valid password", false)
	if err != nil {
		t.Fatal(err)
	}
	for _, method := range []jwt.SigningMethod{jwt.SigningMethodHS256, jwt.SigningMethodHS384} {
		claims := jwt.MapClaims{"user_id": user.ID, "pwd_ver": 0, "sid": session.Session.ID, "iss": "libtv"}
		if method == jwt.SigningMethodHS384 {
			claims["exp"] = time.Now().Add(time.Hour).Unix()
		}
		token, _ := jwt.NewWithClaims(method, claims).SignedString([]byte(config.C.JWT.Secret))
		if w := authRequest(r, "GET", "/api/auth/me", nil, token, nil); w.Code != 401 {
			t.Fatal("unsafe JWT accepted")
		}
	}
	for _, origin := range []string{"https://evil.test", "https://app.example.test"} {
		req := httptest.NewRequest("POST", "https://app.example.test/api/auth/refresh", nil)
		req.Header.Set("Origin", origin)
		if origin == "https://evil.test" {
			req.Header.Set("X-Requested-With", "libtv")
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 403 {
			t.Fatalf("CSRF request accepted: %s", origin)
		}
	}
}

func TestAuthProtectsWorkflowStreamsAndAdministrativeActions(t *testing.T) {
	db, users, _, r := authFixture(t)
	ctx := context.Background()
	if err := db.AutoMigrate(&model.Project{}, &model.WorkflowExecution{}); err != nil {
		t.Fatal(err)
	}
	owner, err := users.Register(ctx, "owner@example.test", "valid password", "owner")
	if err != nil {
		t.Fatal(err)
	}
	other, err := users.Register(ctx, "other@example.test", "valid password", "other")
	if err != nil {
		t.Fatal(err)
	}
	ownerSession, _ := users.StartSession(ctx, owner.Email, "valid password", false)
	otherSession, _ := users.StartSession(ctx, other.Email, "valid password", false)
	projects := repository.NewProjectRepo(db)
	owned := &model.Project{UserID: owner.ID, Name: "private"}
	unrelated := &model.Project{UserID: other.ID, Name: "other"}
	if err := projects.Create(ctx, owned); err != nil {
		t.Fatal(err)
	}
	if err := projects.Create(ctx, unrelated); err != nil {
		t.Fatal(err)
	}
	execs := repository.NewExecutionRepo(db)
	exec := &model.WorkflowExecution{ProjectID: owned.ID, Status: "done"}
	if err := execs.Create(ctx, exec); err != nil {
		t.Fatal(err)
	}
	h := NewWorkflowHandler(execs, nil, nil, projects, nil, nil)
	h.SetTokenChecker(users)
	r.GET("/api/projects/:id/workflows/:execId", middleware.Auth(users, nil), middleware.RequireProjectOwner(projects), h.GetExecution)
	r.GET("/api/workflow/executions/:id", middleware.Auth(users, nil), h.GetExecution)
	r.POST("/api/workflow/execute", middleware.Auth(users, nil), h.Execute)
	r.GET("/api/projects/:id/workflows/:execId/stream", func(c *gin.Context) {
		if token := c.Query("t"); token != "" {
			c.Request.Header.Set("Authorization", "Bearer "+token)
		}
	}, middleware.Auth(users, nil), middleware.RequireProjectOwner(projects), h.StreamExecution)
	path := fmt.Sprintf("/api/projects/%s/workflows/%d", owned.ID, exec.ID)
	if w := authRequest(r, "GET", path, nil, ownerSession.Token, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	if w := authRequest(r, "GET", path+"/stream?t="+ownerSession.Token, nil, "", nil); w.Code != 200 || !strings.Contains(w.Body.String(), "execution_completed") {
		t.Fatal(w.Body)
	}
	for _, path := range []string{
		fmt.Sprintf("/api/projects/%s/workflows/%d", unrelated.ID, exec.ID),
		fmt.Sprintf("/api/workflow/executions/%d", exec.ID),
		fmt.Sprintf("/api/projects/%s/workflows/%d/stream?t=%s", unrelated.ID, exec.ID, otherSession.Token),
	} {
		if w := authRequest(r, "GET", path, nil, otherSession.Token, nil); w.Code != 404 {
			t.Fatalf("private execution leaked at %s: %s", path, w.Body)
		}
	}
	if w := authRequest(r, "POST", "/api/workflow/execute", map[string]string{"projectId": owned.ID, "startNodeId": "private-node"}, otherSession.Token, nil); w.Code != 404 {
		t.Fatal("legacy execution endpoint allowed another user's project")
	}
	if w := authRequest(r, "PUT", "/api/users/"+owner.ID+"/role", map[string]string{"role": "admin"}, otherSession.Token, nil); w.Code != 403 {
		t.Fatal("ordinary user changed roles")
	}
	if w := authRequest(r, "DELETE", "/api/users/"+owner.ID, nil, otherSession.Token, nil); w.Code != 403 {
		t.Fatal("ordinary user deleted an account")
	}
	if _, err := users.StartSession(ctx, owner.Email, "valid password", false); err != nil {
		t.Fatal(err)
	}
	if w := authRequest(r, "GET", path+"/stream?t="+ownerSession.Token, nil, "", nil); w.Code != 401 {
		t.Fatal("displaced session retained SSE access")
	}
}
