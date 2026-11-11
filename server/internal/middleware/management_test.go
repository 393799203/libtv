package middleware

import (
	"context"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

type managementRole struct{ role string }

func (r managementRole) GetUserRole(context.Context, string) (string, error) { return r.role, nil }

func TestManagementRoutesRequireAdministrator(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := []struct {
		method, pattern, path string
		privileged            bool
	}{
		{"GET", "/api/users", "/api/users", true},
		{"GET", "/api/admin/banners", "/api/admin/banners", true},
		{"GET", "/api/admin/referrals", "/api/admin/referrals", true},
		{"GET", "/api/channel/policy", "/api/channel/policy", true},
		{"POST", "/api/storage/sync", "/api/storage/sync", true},
		{"POST", "/api/storage/sync-volume", "/api/storage/sync-volume", true},
		{"POST", "/api/banners", "/api/banners", true},
		{"PUT", "/api/banners/:id", "/api/banners/example", true},
		{"DELETE", "/api/banners/:id", "/api/banners/example", true},
		{"POST", "/api/styles", "/api/styles", true},
		{"PUT", "/api/styles/:id", "/api/styles/example", true},
		{"POST", "/api/styles/:id/image", "/api/styles/example/image", true},
		{"POST", "/api/styles/categories", "/api/styles/categories", true},
		{"DELETE", "/api/styles/categories/:id", "/api/styles/categories/example", true},
		{"POST", "/api/shows/categories", "/api/shows/categories", true},
		{"GET", "/api/shows/pending", "/api/shows/pending", true},
		{"PUT", "/api/shows/:id/approve", "/api/shows/example/approve", true},
		{"PUT", "/api/shows/:id/reject", "/api/shows/example/reject", true},
		{"DELETE", "/api/shows/:id", "/api/shows/example", true},
		{"PUT", "/api/pricing", "/api/pricing", true},
		{"GET", "/api/styles", "/api/styles", false},
		{"GET", "/api/styles/categories", "/api/styles/categories", false},
		{"POST", "/api/styles/:id/favorite", "/api/styles/example/favorite", false},
		{"POST", "/api/styles/favorites/check", "/api/styles/favorites/check", false},
		{"GET", "/api/pricing", "/api/pricing", false},
		{"GET", "/api/projects", "/api/projects", false},
		{"GET", "/api/auth/referral", "/api/auth/referral", false},
		{"POST", "/api/shows", "/api/shows", false}, // Ownership enforced by ShowHandler.
		{"PUT", "/api/shows/:id", "/api/shows/example", false},
	}
	for _, tc := range cases {
		for _, role := range []string{"user", "admin"} {
			t.Run(tc.method+tc.path+role, func(t *testing.T) {
				r := gin.New()
				r.Use(func(c *gin.Context) { c.Set("user_id", "viewer") }, ManagementAccess(managementRole{role}))
				r.Handle(tc.method, tc.pattern, func(c *gin.Context) { c.Status(204) })
				w := httptest.NewRecorder()
				r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
				want := 204
				if role != "admin" && tc.privileged {
					want = 403
				}
				if w.Code != want {
					t.Fatalf("status=%d want=%d", w.Code, want)
				}
			})
		}
	}
}
