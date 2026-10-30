package management

import (
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keylimit"
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

// GetServerNetwork reports the listen address and the URLs other devices on the LAN can use.
func (h *Handler) GetServerNetwork(c *gin.Context) {
	cfg := h.configSnapshot()
	host, port := "", 0
	if cfg != nil {
		host, port = strings.TrimSpace(cfg.Host), cfg.Port
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

// lanAddresses lists private IPv4 addresses reachable from the local network.
// A specific bind host is returned as-is.
func lanAddresses(host string) []string {
	trimmed := strings.Trim(host, "[]")
	if ip := net.ParseIP(trimmed); ip != nil && !ip.IsUnspecified() {
		return []string{trimmed}
	}
	interfaceAddrs, errAddrs := net.InterfaceAddrs()
	if errAddrs != nil {
		return nil
	}
	var out []string
	for _, addr := range interfaceAddrs {
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
	sort.Strings(out)
	return out
}
