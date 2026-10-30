package management

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/tokenusage"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

// Upstream secrets that must never reach a token usage response.
var tokenUsageTestSecrets = []string{
	"codex-access-token-secret",
	"sk-ant-api03-claude-secret-key-1234",
	"sk-or-v1-openrouter-secret-key-99",
	"sk-proj-codex-config-key-5678",
	"AIzaSyGeminiLabelSecret0042",
}

type tokenUsageTestRow struct {
	Provider     string  `json:"provider"`
	AuthID       string  `json:"auth-id"`
	AuthIndex    string  `json:"auth-index"`
	Account      string  `json:"account"`
	Model        string  `json:"model"`
	ClientKind   string  `json:"client-kind"`
	ClientKey    string  `json:"client-key"`
	ClientName   string  `json:"client-name"`
	Tokens       []int64 `json:"tokens"`
	InputTokens  []int64 `json:"input-tokens"`
	OutputTokens []int64 `json:"output-tokens"`
	Requests     []int64 `json:"requests"`
	Failed       []int64 `json:"failed"`
}

type tokenUsageTestBody struct {
	Dates []string            `json:"dates"`
	Rows  []tokenUsageTestRow `json:"rows"`
}

func registerTokenUsageTestAuths(t *testing.T) *coreauth.Manager {
	t.Helper()
	manager := coreauth.NewManager(nil, nil, nil)
	auths := []*coreauth.Auth{
		{
			ID:         "codex-user@example.com.json",
			FileName:   "codex-user@example.com.json",
			Provider:   "codex",
			Label:      "codex-user",
			Attributes: map[string]string{"path": "/auths/codex-user@example.com.json", "source": "/auths/codex-user@example.com.json"},
			Metadata:   map[string]any{"type": "codex", "email": "user@example.com", "access_token": "codex-access-token-secret"},
		},
		{
			ID:       "claude:apikey:abc123",
			Provider: "claude",
			Label:    "claude-apikey",
			Attributes: map[string]string{
				"api_key":   "sk-ant-api03-claude-secret-key-1234",
				"base_url":  "https://user:pass@claude.example.com:8443/v1?key=x",
				"source":    "config:claude[abc123]",
				"auth_kind": "apikey",
			},
		},
		{
			ID:       "openai-compatibility:openrouter:def456",
			Provider: "openrouter",
			Label:    "OpenRouter",
			Attributes: map[string]string{
				"api_key":     "sk-or-v1-openrouter-secret-key-99",
				"base_url":    "https://openrouter.ai/api/v1",
				"compat_name": "OpenRouter",
				"source":      "config:openrouter[def456]",
			},
		},
		{
			ID:         "codex:apikey:0a0b0c",
			Provider:   "codex",
			Label:      "codex-apikey",
			Attributes: map[string]string{"api_key": "sk-proj-codex-config-key-5678", "source": "config:codex[0a0b0c]", "auth_kind": "apikey"},
		},
		{
			// A credential whose label is its own key must still be masked.
			ID:         "gemini-label-is-key",
			Provider:   "gemini",
			Label:      "AIzaSyGeminiLabelSecret0042",
			Attributes: map[string]string{"api_key": "AIzaSyGeminiLabelSecret0042"},
		},
	}
	for _, auth := range auths {
		if _, errRegister := manager.Register(context.Background(), auth); errRegister != nil {
			t.Fatalf("register %s: %v", auth.ID, errRegister)
		}
	}
	return manager
}

