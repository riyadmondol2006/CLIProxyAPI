// Package app holds the desktop app's backend: first-run setup, service control,
// and the HTTP handler that serves the UI and forwards API calls to the proxy service.
package app

import (
	"os"
	"path/filepath"
	"strconv"
)

// ServiceName is the systemd user unit shipped by the packages.
const ServiceName = "cliproxyapi.service"

// Paths are the files shared between the desktop app and the proxy service.
// They must match packaging/linux/cliproxyapi.service.
type Paths struct {
	ConfigDir string
	Config    string
	Token     string
	// Autostart is the XDG autostart entry that opens the app at login.
	Autostart string
}

// DefaultPaths resolves paths from the XDG environment the same way systemd does
// for the %E (config) and %t (runtime) specifiers of user units.
func DefaultPaths() Paths {
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		if home, errHome := os.UserHomeDir(); errHome == nil {
			configHome = filepath.Join(home, ".config")
		}
	}
	runtimeDir := os.Getenv("XDG_RUNTIME_DIR")
	if runtimeDir == "" {
		runtimeDir = filepath.Join(os.TempDir(), "cliproxyapi-"+strconv.Itoa(os.Getuid()))
	}
	configDir := filepath.Join(configHome, "cliproxyapi")
	return Paths{
		ConfigDir: configDir,
		Config:    filepath.Join(configDir, "config.yaml"),
		Token:     filepath.Join(runtimeDir, "cliproxyapi", "management-token"),
		Autostart: filepath.Join(configHome, "autostart", "cliproxyapi.desktop"),
	}
}
