package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	proxyconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	sdkaccess "github.com/router-for-me/CLIProxyAPI/v8/sdk/access"
	sdkconfig "github.com/router-for-me/CLIProxyAPI/v8/sdk/config"
)

func doRequireKeyRequest(server *Server, key string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	if key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	server.engine.ServeHTTP(recorder, req)
	return recorder
}

func requireKeyErrorMessage(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
		t.Fatalf("decode body %q: %v", recorder.Body.String(), errDecode)
	}
	return body.Error
}

func TestRequireAPIKeyFollowsConfigReload(t *testing.T) {
	t.Cleanup(func() { sdkaccess.UnregisterProvider(sdkaccess.AccessProviderTypeConfigAPIKey) })
	sdkaccess.UnregisterProvider(sdkaccess.AccessProviderTypeConfigAPIKey)

	server := newTestServerWithConfig(t, &proxyconfig.Config{SDKConfig: sdkconfig.SDKConfig{RequireAPIKey: true}})

	recorder := doRequireKeyRequest(server, "")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("no keys configured: status = %d, want 401", recorder.Code)
	}
	if got := requireKeyErrorMessage(t, recorder); got != noClientAPIKeysMessage {
		t.Fatalf("no keys configured: error = %q", got)
	}
	if recorder := doRequireKeyRequest(server, "anything"); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("no keys configured with a key header: status = %d, want 401", recorder.Code)
	}

	// Management routes and the root endpoint are not behind the access middleware.
	rootRecorder := httptest.NewRecorder()
	server.engine.ServeHTTP(rootRecorder, httptest.NewRequest(http.MethodGet, "/", nil))
	if rootRecorder.Code == http.StatusUnauthorized {
		t.Fatalf("root endpoint must not require a client key")
	}

	// A key added later works without a restart.
	withKey := &proxyconfig.Config{SDKConfig: sdkconfig.SDKConfig{RequireAPIKey: true, APIKeys: []string{"client-key"}}}
	server.UpdateClients(withKey)
	if recorder := doRequireKeyRequest(server, "client-key"); recorder.Code != http.StatusOK {
		t.Fatalf("valid key after reload: status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	recorder = doRequireKeyRequest(server, "")
	if recorder.Code != http.StatusUnauthorized || requireKeyErrorMessage(t, recorder) != "Missing API key" {
		t.Fatalf("missing key after reload: status = %d, body = %s", recorder.Code, recorder.Body.String())
	}
	recorder = doRequireKeyRequest(server, "wrong")
	if recorder.Code != http.StatusUnauthorized || requireKeyErrorMessage(t, recorder) != "Invalid API key" {
		t.Fatalf("invalid key after reload: status = %d, body = %s", recorder.Code, recorder.Body.String())
	}

	// Removing the keys closes access again; turning the option off reopens it.
	server.UpdateClients(&proxyconfig.Config{SDKConfig: sdkconfig.SDKConfig{RequireAPIKey: true}})
	if recorder := doRequireKeyRequest(server, ""); recorder.Code != http.StatusUnauthorized {
		t.Fatalf("keys removed: status = %d, want 401", recorder.Code)
	}
	server.UpdateClients(&proxyconfig.Config{})
	if recorder := doRequireKeyRequest(server, ""); recorder.Code != http.StatusOK {
		t.Fatalf("option disabled: status = %d, want 200, body = %s", recorder.Code, recorder.Body.String())
	}
}

func TestRequireAPIKeyDisabledKeepsOpenAccess(t *testing.T) {
	t.Cleanup(func() { sdkaccess.UnregisterProvider(sdkaccess.AccessProviderTypeConfigAPIKey) })
	sdkaccess.UnregisterProvider(sdkaccess.AccessProviderTypeConfigAPIKey)

	server := newTestServerWithConfig(t, &proxyconfig.Config{})
	if recorder := doRequireKeyRequest(server, ""); recorder.Code != http.StatusOK {
		t.Fatalf("no keys, option off: status = %d, want 200", recorder.Code)
	}
}

func TestAccessAuthMiddlewareRequireAPIKey(t *testing.T) {
	gin.SetMode(gin.TestMode)
	require := func() bool { return true }

	newEngine := func(manager *sdkaccess.Manager, realtime bool, requireAPIKey func() bool) *gin.Engine {
		engine := gin.New()
		engine.Use(accessAuthMiddleware(manager, realtime, requireAPIKey))
		engine.GET("/v1/models", func(c *gin.Context) { c.Status(http.StatusOK) })
		return engine
	}
	serve := func(engine *gin.Engine, key string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/v1/models", nil)
		if key != "" {
			req.Header.Set("Authorization", "Bearer "+key)
		}
		engine.ServeHTTP(recorder, req)
		return recorder
	}

	for _, manager := range []*sdkaccess.Manager{nil, sdkaccess.NewManager()} {
		if code := serve(newEngine(manager, false, nil), "").Code; code != http.StatusOK {
			t.Fatalf("without option: status = %d, want 200", code)
		}
		if code := serve(newEngine(manager, false, func() bool { return false }), "").Code; code != http.StatusOK {
			t.Fatalf("option false: status = %d, want 200", code)
		}
		if code := serve(newEngine(manager, false, require), "").Code; code != http.StatusUnauthorized {
			t.Fatalf("option true, no providers: status = %d, want 401", code)
		}
	}

	recorder := serve(newEngine(sdkaccess.NewManager(), true, require), "")
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("realtime: status = %d, want 401", recorder.Code)
	}
	var body struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
		t.Fatalf("decode realtime body: %v", errDecode)
	}
	if body.Error.Message != noClientAPIKeysMessage || body.Error.Type != "authentication_error" || body.Error.Code != "invalid_api_key" {
		t.Fatalf("unexpected realtime body: %s", recorder.Body.String())
	}

	manager := sdkaccess.NewManager()
	manager.SetProviders([]sdkaccess.Provider{staticKeyProvider{provider: "plugin-auth"}})
	if code := serve(newEngine(manager, false, require), "client-key").Code; code != http.StatusOK {
		t.Fatalf("authenticated request: status = %d, want 200", code)
	}
}