func newTokenUsageTestHandler(t *testing.T) (*Handler, string) {
	t.Helper()
	manager := registerTokenUsageTestAuths(t)
	today := time.Date(2026, 10, 30, 12, 0, 0, 0, time.Local)
	clock := today
	tracker := tokenusage.NewTracker()
	tracker.SetClock(func() time.Time { return clock })
	record := func(daysAgo int, record coreusage.Record) {
		clock = today.AddDate(0, 0, -daysAgo)
		tracker.Record(record)
	}
	attempt := func(provider, authID, model, clientKey string, native bool, input, output int64, failed bool) coreusage.Record {
		authIndex := ""
		if auth, ok := manager.GetByID(authID); ok {
			authIndex = auth.Index
		}
		return coreusage.Record{
			Provider: provider, AuthID: authID, AuthIndex: authIndex, Model: model,
			APIKey: clientKey, IsNativeKey: native, Failed: failed,
			Detail: coreusage.Detail{InputTokens: input, OutputTokens: output},
		}
	}

	// Configured key "Laptop (Sam)" through the Codex OAuth account, yesterday.
	record(1, attempt("codex", "codex-user@example.com.json", "gpt-5-codex", "sk-client-laptop", true, 500, 200, false))
	record(1, attempt("codex", "codex-user@example.com.json", "gpt-5-codex", "sk-client-laptop", true, 400, 100, false))
	record(1, attempt("codex", "codex-user@example.com.json", "gpt-5-codex", "sk-client-laptop", true, 0, 0, true))
	// Two keys that are no longer configured, merged into one "removed" row.
	record(0, attempt("claude", "claude:apikey:abc123", "claude-sonnet", "sk-client-gone-1", true, 2000, 1000, false))
	record(2, attempt("claude", "claude:apikey:abc123", "claude-sonnet", "sk-client-gone-2", true, 1000, 500, true))
	// Requests that did not use a native client key.
	record(0, attempt("openrouter", "openai-compatibility:openrouter:def456", "kimi-k2", "plugin-key", false, 50, 50, false))
	record(0, attempt("codex", "codex:apikey:0a0b0c", "gpt-5", "sk-client-desk", true, 10, 0, false))
	record(0, attempt("gemini", "gemini-label-is-key", "gemini-pro", "", false, 5, 5, false))
	// A credential that was deleted, and a record without any credential.
	record(0, attempt("xai", "deleted-auth.json", "grok", "", false, 3, 0, false))
	record(0, attempt("", "", "", "", false, 0, 0, true))
	// Activity outside a 7-day window.
	record(20, attempt("codex", "codex-user@example.com.json", "gpt-4", "", false, 100000, 0, false))
	clock = today

	cfg := &config.Config{
		SDKConfig:    config.SDKConfig{APIKeys: []string{"sk-client-laptop", "sk-client-desk"}},
		APIKeyLimits: []config.APIKeyLimit{{APIKey: "sk-client-laptop", Name: "Laptop (Sam)"}},
	}
	h := NewHandlerWithoutConfigFilePath(cfg, manager)
	h.tokenUsage = tracker
	return h, today.Format("2006-01-02")
}

func getTokenUsage(t *testing.T, h *Handler, query string) (tokenUsageTestBody, string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodGet, "/v8/management/usage/tokens"+query, nil)
	h.GetTokenUsage(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}
	var body tokenUsageTestBody
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
		t.Fatalf("decode: %v", errDecode)
	}
	return body, recorder.Body.String()
}

func sumInt64(values []int64) int64 {
	var total int64
	for _, value := range values {
		total += value
	}
	return total
}

func TestGetTokenUsageClampsDaysEndingToday(t *testing.T) {
	h, today := newTokenUsageTestHandler(t)
	cases := map[string]int{"": 30, "?days=7": 7, "?days=0": 1, "?days=-3": 1, "?days=500": tokenusage.RetentionDays, "?days=abc": 30, "?days=": 30}
	for query, want := range cases {
		body, _ := getTokenUsage(t, h, query)
		if len(body.Dates) != want {
			t.Errorf("%q: got %d dates, want %d", query, len(body.Dates), want)
			continue
		}
		if body.Dates[len(body.Dates)-1] != today {
			t.Errorf("%q: last date %s, want today %s", query, body.Dates[len(body.Dates)-1], today)
		}
		if !slices.IsSorted(body.Dates) {
			t.Errorf("%q: dates must be oldest first: %v", query, body.Dates)
		}
	}
}

