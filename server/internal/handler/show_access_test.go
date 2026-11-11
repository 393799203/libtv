package handler

import (
	"context"
	"encoding/json"
	"testing"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/service"
)

func TestShowSubmissionAndPrivatePreviewPermissions(t *testing.T) {
	db, users, _, r := authFixture(t)
	ctx := context.Background()
	if err := db.AutoMigrate(&model.Project{}, &model.ShowCategory{}, &model.Show{}); err != nil {
		t.Fatal(err)
	}
	owner, _ := users.Register(ctx, "show-owner@example.test", "valid password", "owner")
	other, _ := users.Register(ctx, "show-other@example.test", "valid password", "other")
	admin, _ := users.Register(ctx, "show-admin@example.test", "valid password", "admin")
	if err := db.Model(&model.User{}).Where("id = ?", admin.ID).Update("role", "admin").Error; err != nil {
		t.Fatal(err)
	}
	ownerSession, _ := users.StartSession(ctx, owner.Email, "valid password", false)
	otherSession, _ := users.StartSession(ctx, other.Email, "valid password", false)
	adminSession, _ := users.StartSession(ctx, admin.Email, "valid password", false)
	project := &model.Project{UserID: owner.ID, Name: "private"}
	projects := repository.NewProjectRepo(db)
	if err := projects.Create(ctx, project); err != nil {
		t.Fatal(err)
	}
	repo := repository.NewShowRepo(db)
	category := &model.ShowCategory{Name: "test"}
	if err := repo.CreateCategory(ctx, category); err != nil {
		t.Fatal(err)
	}
	shows := service.NewShowService(repo, repository.NewUserRepo(db), nil, nil)
	h := NewShowHandler(shows, nil, projects, users)
	r.POST("/api/shows", middleware.Auth(users, nil), h.CreateShow)
	r.GET("/api/shows/:id", middleware.OptionalAuth(users, nil), h.GetShow)
	r.PUT("/api/shows/:id", middleware.Auth(users, nil), h.UpdateShow)
	body := map[string]any{"project_id": project.ID, "category_id": category.ID, "title": "private",
		"video_url": "", "status": "published", "author_id": admin.ID, "sort_order": 999}
	w := authRequest(r, "POST", "/api/shows", body, otherSession.Token, nil)
	if w.Code != 403 {
		t.Fatal("another user submitted a project")
	}
	w = authRequest(r, "POST", "/api/shows", body, ownerSession.Token, nil)
	if w.Code != 201 {
		t.Fatal(w.Body)
	}
	var envelope struct {
		Data model.Show `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	show := envelope.Data
	if show.Status != "pending" || show.AuthorID != owner.ID || show.SortOrder != 0 {
		t.Fatal("ordinary user bypassed moderation or impersonated an author")
	}
	path := "/api/shows/" + show.ID
	for _, token := range []string{"", otherSession.Token} {
		if w := authRequest(r, "GET", path, nil, token, nil); w.Code != 404 {
			t.Fatal("private preview leaked")
		}
	}
	for _, token := range []string{ownerSession.Token, adminSession.Token} {
		if w := authRequest(r, "GET", path, nil, token, nil); w.Code != 200 {
			t.Fatal(w.Body)
		}
	}
	if w := authRequest(r, "PUT", path, body, otherSession.Token, nil); w.Code != 404 {
		t.Fatal("another user edited a draft")
	}
	if w := authRequest(r, "PUT", path, body, ownerSession.Token, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
	current, _ := repo.FindByID(ctx, show.ID)
	if current.Status != "pending" || current.AuthorID != owner.ID {
		t.Fatal("owner bypassed moderation by updating")
	}
	if err := db.Model(&model.Show{}).Where("id = ?", show.ID).Update("status", "published").Error; err != nil {
		t.Fatal(err)
	}
	if w := authRequest(r, "GET", path, nil, "", nil); w.Code != 200 {
		t.Fatal("published content stopped being public")
	}
	if w := authRequest(r, "PUT", path, body, ownerSession.Token, nil); w.Code != 403 {
		t.Fatal("ordinary user edited published content")
	}
	if w := authRequest(r, "PUT", path, map[string]string{"title": "admin edit"}, adminSession.Token, nil); w.Code != 200 {
		t.Fatal(w.Body)
	}
}
