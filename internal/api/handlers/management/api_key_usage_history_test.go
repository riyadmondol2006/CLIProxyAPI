package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keylimit"
)

func TestGetAPIKeyUsageHistoryClampsDaysAndUsesKebabCase(t *testing.T) {
	tracker := keylimit.Default()
	t.Cleanup(func() {
		tracker.Reset("sk-history")
		tracker.Configure(nil, nil)
	})
	tracker.Configure([]string{"sk-history"}, []config.APIKeyLimit{{APIKey: "sk-history", Name: "Laptop"}})
	tracker.Record("sk-history", 12, true)

	h := NewHandlerWithoutConfigFilePath(&config.Config{}, nil)
	read := func(query string) map[string]any {
		t.Helper()
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/v8/management/access/key-usage/history"+query, nil)
		h.GetAPIKeyUsageHistory(c)
		if recorder.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		var body map[string]any
		if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
			t.Fatalf("decode: %v", errDecode)
		}
		return body
	}
	cases := map[string]int{"": 30, "?days=7": 7, "?days=0": 1, "?days=-3": 1, "?days=500": keylimit.HistoryRetentionDays, "?days=abc": 30}
	for query, want := range cases {
		if got := len(read(query)["dates"].([]any)); got != want {
			t.Errorf("%q: got %d dates, want %d", query, got, want)
		}
	}

	keys := read("?days=2")["keys"].([]any)
	if len(keys) != 1 {
		t.Fatalf("expected one key, got %v", keys)
	}
	entry := keys[0].(map[string]any)
	if entry["api-key"] != "sk-history" || entry["name"] != "Laptop" {
		t.Fatalf("unexpected key entry: %v", entry)
	}
	if entry["total-tokens"] != float64(12) || entry["total-requests"] != float64(1) {
		t.Fatalf("unexpected totals: %v", entry)
	}
	if tokens := entry["tokens"].([]any); len(tokens) != 2 {
		t.Fatalf("series must have one entry per date: %v", tokens)
	}
}
