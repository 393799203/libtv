package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"libtv/internal/model"

	"github.com/gin-gonic/gin"
)

type ownerLookupStub struct {
	project *model.Project
	err     error
	calls   int
}

func (s *ownerLookupStub) FindByID(context.Context, string) (*model.Project, error) {
	s.calls++
	return s.project, s.err
}

func TestRequireProjectOwner(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, tc := range []struct {
		name, user, method, path string
		project                  *model.Project
		err                      error
		want, lookups            int
	}{
		{"owner canvas", "owner", "GET", "/projects/p/canvas", &model.Project{UserID: "owner"}, nil, 200, 1},
		{"another account canvas", "other", "GET", "/projects/p/canvas", &model.Project{UserID: "owner"}, nil, 404, 1},
		{"another account project", "other", "GET", "/projects/p", &model.Project{UserID: "owner"}, nil, 404, 1},
		{"another account save", "other", "PUT", "/projects/p/canvas", &model.Project{UserID: "owner"}, nil, 404, 1},
		{"another account delete", "other", "DELETE", "/projects/p", &model.Project{UserID: "owner"}, nil, 404, 1},
		{"workflow blocked before billing", "other", "POST", "/projects/p/workflows/execute", &model.Project{UserID: "owner"}, nil, 404, 1},
		{"anonymous", "", "GET", "/projects/p/canvas", &model.Project{UserID: "owner"}, nil, 401, 0},
		{"lookup failure", "owner", "GET", "/projects/p/canvas", nil, errors.New("offline"), 404, 1},
		{"missing", "owner", "GET", "/projects/p/canvas", nil, nil, 404, 1},
		{"list", "owner", "GET", "/projects", nil, nil, 200, 0},
		{"create", "owner", "POST", "/projects", nil, nil, 200, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			lookup := &ownerLookupStub{project: tc.project, err: tc.err}
			r := gin.New()
			r.Use(func(c *gin.Context) {
				c.Set("user_id", tc.user)
				c.Set("role", "admin") // Even another administrator does not own a private project.
			})
			g := r.Group("/projects", RequireProjectOwner(lookup))
			ran := false
			end := func(c *gin.Context) { ran = true; c.Status(http.StatusOK) }
			g.GET("", end)
			g.POST("", end)
			g.GET("/:id", end)
			g.DELETE("/:id", end)
			g.GET("/:id/canvas", end)
			g.PUT("/:id/canvas", end)
			g.POST("/:id/workflows/execute", end)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
			if w.Code != tc.want || ran != (tc.want == 200) || lookup.calls != tc.lookups {
				t.Fatalf("status=%d ran=%v lookups=%d; want status=%d lookups=%d",
					w.Code, ran, lookup.calls, tc.want, tc.lookups)
			}
		})
	}
}
