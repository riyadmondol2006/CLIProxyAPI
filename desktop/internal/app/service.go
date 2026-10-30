package app

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// ServiceStatus is the systemd view of the proxy service.
type ServiceStatus struct {
	// Available is false when systemd user services cannot be used (for example in a container).
	Available bool `json:"available"`
	// Installed is false when the unit file is missing.
	Installed bool   `json:"installed"`
	Active    string `json:"active"`  // active, inactive, failed, activating, ...
	Enabled   string `json:"enabled"` // enabled, disabled, ...
	Error     string `json:"error,omitempty"`
}

// Service controls the proxy service.
type Service interface {
	Status(ctx context.Context) ServiceStatus
	// Do runs start, stop, or restart. Start also enables the unit so it runs at login.
	Do(ctx context.Context, action string) error
}

// Runner executes a command and returns its combined output.
type Runner func(ctx context.Context, name string, args ...string) ([]byte, error)

func execRunner(ctx context.Context, name string, args ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, args...).CombinedOutput()
}

// SystemdUser controls ServiceName through `systemctl --user`.
type SystemdUser struct {
	Run Runner
}

// NewSystemdUser returns a controller that runs the real systemctl.
func NewSystemdUser() *SystemdUser { return &SystemdUser{Run: execRunner} }

const systemctlTimeout = 20 * time.Second

func (s *SystemdUser) systemctl(ctx context.Context, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, systemctlTimeout)
	defer cancel()
	return s.Run(ctx, "systemctl", append([]string{"--user"}, args...)...)
}

// Status implements Service.
func (s *SystemdUser) Status(ctx context.Context) ServiceStatus {
	out, errShow := s.systemctl(ctx, "show", ServiceName,
		"--property=LoadState,ActiveState,UnitFileState")
	if errShow != nil {
		return ServiceStatus{Error: strings.TrimSpace(string(out))}
	}
	props := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(out))
	for scanner.Scan() {
		key, value, ok := strings.Cut(scanner.Text(), "=")
		if ok {
			props[key] = value
		}
	}
	return ServiceStatus{
		Available: true,
		Installed: props["LoadState"] == "loaded",
		Active:    props["ActiveState"],
		Enabled:   props["UnitFileState"],
	}
}

// Do implements Service.
func (s *SystemdUser) Do(ctx context.Context, action string) error {
	var args []string
	switch action {
	case "start":
		args = []string{"enable", "--now", ServiceName}
	case "stop":
		args = []string{"stop", ServiceName}
	case "restart":
		args = []string{"restart", ServiceName}
	default:
		return fmt.Errorf("unknown service action %q", action)
	}
	if out, errRun := s.systemctl(ctx, args...); errRun != nil {
		return fmt.Errorf("systemctl %s: %s", strings.Join(args, " "), strings.TrimSpace(string(out)))
	}
	return nil
}
