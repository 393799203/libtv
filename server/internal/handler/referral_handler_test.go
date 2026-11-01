package handler

import (
	"context"
	"github.com/gin-gonic/gin"
	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/service"
	"net/http"
	"net/http/httptest"
	"testing"
)

type referralRoleRepo struct {
	repository.UserRepo
	role string
}

func (r referralRoleRepo) FindByID(context.Context, string) (*model.User, error) {
	return &model.User{Role: r.role}, nil
}
func TestReferralDashboardRequiresAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	svc := service.NewUserService(referralRoleRepo{role: "user"}, nil, nil)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", "user") })
	// A nil handler proves that rejected requests never reach statistics.
	h := NewReferralHandler(nil)
	r.GET("/admin/referrals", middleware.RequireAdmin(svc), h.Dashboard)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/admin/referrals", nil))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403: %d", rec.Code)
	}
}
func TestReferralAttributionHiddenFromAuthorSelectors(t *testing.T) {
	code, parent := "1234567890ABCDEF", "parent"
	for _, role := range []string{"user", "admin"} {
		svc := service.NewUserService(referralRoleRepo{role: role}, nil, nil)
		h := NewUserHandler(svc, nil)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		c.Request = httptest.NewRequest(http.MethodGet, "/users", nil)
		c.Set("user_id", "viewer")
		items := []service.UserListItem{{User: model.User{ReferralCode: &code, InviterID: &parent}, InviterEmail: "parent@example.invalid"}}
		h.protectReferralMetadata(c, items)
		if role == "user" && (items[0].ReferralCode != nil || items[0].InviterEmail != "") {
			t.Fatal("attribution leaked")
		}
		if role == "admin" && items[0].InviterEmail == "" {
			t.Fatal("admin attribution was removed")
		}
	}
}
