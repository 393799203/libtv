package llm

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"libtv/internal/config"
)

func TestOnlyDianxinCanRouteNewRequests(t *testing.T) {
	router := NewChannelRouter(func(context.Context) (string, error) {
		return PolicyAllWasu, errors.New("old policy must not matter")
	}, map[string]config.ProviderConfig{
		ChannelWasu:    {APIKey: "retired", BaseURL: "https://retired.invalid"},
		ChannelDianxin: {APIKey: "active", BaseURL: "https://electric.invalid"},
	})
	for _, userChannel := range []string{"", ChannelWasu, ChannelDianxin, "unknown"} {
		if got := router.Resolve(context.Background(), userChannel); got != ChannelDianxin {
			t.Fatalf("retired user channel affected routing: %s", got)
		}
	}
	if _, ok := router.Provider(ChannelWasu); ok {
		t.Fatal("retired credentials remain accessible")
	}
	if len(router.GetChannelProviders()) != 1 {
		t.Fatal("more than one active provider")
	}
	if ChannelFrom(context.Background()) != ChannelDianxin {
		t.Fatal("default must be electric")
	}
	if ChannelFrom(WithChannel(context.Background(), ChannelWasu)) != ChannelWasu {
		t.Fatal("explicit historical refund channel must remain intact")
	}
	if ValidatePolicy(PolicyAllWasu) == nil || ValidatePolicy(PolicyPerUser) == nil {
		t.Fatal("retired routing policy accepted")
	}
}

func TestRetiredContextCannotFallBackToConfiguredCredentials(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls++; w.WriteHeader(500) }))
	defer upstream.Close()
	cfg := config.AIConfig{Providers: map[string]config.ProviderConfig{
		ChannelDianxin: {APIKey: "electric", BaseURL: upstream.URL},
		ChannelWasu:    {APIKey: "retired", BaseURL: upstream.URL},
	}}
	router := NewChannelRouter(nil, cfg.Providers)
	ctx := WithChannel(context.Background(), ChannelWasu)
	_, textErr := NewClient(cfg, ChannelDianxin, router).ChatWithModel(ctx, "test", "", "test")
	_, imageErr := NewImageClient(cfg, ChannelDianxin, router).GenerateImage(ctx, "test", "1920x1080")
	_, audioErr := NewAudioClient(cfg, ChannelDianxin, router).GenerateSpeech(ctx, "minimax-speech-2.8-turbo", "test", "", 1, "", "")
	_, videoErr := NewVideoClient(cfg, ChannelDianxin, VideoPollConfig{}, router).GenerateVideo(ctx, "cdance2.0-0807", "test", 5, "720p", "16:9", nil, nil, nil, "", true)
	if textErr == nil || imageErr == nil || audioErr == nil || videoErr == nil || calls != 0 {
		t.Fatalf("retired credential fallback: errors=%v/%v/%v/%v calls=%d", textErr, imageErr, audioErr, videoErr, calls)
	}
}

func TestSingleRegistryAndOldModelCompatibility(t *testing.T) {
	mm, err := NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if got := mm.ListChannels(); len(got) != 1 || got[0] != ChannelDianxin {
		t.Fatalf("active channels=%v", got)
	}
	for _, id := range []string{"doubao-seedream-5.0-lite", "doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.5", "deepseek-v4-flash"} {
		actual := NormalizeActiveModelID(id)
		if actual == id || mm.FindModelByIDForChannel(ChannelDianxin, actual) == nil {
			t.Fatalf("missing electric counterpart: %s -> %s", id, actual)
		}
	}
	for _, usage := range []string{"text", "script", "image", "video", "audio"} {
		if mm.ValidateActiveModel("qwen3-tts-instruct-flash", usage) == nil {
			t.Fatal("retired model accepted")
		}
	}
}
