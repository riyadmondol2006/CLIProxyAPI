package app

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

const defaultPort = 8317

// defaultConfig is written on first run. The proxy listens on localhost only, the
// browser panel is off (the app is the UI), and management is reachable only with
// the local token the service writes for the app.
const defaultConfig = `# CLIProxyAPI configuration created by the desktop app.
# Every option is documented in /usr/share/cliproxyapi/config.example.yaml
config-version: 8

server:
  # "127.0.0.1" = this computer only. Use "" to let other devices on your network connect.
  host: "127.0.0.1"
  port: 8317

management:
  allow-remote: false
  # Empty: no management password. The desktop app uses a local token instead.
  secret-key: ""
  # The desktop app replaces the browser panel.
  disable-control-panel: true

access:
  # Keys your apps send to the proxy. Manage them in the app under Access Keys.
  api-keys:
    - "%s"
`

// EnsureConfig creates the config file with a fresh client key when it does not exist.
// It reports whether a new file was written.
func EnsureConfig(path string) (bool, error) {
	if _, errStat := os.Stat(path); errStat == nil {
		return false, nil
	} else if !errors.Is(errStat, os.ErrNotExist) {
		return false, fmt.Errorf("check config: %w", errStat)
	}
	key, errKey := newClientKey()
	if errKey != nil {
		return false, errKey
	}
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o700); errMkdir != nil {
		return false, fmt.Errorf("create config directory: %w", errMkdir)
	}
	file, errOpen := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errOpen != nil {
		if errors.Is(errOpen, os.ErrExist) {
			return false, nil
		}
		return false, fmt.Errorf("create config: %w", errOpen)
	}
	_, errWrite := fmt.Fprintf(file, defaultConfig, key)
	errClose := file.Close()
	if errWrite != nil {
		return false, fmt.Errorf("write config: %w", errWrite)
	}
	if errClose != nil {
		return false, fmt.Errorf("close config: %w", errClose)
	}
	return true, nil
}

func newClientKey() (string, error) {
	buf := make([]byte, 20)
	if _, errRead := rand.Read(buf); errRead != nil {
		return "", fmt.Errorf("generate client key: %w", errRead)
	}
	return "sk-" + hex.EncodeToString(buf), nil
}

// Listen is the proxy's listen address as read from its config.
type Listen struct {
	Host string `json:"host"`
	Port int    `json:"port"`
}

// ReadListen reads server.host and server.port, accepting the legacy top-level keys too.
func ReadListen(path string) Listen {
	listen := Listen{Port: defaultPort}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		return listen
	}
	var doc struct {
		Host   *string `yaml:"host"`
		Port   *int    `yaml:"port"`
		Server struct {
			Host *string `yaml:"host"`
			Port *int    `yaml:"port"`
		} `yaml:"server"`
	}
	if errDecode := yaml.Unmarshal(data, &doc); errDecode != nil {
		return listen
	}
	switch {
	case doc.Server.Host != nil:
		listen.Host = *doc.Server.Host
	case doc.Host != nil:
		listen.Host = *doc.Host
	}
	switch {
	case doc.Server.Port != nil && *doc.Server.Port > 0:
		listen.Port = *doc.Server.Port
	case doc.Port != nil && *doc.Port > 0:
		listen.Port = *doc.Port
	}
	return listen
}

// ReadToken returns the current local management token, or "" when the service has not written one.
func ReadToken(path string) string {
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		return ""
	}
	return strings.TrimSpace(string(data))
}
