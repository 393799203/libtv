package llm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"libtv/internal/config"
)

func TestMinimaxRegistryAndChannelDefaults(t *testing.T) {
	mm, err := NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if mm.DefaultAudioModelID(ChannelDianxin) != "minimax-speech-2.8-turbo" ||
		mm.DefaultAudioModelID(ChannelWasu) != "qwen3-tts-instruct-flash" {
		t.Fatal("audio defaults crossed channels")
	}
	for _, id := range []string{"minimax-speech-2.8-turbo", "minimax-speech-2.8-hd"} {
		if mm.FindModelByIDForChannel(ChannelDianxin, id) == nil || mm.FindModelByIDForChannel(ChannelWasu, id) != nil {
			t.Fatalf("audio model registered in wrong channel: %s", id)
		}
	}
}

func TestMinimaxRequestPreservesParagraphsPauseAndPronunciation(t *testing.T) {
	input := "第一段(笑声)，这里(he2)平。\n\n第二段(laughs)<#0.50#>继续(sighs)。"
	wav := []byte("RIFF\x28\x00\x00\x00WAVEfmt mock audio")
	for _, id := range []string{"minimax-speech-2.8-turbo", "minimax-speech-2.8-hd"} {
		t.Run(id, func(t *testing.T) {
			upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var req map[string]json.RawMessage
				if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
					t.Fatal(err)
				}
				var model, voice, text, format string
				var speed float64
				_ = json.Unmarshal(req["model"], &model)
				_ = json.Unmarshal(req["voice"], &voice)
				_ = json.Unmarshal(req["input"], &text)
				_ = json.Unmarshal(req["response_format"], &format)
				_ = json.Unmarshal(req["speed"], &speed)
				var metadata struct {
					VoiceSetting minimaxVoiceSetting `json:"voice_setting"`
				}
				_ = json.Unmarshal(req["metadata"], &metadata)
				if r.URL.Path != "/v1/audio/speech" || r.Header.Get("Authorization") != "Bearer electric" ||
					model != id || voice != MinimaxDefaultVoiceID || text != input || format != "wav" || speed != 1.25 ||
					metadata.VoiceSetting.Emotion != "happy" || metadata.VoiceSetting.VoiceID != voice || metadata.VoiceSetting.Speed != speed {
					t.Errorf("unexpected speech request: %s %+v", r.URL.Path, req)
				}
				if _, exists := req["instructions"]; exists {
					t.Error("Qwen instructions leaked to MiniMax")
				}
				if _, exists := req["audio_options"]; exists {
					t.Error("Qwen options leaked to MiniMax")
				}
				_, _ = w.Write(wav)
			}))
			defer upstream.Close()
			cfg := config.AIConfig{Providers: map[string]config.ProviderConfig{
				ChannelWasu:    {APIKey: "wrong", BaseURL: "http://unused.invalid"},
				ChannelDianxin: {APIKey: "electric", BaseURL: upstream.URL + "/v1/"},
			}}
			client := NewAudioClient(cfg, ChannelWasu, NewChannelRouter(nil, cfg.Providers))
			got, err := client.GenerateSpeech(WithChannel(context.Background(), ChannelDianxin), id, input, "default", 1.25, "", "happy")
			if err != nil || !reflect.DeepEqual(got, wav) {
				t.Fatalf("audio bytes lost: %q err=%v", got, err)
			}
		})
	}
}

