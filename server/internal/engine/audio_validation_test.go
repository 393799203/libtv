package engine

import (
	"context"
	"encoding/json"
	"testing"

	"libtv/internal/llm"
)

func TestInvalidMiniMaxTextAndSettingsFailBeforeBilling(t *testing.T) {
	for _, data := range []string{
		`{"model":"minimax-speech-2.8-turbo","prompt":"前<#0#>后"}`,
		`{"model":"minimax-speech-2.8-hd","prompt":"前<#1#><#2#>后"}`,
		`{"model":"minimax-speech-2.8-hd","prompt":"文本","tone":"whisper"}`,
		`{"model":"minimax-speech-2.8-hd","prompt":"文本","speed":3}`,
	} {
		out, err := NewAudioExecutor(nil, nil, nil, nil).Execute(context.Background(),
			WorkflowNode{ID: "audio", Data: json.RawMessage(data)}, &ExecutionContext{channel: llm.ChannelDianxin})
		if err != nil || out == nil || out.Status != "failed" {
			t.Fatalf("invalid input reached billing or generation: out=%+v err=%v", out, err)
		}
	}
}

func TestNewSeedreamModelsRejectMultipleImagesBeforeBilling(t *testing.T) {
	out, err := NewImageExecutor(nil, nil, nil, nil, nil, nil, nil).Execute(context.Background(),
		WorkflowNode{ID: "image", Data: json.RawMessage(`{"model":"doubao-seedream-5.0-lite","prompt":"测试","count":2}`)},
		&ExecutionContext{channel: llm.ChannelDianxin})
	if err != nil || out == nil || out.Status != "failed" {
		t.Fatalf("unsupported image count reached billing: out=%+v err=%v", out, err)
	}
	for _, id := range []string{"doubao-seedream-5.5", "doubao-seedream-5.0-flash"} {
		if getModelMinPixels(id) != 921600 {
			t.Fatalf("new image pixel limits mismatch: %s", id)
		}
	}
	if getModelMinPixels("doubao-seedream-5.0-lite") != 3686400 {
		t.Fatal("wasu image constraints changed")
	}
}
