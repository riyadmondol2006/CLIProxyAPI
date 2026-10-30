package app

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// MinimizedFlag starts the window minimized; the autostart entry passes it.
const MinimizedFlag = "--minimized"

// AutostartEnabled reports whether the XDG autostart entry exists and is not switched off.
func AutostartEnabled(path string) bool {
	file, errOpen := os.Open(path)
	if errOpen != nil {
		return false
	}
	defer func() {
		if errClose := file.Close(); errClose != nil {
			return
		}
	}()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.ToLower(strings.ReplaceAll(scanner.Text(), " ", ""))
		if line == "hidden=true" || line == "x-gnome-autostart-enabled=false" {
			return false
		}
	}
	return true
}

// SetAutostart writes or removes the XDG autostart entry that opens the app at login.
func SetAutostart(path, executable string, enabled bool) error {
	if !enabled {
		if errRemove := os.Remove(path); errRemove != nil && !errors.Is(errRemove, os.ErrNotExist) {
			return fmt.Errorf("remove autostart entry: %w", errRemove)
		}
		return nil
	}
	if strings.TrimSpace(executable) == "" {
		return errors.New("the app's location is unknown")
	}
	entry := strings.Join([]string{
		"[Desktop Entry]",
		"Type=Application",
		"Name=CLIProxyAPI",
		"Comment=Open the CLIProxyAPI app at login",
		fmt.Sprintf("Exec=%s %s", quoteExec(executable), MinimizedFlag),
		"Icon=cliproxyapi",
		"Terminal=false",
		"X-GNOME-Autostart-enabled=true",
		"",
	}, "\n")
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o755); errMkdir != nil {
		return fmt.Errorf("create autostart directory: %w", errMkdir)
	}
	tmp := path + ".tmp"
	if errWrite := os.WriteFile(tmp, []byte(entry), 0o644); errWrite != nil {
		return fmt.Errorf("write autostart entry: %w", errWrite)
	}
	if errRename := os.Rename(tmp, path); errRename != nil {
		return fmt.Errorf("save autostart entry: %w", errRename)
	}
	return nil
}

// quoteExec quotes an executable path for a desktop entry Exec key when it needs it.
func quoteExec(path string) string {
	if !strings.ContainsAny(path, " \t\"'\\$`") {
		return path
	}
	escaped := strings.NewReplacer(`\`, `\\`, `"`, `\"`, "`", "\\`", "$", `\$`).Replace(path)
	return `"` + escaped + `"`
}