func TestGetTokenUsageRowsMatchContract(t *testing.T) {
	h, _ := newTokenUsageTestHandler(t)
	body, raw := getTokenUsage(t, h, "?days=7")
	if want := []string{"2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"}; !slices.Equal(body.Dates, want) {
		t.Fatalf("dates = %v, want %v", body.Dates, want)
	}

	// Zero-filled series, rows sorted by total tokens, inactive rows left out.
	var previous int64 = -1
	for i, row := range body.Rows {
		for name, series := range map[string][]int64{"tokens": row.Tokens, "input-tokens": row.InputTokens, "output-tokens": row.OutputTokens, "requests": row.Requests, "failed": row.Failed} {
			if len(series) != len(body.Dates) {
				t.Fatalf("row %d %s has %d entries, want %d", i, name, len(series), len(body.Dates))
			}
		}
		total := sumInt64(row.Tokens)
		if previous >= 0 && total > previous {
			t.Fatalf("rows must be sorted by total tokens descending: %d after %d", total, previous)
		}
		previous = total
		if row.Model == "gpt-4" {
			t.Fatalf("row without activity in the window must be omitted: %+v", row)
		}
	}
	if len(body.Rows) != 7 {
		t.Fatalf("expected 7 rows, got %d: %+v", len(body.Rows), body.Rows)
	}

	removed := body.Rows[0]
	if removed.Provider != "claude" || removed.ClientKind != "removed" || removed.ClientKey != "" || removed.ClientName != "" {
		t.Fatalf("unexpected removed-key row: %+v", removed)
	}
	if !slices.Equal(removed.Tokens, []int64{0, 0, 0, 0, 1500, 0, 3000}) || !slices.Equal(removed.Requests, []int64{0, 0, 0, 0, 1, 0, 1}) || !slices.Equal(removed.Failed, []int64{0, 0, 0, 0, 1, 0, 0}) {
		t.Fatalf("removed keys should merge into one zero-filled row: %+v", removed)
	}
	if removed.Account != "claude.example.com:8443 · sk-an…34" {
		t.Fatalf("claude api-key account = %q", removed.Account)
	}

	laptop := body.Rows[1]
	if laptop.Provider != "codex" || laptop.AuthID != "codex-user@example.com.json" || laptop.Model != "gpt-5-codex" {
		t.Fatalf("unexpected second row: %+v", laptop)
	}
	if laptop.ClientKind != "key" || laptop.ClientKey != "sk-client-laptop" || laptop.ClientName != "Laptop (Sam)" {
		t.Fatalf("configured key should resolve with its name: %+v", laptop)
	}
	if laptop.Account != "user@example.com" || laptop.AuthIndex == "" {
		t.Fatalf("oauth account should use the email and keep the auth index: %+v", laptop)
	}
	if !slices.Equal(laptop.Tokens[5:], []int64{1200, 0}) || !slices.Equal(laptop.InputTokens[5:], []int64{900, 0}) ||
		!slices.Equal(laptop.OutputTokens[5:], []int64{300, 0}) || !slices.Equal(laptop.Requests[5:], []int64{3, 0}) || !slices.Equal(laptop.Failed[5:], []int64{1, 0}) {
		t.Fatalf("unexpected laptop series: %+v", laptop)
	}

	byModel := make(map[string]tokenUsageTestRow, len(body.Rows))
	for _, row := range body.Rows {
		byModel[row.Model] = row
	}
	checks := []struct {
		model, account, kind, key, name string
	}{
		{"kimi-k2", "OpenRouter · sk-or…99", "other", "", ""},
		{"gpt-5", "sk-pr…78", "key", "sk-client-desk", ""},
		{"gemini-pro", "AIzaS…42", "other", "", ""},
		{"grok", "deleted-auth.json", "other", "", ""},
		{"unknown", "", "other", "", ""},
	}
	for _, check := range checks {
		row, ok := byModel[check.model]
		if !ok {
			t.Fatalf("missing row for %s", check.model)
		}
		if row.Account != check.account || row.ClientKind != check.kind || row.ClientKey != check.key || row.ClientName != check.name {
			t.Errorf("%s: got account=%q kind=%q key=%q name=%q, want %+v", check.model, row.Account, row.ClientKind, row.ClientKey, row.ClientName, check)
		}
	}
	if unknown := byModel["unknown"]; unknown.Provider != "unknown" || unknown.Failed[6] != 1 {
		t.Errorf("record without provider or model should be reported as unknown: %+v", unknown)
	}

	for _, secret := range tokenUsageTestSecrets {
		if strings.Contains(raw, secret) {
			t.Fatalf("response leaks upstream secret %q: %s", secret, raw)
		}
	}
	for _, clientKey := range []string{"sk-client-gone-1", "sk-client-gone-2", "plugin-key"} {
		if strings.Contains(raw, clientKey) {
			t.Fatalf("response must not contain unconfigured client key %q", clientKey)
		}
	}

	// The wire format has exactly the contract fields.
	var generic struct {
		Rows []map[string]json.RawMessage `json:"rows"`
	}
	if errDecode := json.Unmarshal([]byte(raw), &generic); errDecode != nil {
		t.Fatalf("decode: %v", errDecode)
	}
	want := []string{"account", "auth-id", "auth-index", "client-key", "client-kind", "client-name", "failed", "input-tokens", "model", "output-tokens", "provider", "requests", "tokens"}
	for _, row := range generic.Rows {
		keys := make([]string, 0, len(row))
		for key := range row {
			keys = append(keys, key)
		}
		slices.Sort(keys)
		if !slices.Equal(keys, want) {
			t.Fatalf("row fields = %v, want %v", keys, want)
		}
	}
}

