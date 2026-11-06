// import-private-previews stages an edited showcase batch in one owner's canvas.
// It does not create shows, publish content or call any generation service.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"libtv/internal/config"
	"libtv/internal/model"
	"libtv/internal/service"
	"libtv/internal/storage"

	"github.com/golang-jwt/jwt/v5"
	"gorm.io/datatypes"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

type film struct {
	ID           string  `json:"id"`
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	CategoryName string  `json:"categoryName"`
	Output       string  `json:"output"`
	Cover        string  `json:"cover"`
	Duration     float64 `json:"duration"`
	VideoURL     string  `json:"video_url,omitempty"`
	CoverURL     string  `json:"cover_url,omitempty"`
	Width        int     `json:"width,omitempty"`
	Height       int     `json:"height,omitempty"`
}

func main() {
	root := flag.String("dir", "", "batch directory containing rendered.json and outputs")
	projectID := flag.String("project", "", "stable project UUID for this batch")
	ownerID := flag.String("owner", "", "preview account UUID")
	checkOnly := flag.Bool("check-only", false, "only verify access controls")
	uploadOnly := flag.Bool("upload-only", false, "upload completed renders without creating a project")
	projectName := flag.String("name", "首页候选视频 · 10支待确认", "private preview project name")
	guide := flag.String("guide", "10 支含 AI 生成影像的主题剪辑，均已加入漫蛙 Logo 与程序配乐。\n单击播放，双击视频可放大预览。\n此项目仅本账号可访问，作品尚未公开到首页。请确认喜欢的编号后再发布。\n未调用任何付费生成接口，未使用账号生成额度。", "review instructions shown in the canvas")
	videoOnly := flag.Bool("video-only", false, "only video nodes, without an instruction node")
	flag.Parse()
	if *projectID == "" || *ownerID == "" || (!*checkOnly && *root == "") {
		log.Fatal("-project and -owner are required; imports also require -dir")
	}
	if err := config.Load("configs/config.yaml"); err != nil {
		log.Fatal(err)
	}
	db, err := gorm.Open(postgres.Open(config.C.Database.DSN()), &gorm.Config{})
	must(err)
	var owner model.User
	must(db.First(&owner, "id = ?", *ownerID).Error)
	if *checkOnly {
		must(verifyAccess(db, owner, *projectID))
		return
	}
	b, err := os.ReadFile(filepath.Join(*root, "rendered.json"))
	must(err)
	var films []film
	must(json.Unmarshal(b, &films))
	if *uploadOnly {
		var completed []film
		for _, f := range films {
			if f.Duration <= 0 {
				continue
			}
			if _, err := os.Stat(filepath.Join(*root, f.Cover)); err != nil {
				continue
			}
			if info, err := os.Stat(filepath.Join(*root, f.Output)); err == nil && info.Size() > 0 {
				completed = append(completed, f)
			}
		}
		films = completed
	}
	if len(films) == 0 {
		log.Fatal("empty batch")
	}
	var existing int64
	must(db.Model(&model.Project{}).Where("id = ?", *projectID).Count(&existing).Error)
	if existing != 0 {
		log.Fatal("preview project already exists; refusing to overwrite its canvas")
	}
	for _, f := range films {
		if f.Duration <= 0 {
			log.Fatal("missing duration: ", f.ID)
		}
		for _, name := range []string{f.Output, f.Cover} {
			// Only accept filenames beneath this batch, never arbitrary paths.
			if !strings.HasPrefix(name, "outputs/") || strings.Contains(name, "..") {
				log.Fatal("invalid output path")
			}
			info, err := os.Stat(filepath.Join(*root, name))
			must(err)
			if info.Size() == 0 {
				log.Fatal("empty file: ", name)
			}
		}
	}
	store, err := storage.Create(config.C.Storage, "/app/public")
	must(err)
	if store.GetType() == "local" {
		log.Fatal("cloud storage unavailable; refusing local fallback for private preview batch")
	}
	uploader := service.NewFileUploadService(store)
	upload := func(name string) (string, error) {
		f, err := os.Open(filepath.Join(*root, name))
		if err != nil {
			return "", err
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil {
			return "", err
		}
		r, err := uploader.UploadFromReader(f, info.Size(), filepath.Base(name), service.UploadOptions{
			Dir: "canvas", ProjectID: *projectID,
			AllowedExts: map[string]bool{".mp4": true, ".jpg": true},
			ContentTypeFor: func(ext string) string {
				if ext == ".mp4" {
					return "video/mp4"
				}
				return "image/jpeg"
			},
		})
		if err != nil {
			return "", err
		}
		if !strings.HasPrefix(r.URL, "https://") {
			return "", fmt.Errorf("expected direct HTTPS cloud URL")
		}
		return r.URL, nil
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, 3)
	errs := make(chan error, len(films))
	for i := range films {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			var err error
			films[i].VideoURL, err = upload(films[i].Output)
			if err == nil {
				films[i].CoverURL, err = upload(films[i].Cover)
			}
			if err != nil {
				errs <- fmt.Errorf("%s: %w", films[i].Title, err)
				return
			}
			log.Printf("Uploaded preview %d/%d: %s", i+1, len(films), films[i].Title)
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		must(err)
	}
	if *uploadOnly {
		log.Printf("Uploaded %d completed renders; no project created, no content published", len(films))
		return
	}
	var nodes []map[string]interface{}
	if !*videoOnly {
		nodes = append(nodes, map[string]interface{}{
			"id": "t-private-review-guide", "type": "text",
			"position": map[string]int{"x": 0, "y": -350},
			"style":    map[string]int{"width": 680, "height": 270},
			"data": map[string]interface{}{
				"type": "text", "label": "首页候选视频 · 待确认", "status": "idle", "model": "", "prompt": "",
				"content": *guide,
			},
		})
	}
	rowPitch := 450
	for _, f := range films {
		if f.Height > f.Width && f.Width > 0 {
			rowPitch = 1050
		}
	}
	for i, f := range films {
		width, height := f.Width, f.Height
		if width <= 0 || height <= 0 {
			width, height = 1920, 1080
		}
		ratio := "16:9"
		if height > width {
			ratio = "9:16"
		}
		nodes = append(nodes, map[string]interface{}{
			"id": "v-preview-" + f.ID, "type": "video",
			"position": map[string]int{"x": (i % 3) * 560, "y": (i / 3) * rowPitch},
			"style":    map[string]int{"width": 480},
			"data": map[string]interface{}{
				"type": "video", "label": fmt.Sprintf("%02d · %s", i+1, f.Title),
				"status": "success", "prompt": "", "model": "",
				"duration": int(math.Round(f.Duration)), "fps": 24, "resolution": "1080p", "aspectRatio": ratio,
				"videoWidth": width, "videoHeight": height, "videoUrl": f.VideoURL,
				"generateAudio": false,
			},
		})
	}
	content, err := json.Marshal(map[string]interface{}{
		"nodes": nodes, "edges": []interface{}{}, "viewport": map[string]float64{"x": 80, "y": 290, "zoom": .65},
	})
	must(err)
	must(db.Transaction(func(tx *gorm.DB) error {
		project := model.Project{
			ID: *projectID, UserID: owner.ID, Name: *projectName,
			Description: fmt.Sprintf("私人审片项目：%d 支含 AI 生成影像的剪辑，确认前不发布到首页。", len(films)),
			CoverURL:    films[0].CoverURL,
		}
		if err := tx.Create(&project).Error; err != nil {
			return err
		}
		return tx.Create(&model.Canvas{ProjectID: project.ID, Content: datatypes.JSON(content), Version: 1}).Error
	}))
	must(verifyAccess(db, owner, *projectID))
	result, err := json.MarshalIndent(map[string]interface{}{
		"project_id": *projectID, "owner_nickname": owner.Nickname, "published": false, "films": films,
	}, "", "  ")
	must(err)
	must(os.WriteFile(filepath.Join(*root, "preview-result.json"), result, 0600))
	fmt.Printf("PRIVATE_PREVIEW_READY project=%s owner=%s count=%d published=false\n", *projectID, owner.Nickname, len(films))
}

func must(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

// Short-lived diagnostic credentials stay in memory and are never printed.
func verifyAccess(db *gorm.DB, owner model.User, projectID string) error {
	var other model.User
	if err := db.Select("id", "email", "password_version").Where("id <> ?", owner.ID).First(&other).Error; err != nil {
		return err
	}
	sign := func(u model.User) string {
		t := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
			"user_id": u.ID, "email": u.Email, "pwd_ver": u.PasswordVersion,
			"exp": time.Now().Add(3 * time.Minute).Unix(),
		})
		s, err := t.SignedString([]byte(config.C.JWT.Secret))
		must(err)
		return s
	}
	client := http.Client{Timeout: 15 * time.Second}
	for _, tc := range []struct {
		name, token string
		want        int
	}{{"owner", sign(owner), 200}, {"another-account", sign(other), 404}, {"anonymous", "", 401}} {
		for _, suffix := range []string{"", "/canvas"} {
			req, _ := http.NewRequestWithContext(context.Background(), "GET",
				"http://127.0.0.1:8080/api/projects/"+projectID+suffix, nil)
			if tc.token != "" {
				req.Header.Set("Authorization", "Bearer "+tc.token)
			}
			resp, err := client.Do(req)
			if err != nil {
				return err
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if resp.StatusCode != tc.want {
				return fmt.Errorf("access check failed: %s %q got %d expected %d", tc.name, suffix, resp.StatusCode, tc.want)
			}
			log.Printf("Access verified: %s %s -> %d", tc.name, suffix, resp.StatusCode)
		}
	}
	return nil
}
