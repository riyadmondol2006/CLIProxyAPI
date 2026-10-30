//go:build unix

package app

import (
	"fmt"
	"os/exec"
	"syscall"

	log "github.com/sirupsen/logrus"
)

// startDetached starts a command in its own session so it keeps running after the app quits.
func startDetached(name string, args ...string) error {
	cmd := exec.Command(name, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if errStart := cmd.Start(); errStart != nil {
		return fmt.Errorf("start %s: %w", name, errStart)
	}
	if errRelease := cmd.Process.Release(); errRelease != nil {
		log.WithError(errRelease).Debug("release detached process")
	}
	return nil
}
