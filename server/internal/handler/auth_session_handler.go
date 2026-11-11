package handler

import (
	"net/http"
	"strings"
	"time"

	"libtv/internal/config"
	"libtv/internal/model"
	"libtv/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

const sessionCookieName = "libtv_session"

func setSessionCookie(c *gin.Context, raw string, session *model.AuthSession) {
	domain := strings.TrimPrefix(config.C.JWT.CookieDomain, ".")
	host := strings.Split(c.Request.Host, ":")[0]
	if domain == "" || (host != domain && !strings.HasSuffix(host, "."+domain)) {
		domain = ""
	}
	cookie := &http.Cookie{
		Name: sessionCookieName, Value: raw, Path: "/api/auth", Domain: domain,
		HttpOnly: true, Secure: c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https",
		SameSite: http.SameSiteLaxMode,
	}
	if session == nil {
		cookie.MaxAge = -1
		cookie.Expires = time.Unix(1, 0)
	} else if session.RememberMe {
		cookie.Expires = session.ExpiresAt
		cookie.MaxAge = int(time.Until(session.ExpiresAt).Seconds())
	}
	http.SetCookie(c.Writer, cookie)
	c.Header("Cache-Control", "no-store")
}

func (h *UserHandler) Logout(c *gin.Context) {
	raw, _ := c.Cookie(sessionCookieName)
	if err := h.userService.EndSession(c.Request.Context(), raw); err != nil {
		response.FailWith(c, err)
		return
	}
	setSessionCookie(c, "", nil)
	response.OK(c, nil)
}

func (h *UserHandler) SendRegistrationCode(c *gin.Context) {
	var req struct {
		Email string `json:"email" binding:"required,email"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请输入有效的邮箱地址")
		return
	}
	if err := h.userService.SendRegistrationCode(c.Request.Context(), req.Email); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"retry_after": 60, "expires_in": 600})
}
