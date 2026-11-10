package repository

import (
	"context"
	"encoding/json"
	"testing"

	"gorm.io/datatypes"
)

func testCanvasData(t *testing.T, raw datatypes.JSON, id string) map[string]json.RawMessage {
	t.Helper()
	data := nodeDataByID(raw)[id]
	if data == nil {
		t.Fatalf("missing node %s: %s", id, raw)
	}
	return data
}

func TestOldCanvasCannotRestoreFailureOverDeliveredVideo(t *testing.T) {
	old := datatypes.JSON(`{"nodes":[{"id":"v","data":{"status":"success","videoUrl":"new.mp4"}}]}`)
	incoming := datatypes.JSON(`{"nodes":[{"id":"v","position":{"x":99},"data":{"status":"failed","error":"old error","prompt":"new edit"}}],"edges":[]}`)
	content := mergeStickyProducts(old, incoming)
	got := testCanvasData(t, preserveDeliveredState(old, content, nil), "v")
	if string(got["status"]) != `"success"` || len(got["error"]) > 0 || string(got["videoUrl"]) != `"new.mp4"` {
		t.Fatalf("old snapshot overwrote delivered result: %v", got)
	}
	if string(got["prompt"]) != `"new edit"` {
		t.Fatal("protecting generation status must preserve user edits")
	}
}

func TestActualRetryFailureCanKeepPreviousVideo(t *testing.T) {
	old := datatypes.JSON(`{"nodes":[{"id":"v","data":{"status":"success","videoUrl":"previous.mp4"}}]}`)
	incoming := datatypes.JSON(`{"nodes":[{"id":"v","data":{"status":"failed","error":"new attempt rejected"}}]}`)
	ctx := WithGenerationStateUpdates(context.Background(), "v")
	allowed := ctx.Value(generationStateUpdatesKey{}).(map[string]bool)
	got := testCanvasData(t, preserveDeliveredState(old, mergeStickyProducts(old, incoming), allowed), "v")
	if string(got["status"]) != `"failed"` || string(got["error"]) != `"new attempt rejected"` || string(got["videoUrl"]) != `"previous.mp4"` {
		t.Fatalf("real failure must not become a false success: %v", got)
	}
}

func TestGenerationWriteCannotDowngradeOtherNodes(t *testing.T) {
	old := datatypes.JSON(`{"nodes":[{"id":"a","data":{"status":"success","videoUrl":"a.mp4"}},{"id":"b","data":{"status":"success","videoUrl":"b.mp4"}}]}`)
	incoming := datatypes.JSON(`{"nodes":[{"id":"a","data":{"status":"failed","error":"real failure"}},{"id":"b","data":{"status":"failed","error":"stale failure"}}]}`)
	got := preserveDeliveredState(old, mergeStickyProducts(old, incoming), map[string]bool{"a": true})
	if string(testCanvasData(t, got, "a")["status"]) != `"failed"` || string(testCanvasData(t, got, "b")["status"]) != `"success"` {
		t.Fatalf("generation scope leaked to unrelated nodes: %s", got)
	}
}

func TestPreserveDeliveredStateDoesNotReviveDeletedNodesOrInventSuccess(t *testing.T) {
	old := datatypes.JSON(`{"nodes":[{"id":"a","data":{"status":"success","videoUrl":"a.mp4"}},{"id":"b","data":{"status":"failed","videoUrl":"previous.mp4","error":"real failure"}}]}`)
	incoming := datatypes.JSON(`{"nodes":[{"id":"b","data":{"status":"failed","videoUrl":"previous.mp4","error":"real failure"}}]}`)
	got := preserveDeliveredState(old, mergeStickyProducts(old, incoming), nil)
	if len(nodeDataByID(got)) != 1 || string(testCanvasData(t, got, "b")["status"]) != `"failed"` {
		t.Fatalf("deleted node revived or old video mistaken for latest success: %s", got)
	}
}