func TestMinimaxPauseAndEmotionValidation(t *testing.T) {
	for _, text := range []string{"正常文本。\n\n第二段。", "前<#0.01#>后", "前<#99.99#>后", "前(he2)后(laughs)"} {
		if err := ValidateMinimaxSpeech(text); err != nil {
			t.Fatalf("valid text rejected: %q %v", text, err)
		}
	}
	for _, text := range []string{"<#0.5#>开头", "末尾<#0.5#>", "前<#0.5#> \n<#1#>后",
		"前<#0#>后", "前<#100#>后", "前<#1.234#>后", "前<#bad#>后", "前<#1后", strings.Repeat("字", 10000)} {
		if err := ValidateMinimaxSpeech(text); err == nil {
			t.Fatalf("invalid text accepted: %q", text)
		}
	}
	for _, tone := range []string{"", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "喜悦"} {
		if err := ValidateMinimaxSpeechSettings(1, tone); err != nil {
			t.Fatalf("valid tone %s: %v", tone, err)
		}
	}
	for _, tone := range []string{"whisper", "fluent", "FutureEmotion"} {
		if err := ValidateMinimaxSpeechSettings(1, tone); err == nil {
			t.Fatalf("unsupported tone accepted: %s", tone)
		}
	}
	for _, speed := range []float64{0.1, 2.1, -1} {
		if err := ValidateMinimaxSpeechSettings(speed, ""); err == nil {
			t.Fatalf("invalid speed: %v", speed)
		}
	}
	req, err := buildMinimaxSpeechRequest("minimax-speech-2.8-turbo", "原文", "", 0, "")
	if err != nil || req.Speed != 1 || req.Metadata.VoiceSetting.Emotion != "" {
		t.Fatalf("defaults must remain automatic: %+v %v", req, err)
	}
}

func TestMinimaxUnknownRejectionsKeepOriginalAndRefundClassification(t *testing.T) {
	for _, tc := range []struct {
		status                int
		body, code, requestID string
		rejected              bool
	}{
		{200, `{"error":{"code":"FutureSpeechCode","message":"original error"},"request_id":"req-voice"}`, "FutureSpeechCode", "req-voice", true},
		{200, `{"base_resp":{"status_code":12345,"status_msg":"original error"},"trace_id":"trace-voice"}`, "12345", "trace-voice", true},
		{200, `{"code":"FutureSpeechCode","message":"original error","request_id":"req-top"}`, "FutureSpeechCode", "req-top", true},
		{400, `{"error":{"code":"InvalidParameter","message":"original error"},"request_id":"req-bad"}`, "InvalidParameter", "req-bad", true},
		{502, `{"error":{"code":"TemporaryError","message":"original error"}}`, "TemporaryError", "", false},
	} {
		upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(tc.status)
			_, _ = w.Write([]byte(tc.body))
		}))
		client := NewAudioClient(config.AIConfig{Providers: map[string]config.ProviderConfig{ChannelDianxin: {APIKey: "test", BaseURL: upstream.URL}}}, ChannelDianxin)
		_, err := client.GenerateSpeech(context.Background(), "minimax-speech-2.8-hd", "测试", "", 1, "", "")
		upstream.Close()
		var detail *UpstreamError
		if !errors.As(err, &detail) || detail.Raw != tc.body || detail.Code != tc.code || detail.RequestID != tc.requestID ||
			detail.Message != "original error" || errors.Is(err, ErrUpstreamRejected) != tc.rejected {
			t.Fatalf("speech error was altered: %+v err=%v", detail, err)
		}
	}
}

func TestQwenSpeechRequestStillUsesInstructions(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req TTSRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		if req.Model != "qwen3-tts-instruct-flash" || req.Voice != "Cherry" || req.Input != "原文正文" ||
			!strings.Contains(req.Instructions, "笑声") || !strings.Contains(req.Instructions, "温暖") ||
			len(req.AudioOptions.LanguageHints) != 1 {
			t.Errorf("Qwen payload changed: %+v", req)
		}
		_, _ = w.Write([]byte("RIFF existing audio"))
	}))
	defer upstream.Close()
	client := NewAudioClient(config.AIConfig{Providers: map[string]config.ProviderConfig{ChannelWasu: {APIKey: "test", BaseURL: upstream.URL}}}, ChannelWasu)
	if _, err := client.GenerateSpeech(context.Background(), "qwen3-tts-instruct-flash", "原文<#0.5#>(笑声)正文", "default", 1.25, "温暖", ""); err != nil {
		t.Fatal(err)
	}
}
