package management

import "testing"

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
