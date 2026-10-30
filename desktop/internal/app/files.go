package app

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// maxSaveBytes bounds files the UI asks the app to save (credentials, logs, config).
const maxSaveBytes = 512 << 20

// SafeFileName reduces a UI-supplied name to a plain file name.
func SafeFileName(name string) string {
	name = strings.TrimSpace(filepath.Base(strings.ReplaceAll(name, "\\", "/")))
	name = strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, name)
	if name == "" || name == "." || name == ".." || name == "/" {
		return "download"
	}
	return name
}

// DownloadsDir returns the user's Downloads folder (XDG), falling back to ~/Downloads.
func DownloadsDir() string {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if out, errRun := exec.CommandContext(ctx, "xdg-user-dir", "DOWNLOAD").Output(); errRun == nil {
		if dir := strings.TrimSpace(string(out)); dir != "" {
			if info, errStat := os.Stat(dir); errStat == nil && info.IsDir() {
				return dir
			}
		}
	}
	home, errHome := os.UserHomeDir()
	if errHome != nil {
		return os.TempDir()
	}
	return filepath.Join(home, "Downloads")
}

// WriteUnique writes data into dir as name, adding " (1)", " (2)", … when the name is taken.
// The file is private to the user because downloads include credential files.
func WriteUnique(dir, name string, data []byte) (string, error) {
	if errMkdir := os.MkdirAll(dir, 0o755); errMkdir != nil {
		return "", fmt.Errorf("create %s: %w", dir, errMkdir)
	}
	name = SafeFileName(name)
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 0; i < 1000; i++ {
		candidate := name
		if i > 0 {
			candidate = fmt.Sprintf("%s (%d)%s", stem, i, ext)
		}
		path := filepath.Join(dir, candidate)
		file, errOpen := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
		if errors.Is(errOpen, os.ErrExist) {
			continue
		}
		if errOpen != nil {
			return "", fmt.Errorf("create %s: %w", path, errOpen)
		}
		_, errWrite := file.Write(data)
		errClose := file.Close()
		if errWrite != nil {
			return "", fmt.Errorf("write %s: %w", path, errWrite)
		}
		if errClose != nil {
			return "", fmt.Errorf("close %s: %w", path, errClose)
		}
		return path, nil
	}
	return "", fmt.Errorf("no free file name for %s in %s", name, dir)
}
