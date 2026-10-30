package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAPIKeyLimitsV8RoundTrip(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	data := `config-version: 8
access:
  api-keys:
    - "sk-friend"
  key-limits:
    - api-key: "sk-friend"
      name: "Alice laptop"
      token-limit: 500000
      period: daily
`
	if errWrite := os.WriteFile(path, []byte(data), 0o600); errWrite != nil {
		t.Fatalf("write config: %v", errWrite)
	}
	cfg, errLoad := LoadConfig(path)
	if errLoad != nil {
		t.Fatalf("load config: %v", errLoad)
	}
	if len(cfg.APIKeyLimits) != 1 {
		t.Fatalf("expected 1 key limit, got %d", len(cfg.APIKeyLimits))
	}
	limit := cfg.APIKeyLimits[0]
	if limit.APIKey != "sk-friend" || limit.Name != "Alice laptop" || limit.TokenLimit != 500000 || limit.NormalizedPeriod() != APIKeyLimitPeriodDaily {
		t.Fatalf("unexpected limit: %+v", limit)
	}

	cfg.APIKeyLimits[0].TokenLimit = 1000
	if errSave := SaveConfigPreserveComments(path, cfg); errSave != nil {
		t.Fatalf("save config: %v", errSave)
	}
	saved, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read config: %v", errRead)
	}
	text := string(saved)
	if strings.Contains(text, "api-key-limits") {
		t.Fatalf("legacy key written to v8 config:\n%s", text)
	}
	if !strings.Contains(text, "key-limits:") || !strings.Contains(text, "token-limit: 1000") {
		t.Fatalf("key limits not saved under access:\n%s", text)
	}
}

func TestAPIKeyLimitNormalizedPeriod(t *testing.T) {
	cases := map[string]string{"": "monthly", "DAILY": "daily", "weekly": "weekly", "total": "total", "bogus": "monthly"}
	for input, want := range cases {
		if got := (APIKeyLimit{Period: input}).NormalizedPeriod(); got != want {
			t.Errorf("period %q: got %q want %q", input, got, want)
		}
	}
}
