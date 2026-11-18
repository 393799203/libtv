package llm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"libtv/internal/config"
)

func TestSeedreamRegistryAndDefault(t *testing.T) {
	mm, err := NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range []string{ChannelWasu, ChannelDianxin} {
		wantDefault := FallbackImageModelID
		if channel == ChannelDianxin {
			wantDefault = DianxinFallbackImageModelID
		}
		if mm.DefaultImageModelID(channel) != wantDefault {
			t.Fatalf("%s default differs from client fallback", channel)
		}
		defaults := 0
		for _, m := range mm.ListModelsForChannel(channel)["image"] {
			if m.Default {
				defaults++
			}
			if channel == ChannelDianxin && m.ID == "doubao-seedream-5.0-lite" {
				t.Fatal("retired Lite must not be selectable")
			}
		}
		if defaults != 1 {
			t.Fatalf("%s must have exactly one default", channel)
		}
		for _, id := range []string{"doubao-seedream-5.5", "doubao-seedream-5.0-flash", "doubao-seedream-5.0-pro"} {
			m := mm.FindModelByIDForChannel(channel, id)
			if channel == ChannelWasu && id != "doubao-seedream-5.0-pro" {
				if m != nil {
					t.Fatalf("new model must not be added to wasu: %s", id)
				}
				continue
			}
			if m == nil || m.Provider != channel || m.ModelID != id || mm.ImageAPIStyle(channel, id) != ImageStyleOpenAI {
				t.Fatalf("%s model %s is not wired to the channel image API: %+v", channel, id, m)
			}
		}
	}
}

func TestSeedreamTextAndReferenceImageWirePayload(t *testing.T) {
	mm, err := NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, channel := range []string{ChannelWasu, ChannelDianxin} {
		for _, modelID := range []string{"doubao-seedream-5.5", "doubao-seedream-5.0-flash", "doubao-seedream-5.0-lite", ""} {
			for _, withReference := range []bool{false, true} {
				t.Run(channel+"/"+modelID+map[bool]string{false: "/text", true: "/reference"}[withReference], func(t *testing.T) {
					wantModel := NormalizeImageModelID(modelID, channel)
					if wantModel == "" {
						wantModel = mm.DefaultImageModelID(channel)
					}
					var wantImages []string
					if withReference {
						wantImages = []string{"https://example.test/face.png", "https://example.test/pose.png"}
					}
					calls := 0
					upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						calls++
						var req ImageRequest
						if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
							t.Error(err)
						}
						if r.URL.Path != "/images/generations" || r.Method != http.MethodPost ||
							r.Header.Get("Authorization") != "Bearer "+channel || req.Model != wantModel ||
							req.Size != "2560x1440" || req.N != 1 || req.Prompt != "test prompt" || req.Watermark ||
							!reflect.DeepEqual(req.Image, wantImages) {
							t.Errorf("unexpected channel or request: %s %+v", r.URL.Path, req)
						}
						w.Header().Set("Content-Type", "application/json")
						_, _ = w.Write([]byte(`{"data":[{"url":"https://example.test/result.png"}],"usage":{"generated_images":1}}`))
					}))
					defer upstream.Close()
					providers := map[string]config.ProviderConfig{channel: {APIKey: channel, BaseURL: upstream.URL}}
					client := NewImageClient(config.AIConfig{}, "unused", NewChannelRouter(nil, providers))
					client.SetModelManager(mm)
					ctx := WithChannel(context.Background(), channel)
					var urls []string
					var err error
					if modelID == "" && !withReference {
						urls, err = client.GenerateImage(ctx, "test prompt", "2560x1440")
					} else if withReference {
						selected := modelID
						if selected == "" {
							selected = client.model
						}
						urls, err = client.GenerateImageFromImageWithModel(ctx, selected, wantImages, "test prompt", "2560x1440", 1)
					} else {
						urls, err = client.GenerateImageWithModel(ctx, modelID, "test prompt", "2560x1440", 1)
					}
					if err != nil || calls != 1 || !reflect.DeepEqual(urls, []string{"https://example.test/result.png"}) {
						t.Fatalf("unexpected result: urls=%v calls=%d err=%v", urls, calls, err)
					}
				})
			}
		}
	}
}
