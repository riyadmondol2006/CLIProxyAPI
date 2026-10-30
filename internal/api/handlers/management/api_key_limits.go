package management

import (
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keylimit"
	log "github.com/sirupsen/logrus"
)

// GetAPIKeyLimitUsage returns current-period usage and limits for every client API key.
func (h *Handler) GetAPIKeyLimitUsage(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"keys": keylimit.Default().Snapshot()})
}

// ResetAPIKeyLimitUsage clears the current-period counters for one client API key.
func (h *Handler) ResetAPIKeyLimitUsage(c *gin.Context) {
	var body struct {
		APIKey string `json:"api-key"`
	}
	if errBind := c.ShouldBindJSON(&body); errBind != nil || strings.TrimSpace(body.APIKey) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "api-key is required"})
		return
	}
	reset := keylimit.Default().Reset(body.APIKey)
	if errFlush := keylimit.Default().Flush(); errFlush != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": fmt.Sprintf("failed to save usage: %v", errFlush)})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok", "reset": reset})
}

// GetServerNetwork reports the address the server is listening on, the URLs other devices on
// the LAN can use, and whether a host or port change in the config is waiting for a restart.
func (h *Handler) GetServerNetwork(c *gin.Context) {
	cfg := h.configSnapshot()
	host, port := h.listenHost, h.listenPort
	configuredHost, configuredPort := host, port
	if cfg != nil {
		configuredHost, configuredPort = strings.TrimSpace(cfg.Host), cfg.Port
	}
	scheme := "http"
	if cfg != nil && cfg.TLS.Enable {
		scheme = "https"
	}
	lanEnabled := hostListensOnLAN(host)
	urls := []string{}
	if lanEnabled && port > 0 {
		for _, address := range lanAddresses(host) {
			urls = append(urls, fmt.Sprintf("%s://%s", scheme, net.JoinHostPort(address, fmt.Sprint(port))))
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"host":        host,
		"port":        port,
		"scheme":      scheme,
		"lan-enabled": lanEnabled,
		"lan-urls":    urls,
		// The config's values, which apply after the next restart.
		"configured-host":  configuredHost,
		"configured-port":  configuredPort,
		"restart-required": configuredHost != host || configuredPort != port,
	})
}

// hostListensOnLAN reports whether a bind host accepts connections from other machines.
func hostListensOnLAN(host string) bool {
	switch strings.ToLower(strings.Trim(host, "[]")) {
	case "", "0.0.0.0", "::":
		return true
	case "localhost":
		return false
	}
	ip := net.ParseIP(strings.Trim(host, "[]"))
	return ip != nil && !ip.IsLoopback()
}

// virtualInterfacePrefixes name the bridges of local VMs and containers. Their addresses
// are host-only, so other devices on the network cannot use them.
var virtualInterfacePrefixes = []string{
	"br-", "cni", "docker", "flannel", "lxcbr", "lxdbr", "podman", "vboxnet", "veth", "virbr", "vmnet",
}

func isVirtualInterface(name string) bool {
	name = strings.ToLower(name)
	for _, prefix := range virtualInterfacePrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

// lanAddresses lists private IPv4 addresses reachable from the local network, the one on the
// default route first. A specific bind host is returned as-is.
func lanAddresses(host string) []string {
	trimmed := strings.Trim(host, "[]")
	if ip := net.ParseIP(trimmed); ip != nil && !ip.IsUnspecified() {
		return []string{trimmed}
	}
	interfaces, errInterfaces := net.Interfaces()
	if errInterfaces != nil {
		return nil
	}
	byInterface := make(map[string][]net.Addr, len(interfaces))
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, errAddrs := iface.Addrs()
		if errAddrs != nil {
			continue
		}
		byInterface[iface.Name] = addrs
	}
	return orderLANAddresses(byInterface, defaultRouteIPv4())
}

// orderLANAddresses keeps the private IPv4 addresses of non-virtual interfaces, sorted with
// primary first.
func orderLANAddresses(byInterface map[string][]net.Addr, primary string) []string {
	var out []string
	for name, addrs := range byInterface {
		if isVirtualInterface(name) {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil || ip.IsLoopback() || !ip.IsPrivate() {
				continue
			}
			out = append(out, ip.String())
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if (out[i] == primary) != (out[j] == primary) {
			return out[i] == primary
		}
		return out[i] < out[j]
	})
	return out
}

// defaultRouteIPv4 returns this machine's source address for the default route, or "".
// Connecting a UDP socket only selects a route; no packet is sent.
func defaultRouteIPv4() string {
	conn, errDial := net.Dial("udp4", "192.0.2.1:9")
	if errDial != nil {
		return ""
	}
	defer func() {
		if errClose := conn.Close(); errClose != nil {
			log.WithError(errClose).Debug("close route probe")
		}
	}()
	if addr, ok := conn.LocalAddr().(*net.UDPAddr); ok {
		return addr.IP.String()
	}
	return ""
}