func TestGetTokenUsageEmptyAndWithoutAuthManager(t *testing.T) {
	tracker := tokenusage.NewTracker()
	tracker.SetClock(func() time.Time { return time.Date(2026, 10, 30, 12, 0, 0, 0, time.Local) })
	h := NewHandlerWithoutConfigFilePath(&config.Config{}, nil)
	h.tokenUsage = tracker

	body, raw := getTokenUsage(t, h, "?days=2")
	if !strings.Contains(raw, `"rows":[]`) || len(body.Dates) != 2 {
		t.Fatalf("empty usage should return dates and an empty rows array: %s", raw)
	}

	tracker.Record(coreusage.Record{Provider: "codex", AuthID: "codex.json", Model: "gpt-5", APIKey: "sk-a", IsNativeKey: true})
	body, _ = getTokenUsage(t, h, "?days=1")
	if len(body.Rows) != 1 || body.Rows[0].Account != "codex.json" || body.Rows[0].ClientKind != "removed" {
		t.Fatalf("without an auth manager the account falls back to the auth ID: %+v", body.Rows)
	}
}

func TestTokenUsageAccountsFallBackToAuthIndex(t *testing.T) {
	manager := registerTokenUsageTestAuths(t)
	auth, ok := manager.GetByID("codex-user@example.com.json")
	if !ok || auth.Index == "" {
		t.Fatalf("expected a registered auth with an index: %+v", auth)
	}
	accounts := newTokenUsageAccounts(manager)
	if got := accounts.label("renamed.json", auth.Index); got != "user@example.com" {
		t.Fatalf("label by auth index = %q", got)
	}
	if got := accounts.label("missing.json", "missing-index"); got != "missing.json" {
		t.Fatalf("unknown credential should fall back to its auth ID, got %q", got)
	}
	if got := accounts.label("", ""); got != "" {
		t.Fatalf("empty credential should have an empty label, got %q", got)
	}
}

func TestTokenUsageAccountLabelNeverReturnsSecrets(t *testing.T) {
	cases := []struct {
		name string
		auth *coreauth.Auth
		want string
	}{
		{"nil", nil, ""},
		{"oauth label then file name", &coreauth.Auth{ID: "x", FileName: "kimi.json", Label: "Kimi User", Metadata: map[string]any{"access_token": "tok-123456"}}, "Kimi User"},
		{"file name", &coreauth.Auth{ID: "x", FileName: "kimi.json"}, "kimi.json"},
		{"service account email", &coreauth.Auth{ID: "x", Metadata: map[string]any{"refresh_token": "rt-0123456789", "service_account": map[string]any{"client_email": "sa@project.iam"}}}, "sa@project.iam"},
		{"label equal to access token", &coreauth.Auth{ID: "x", FileName: "f.json", Label: "tok-abcdefgh", Metadata: map[string]any{"access_token": "tok-abcdefgh"}}, "f.json"},
		{"short api key", &coreauth.Auth{ID: "x", Attributes: map[string]string{"api_key": "abc"}}, ""},
		{"api key without host", &coreauth.Auth{ID: "x", Attributes: map[string]string{"api_key": "sk-abcdefghijcd"}}, "sk-ab…cd"},
		{"host without scheme", &coreauth.Auth{ID: "x", Attributes: map[string]string{"api_key": "sk-abcdefghijcd", "base_url": "api.example.com/v1"}}, "api.example.com · sk-ab…cd"},
	}
	for _, tc := range cases {
		got := tokenUsageAccountLabel(tc.auth)
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
		for _, secret := range tokenUsageAuthSecrets(tc.auth) {
			if strings.Contains(got, secret) {
				t.Errorf("%s: label %q contains secret %q", tc.name, got, secret)
			}
		}
	}
}
