package api

import (
	"testing"

	proxyconfig "github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestLocalManagementPasswordKeepsManagementEnabledAcrossReload(t *testing.T) {
	server := newTestServerWithConfig(t, &proxyconfig.Config{}, WithLocalManagementPassword("local-token"))
	if !server.managementRoutesEnabled.Load() {
		t.Fatal("management routes should be enabled by a local password")
	}
	server.UpdateClients(&proxyconfig.Config{})
	if !server.managementRoutesEnabled.Load() {
		t.Fatal("a config reload without a secret key must not disable local management")
	}
}
