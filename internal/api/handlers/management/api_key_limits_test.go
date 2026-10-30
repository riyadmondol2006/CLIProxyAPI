package management

import (
	"encoding/json"
	"net"
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

func TestOrderLANAddressesSkipsVirtualBridgesAndPutsPrimaryFirst(t *testing.T) {
	ipNet := func(cidr string) net.Addr {
		ip, network, errParse := net.ParseCIDR(cidr)
		if errParse != nil {
			t.Fatalf("parse %s: %v", cidr, errParse)
		}
		network.IP = ip
		return network
	}
	byInterface := map[string][]net.Addr{
		"eth0":       {ipNet("192.168.0.30/24"), ipNet("fe80::1/64")},
		"wlan0":      {ipNet("10.0.0.5/24")},
		"vmnet1":     {ipNet("192.168.79.1/24")},
		"vmnet8":     {ipNet("192.168.126.1/24")},
		"virbr0":     {ipNet("192.168.122.1/24")},
		"docker0":    {ipNet("172.17.0.1/16")},
		"podman1":    {ipNet("10.89.0.1/24")},
		"tailscale0": {ipNet("100.121.233.30/32")},
	}
	got := orderLANAddresses(byInterface, "192.168.0.30")
	want := []string{"192.168.0.30", "10.0.0.5"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("orderLANAddresses() = %v, want %v", got, want)
	}
	if got = orderLANAddresses(byInterface, ""); len(got) != 2 || got[0] != "10.0.0.5" {
		t.Fatalf("without a default route the order must be lexical, got %v", got)
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
