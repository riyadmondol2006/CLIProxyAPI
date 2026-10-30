package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keylimit"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
)

type staticKeyProvider struct{ provider string }

func (p staticKeyProvider) Identifier() string { return p.provider }

func (p staticKeyProvider) Authenticate(_ context.Context, r *http.Request) (*sdkaccess.Result, *sdkaccess.AuthError) {
	key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return &sdkaccess.Result{Provider: p.provider, Principal: key}, nil
}

func newLimitTestEngine(provider string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	manager := sdkaccess.NewManager()
	manager.SetProviders([]sdkaccess.Provider{staticKeyProvider{provider: provider}})
	engine := gin.New()
	engine.Use(AuthMiddleware(manager))
	engine.GET("/v1/models", func(c *gin.Context) { c.Status(http.StatusOK) })
	return engine
}

func doLimitRequest(engine *gin.Engine, key string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	engine.ServeHTTP(recorder, req)
	return recorder
}

func TestAuthMiddlewareEnforcesAPIKeyLimits(t *testing.T) {
	tracker := keylimit.Default()
	t.Cleanup(func() {
		tracker.Reset("sk-limited")
		tracker.Configure(nil, nil)
	})
	tracker.Configure([]string{"sk-limited", "sk-off", "sk-free"}, []config.APIKeyLimit{
		{APIKey: "sk-limited", TokenLimit: 10, Period: config.APIKeyLimitPeriodTotal},
		{APIKey: "sk-off", Disabled: true},
	})
	engine := newLimitTestEngine(sdkaccess.DefaultAccessProviderName)

	if code := doLimitRequest(engine, "sk-limited").Code; code != http.StatusOK {
		t.Fatalf("key under its limit: got %d", code)
	}
	tracker.Record("sk-limited", 10, true)
	recorder := doLimitRequest(engine, "sk-limited")
	if recorder.Code != http.StatusTooManyRequests {
		t.Fatalf("key over its limit: got %d", recorder.Code)
	}
	var body struct {
		Error struct {
			Type string `json:"type"`
			Code string `json:"code"`
		} `json:"error"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
		t.Fatalf("decode body: %v", errDecode)
	}
	if body.Error.Type != "insufficient_quota" || body.Error.Code != "api_key_token_limit_exceeded" {
		t.Fatalf("unexpected error body: %s", recorder.Body.String())
	}

	if code := doLimitRequest(engine, "sk-off").Code; code != http.StatusForbidden {
		t.Fatalf("disabled key: got %d", code)
	}
	if code := doLimitRequest(engine, "sk-free").Code; code != http.StatusOK {
		t.Fatalf("key without limits: got %d", code)
	}
}

func TestAuthMiddlewareIgnoresLimitsForPluginProviders(t *testing.T) {
	tracker := keylimit.Default()
	t.Cleanup(func() { tracker.Configure(nil, nil) })
	tracker.Configure([]string{"sk-off"}, []config.APIKeyLimit{{APIKey: "sk-off", Disabled: true}})
	engine := newLimitTestEngine("some-plugin")
	if code := doLimitRequest(engine, "sk-off").Code; code != http.StatusOK {
		t.Fatalf("plugin-authenticated principal must not use config key limits: got %d", code)
	}
}
