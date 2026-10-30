package management

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

// The Access Keys page creates and deletes a key with one PATCH of the access section,
// so api-keys and key-limits can never be saved half-way.
func TestConfigV8PatchAccessUpdatesKeysAndLimitsTogether(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	raw := `config-version: 8
server:
  port: 8317
access:
  # Shared with friends
  api-keys:
    - sk-owner
    - sk-old
  key-limits:
    - api-key: sk-old
      name: Old laptop
      token-limit: 100
      period: daily
`
	if errWrite := os.WriteFile(path, []byte(raw), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	cfg, errLoad := config.LoadConfig(path)
	if errLoad != nil {
		t.Fatal(errLoad)
	}
	h := &Handler{cfg: cfg, configFilePath: path}
	router := gin.New()
	router.PATCH("/v8/management/config/*path", h.ConfigV8)
	patch := func(body string) *config.Config {
		t.Helper()
		recorder := httptest.NewRecorder()
		router.ServeHTTP(recorder, httptest.NewRequest(http.MethodPatch, "/v8/management/config/access", strings.NewReader(body)))
		if recorder.Code != http.StatusOK {
			t.Fatalf("PATCH access: status=%d body=%s", recorder.Code, recorder.Body.String())
		}
		saved, errLoadSaved := config.LoadConfig(path)
		if errLoadSaved != nil {
			t.Fatalf("load saved config: %v", errLoadSaved)
		}
		return saved
	}

	saved := patch(`{"api-keys":["sk-owner","sk-new"],"key-limits":[{"api-key":"sk-new","name":"Phone","token-limit":500,"period":"weekly"}]}`)
	if !slices.Equal(saved.APIKeys, []string{"sk-owner", "sk-new"}) {
		t.Fatalf("api-keys = %v", saved.APIKeys)
	}
	want := []config.APIKeyLimit{{APIKey: "sk-new", Name: "Phone", TokenLimit: 500, Period: "weekly"}}
	if !slices.Equal(saved.APIKeyLimits, want) {
		t.Fatalf("key-limits = %+v, want %+v", saved.APIKeyLimits, want)
	}
	if saved.Port != 8317 {
		t.Fatalf("unrelated settings changed: port=%d", saved.Port)
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil || !strings.Contains(string(data), "# Shared with friends") {
		t.Fatalf("access comment was lost: %v\n%s", errRead, data)
	}

	// The access section is merged, so a field left out of the patch keeps its value.
	saved = patch(`{"api-keys":["sk-owner","sk-new","sk-third"]}`)
	if len(saved.APIKeys) != 3 || !slices.Equal(saved.APIKeyLimits, want) {
		t.Fatalf("partial patch changed other access fields: keys=%v limits=%+v", saved.APIKeys, saved.APIKeyLimits)
	}

	// Deleting the last limited key sends an empty limits list in the same write.
	saved = patch(`{"api-keys":["sk-owner","sk-third"],"key-limits":[]}`)
	if !slices.Equal(saved.APIKeys, []string{"sk-owner", "sk-third"}) || len(saved.APIKeyLimits) != 0 {
		t.Fatalf("delete patch: keys=%v limits=%+v", saved.APIKeys, saved.APIKeyLimits)
	}
}
