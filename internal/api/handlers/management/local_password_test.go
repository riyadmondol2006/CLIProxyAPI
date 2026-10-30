package management

import (
	"net/http"
	"testing"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestLocalPasswordWorksWithoutSecretKeyOnlyFromLocalhost(t *testing.T) {
	h := NewHandlerWithoutConfigFilePath(&config.Config{}, nil)
	h.SetLocalPassword("local-token")

	if ok, status, msg := h.AuthenticateManagementKey("127.0.0.1", true, "local-token"); !ok {
		t.Fatalf("local token from localhost rejected: %d %s", status, msg)
	}
	if ok, status, _ := h.AuthenticateManagementKey("127.0.0.1", true, "wrong"); ok || status != http.StatusUnauthorized {
		t.Fatalf("wrong token must be rejected with 401, got ok=%v status=%d", ok, status)
	}
	if ok, status, _ := h.AuthenticateManagementKey("192.168.1.9", false, "local-token"); ok || status != http.StatusForbidden {
		t.Fatalf("local token from another machine must be rejected with 403, got ok=%v status=%d", ok, status)
	}
}

func TestNoSecretAndNoLocalPasswordStillDisablesManagement(t *testing.T) {
	h := NewHandlerWithoutConfigFilePath(&config.Config{}, nil)
	if ok, status, _ := h.AuthenticateManagementKey("127.0.0.1", true, "anything"); ok || status != http.StatusForbidden {
		t.Fatalf("management without any secret must stay disabled, got ok=%v status=%d", ok, status)
	}
}
