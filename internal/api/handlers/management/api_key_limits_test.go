package management

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
)

func TestHostListensOnLAN(t *testing.T) {
	cases := map[string]bool{
		"": true, "0.0.0.0": true, "::": true, "[::]": true,
		"127.0.0.1": false, "localhost": false, "::1": false,
		"192.168.1.20": true,
	}
	for host, want := range cases {
		if got := hostListensOnLAN(host); got != want {
			t.Errorf("hostListensOnLAN(%q) = %v, want %v", host, got, want)
		}
	}
}

func TestLANAddressesUsesSpecificBindHost(t *testing.T) {
	got := lanAddresses("192.168.1.20")
	if len(got) != 1 || got[0] != "192.168.1.20" {
		t.Fatalf("expected the bind host only, got %v", got)
	}
	for _, address := range lanAddresses("") {
		if address == "127.0.0.1" {
			t.Fatal("loopback must not be listed as a LAN address")
		}
	}
}

func TestServerNetworkReportsBoundAddressUntilRestart(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := NewHandlerWithoutConfigFilePath(&config.Config{Host: "127.0.0.1", Port: 8317}, nil)
	read := func() map[string]any {
		recorder := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(recorder)
		c.Request = httptest.NewRequest(http.MethodGet, "/v8/management/server/network", nil)
		h.GetServerNetwork(c)
		var body map[string]any
		if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
			t.Fatalf("decode: %v", errDecode)
		}
		return body
	}
	if body := read(); body["lan-enabled"] != false || body["restart-required"] != false {
		t.Fatalf("unexpected startup state: %v", body)
	}
	// Allowing LAN access edits the config, but the server stays bound to 127.0.0.1.
	h.SetConfig(&config.Config{Host: "", Port: 8317})
	body := read()
	if body["lan-enabled"] != false || body["host"] != "127.0.0.1" {
		t.Fatalf("network must report the bound address, got %v", body)
	}
	if body["restart-required"] != true || body["configured-host"] != "" {
		t.Fatalf("pending host change must be reported, got %v", body)
	}
}
