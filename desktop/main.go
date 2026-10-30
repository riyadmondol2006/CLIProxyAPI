// Command cliproxyapi-desktop is the CLIProxyAPI desktop app. It shows the management
// UI in a native window and controls the proxy, which runs as a systemd user service.
package main

import (
	"context"
	"embed"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sync/atomic"

	"github.com/router-for-me/CLIProxyAPI/desktop/internal/app"
	"github.com/router-for-me/CLIProxyAPI/desktop/internal/claudeusage"
	log "github.com/sirupsen/logrus"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed build/appicon.png
var icon []byte

// version is set at build time with -ldflags "-X main.version=...".
var version = "dev"

// updateFeed is the release feed (latest.json) checked for updates. It is set at build time
// with -ldflags "-X main.updateFeed=..."; the CPA_UPDATE_FEED environment variable overrides it.
var updateFeed = app.DefaultUpdateFeed

func main() {
	paths := app.DefaultPaths()
	firstRun := false
	if created, errConfig := app.EnsureConfig(paths.Config); errConfig != nil {
		log.WithError(errConfig).Error("could not create the default config")
	} else if created {
		firstRun = true
		log.Infof("created %s", paths.Config)
	}

	startState := options.Normal
	if slices.Contains(os.Args[1:], app.MinimizedFlag) {
		startState = options.Minimised
	}
	executable, errExecutable := os.Executable()
	if errExecutable == nil {
		if resolved, errResolve := filepath.EvalSymlinks(executable); errResolve == nil {
			executable = resolved
		}
	} else {
		executable = ""
	}

	service := app.NewSystemdUser()
	var appCtx atomic.Pointer[context.Context]
	server := &app.Server{
		Paths:      paths,
		Service:    service,
		Version:    version,
		Executable: executable,
		UpdateFeed: app.ResolveUpdateFeed(updateFeed),
		Debug:      os.Getenv("CPA_DESKTOP_DEBUG") == "1",
		Quit: func() {
			if ctx := appCtx.Load(); ctx != nil {
				runtime.Quit(*ctx)
			}
		},
		SaveFile: func(name string, data []byte) (string, error) {
			ctx := appCtx.Load()
			if ctx == nil {
				return "", errors.New("the window is not ready")
			}
			path, errDialog := runtime.SaveFileDialog(*ctx, runtime.SaveDialogOptions{
				Title:                "Save file",
				DefaultDirectory:     app.DownloadsDir(),
				DefaultFilename:      name,
				CanCreateDirectories: true,
			})
			if errDialog != nil || path == "" {
				return "", errDialog
			}
			// The user picked this exact path in the dialog, so overwriting is intended.
			if errWrite := os.WriteFile(path, data, 0o600); errWrite != nil {
				return "", fmt.Errorf("save %s: %w", path, errWrite)
			}
			return path, nil
		},
		OpenURL: func(rawURL string) error {
			ctx := appCtx.Load()
			if ctx == nil {
				return errors.New("the window is not ready")
			}
			runtime.BrowserOpenURL(*ctx, rawURL)
			return nil
		},
	}

	usage, errUsage := claudeusage.New(filepath.Join(paths.ConfigDir, "claude-usage.db"), claudeusage.DefaultSources())
	if errUsage != nil {
		log.WithError(errUsage).Warn("Claude usage dashboard is unavailable")
	} else {
		server.ClaudeUsage = usage
	}

	dist, errSub := fs.Sub(assets, "frontend/dist")
	if errSub != nil {
		log.WithError(errSub).Error("embedded UI is missing")
		os.Exit(1)
	}

	errRun := wails.Run(&options.App{
		Title:            "CLIProxyAPI",
		Width:            1320,
		Height:           860,
		MinWidth:         980,
		MinHeight:        640,
		WindowStartState: startState,
		BackgroundColour: &options.RGBA{R: 33, G: 34, B: 44, A: 255}, // Dracula background (#21222c)
		AssetServer: &assetserver.Options{
			Assets:  dist,
			Handler: server,
		},
		OnStartup: func(ctx context.Context) {
			appCtx.Store(&ctx)
			go startService(ctx, service, firstRun)
			if usage != nil {
				usage.Start(ctx)
			}
		},
		OnShutdown: func(context.Context) {
			if usage == nil {
				return
			}
			if errClose := usage.Close(); errClose != nil {
				log.WithError(errClose).Warn("close Claude usage")
			}
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "me.router-for.cliproxyapi.desktop",
			OnSecondInstanceLaunch: func(options.SecondInstanceData) {
				if ctx := appCtx.Load(); ctx != nil {
					runtime.WindowUnminimise(*ctx)
					runtime.WindowShow(*ctx)
				}
			},
		},
		Linux: &linux.Options{
			Icon:             icon,
			ProgramName:      "cliproxyapi",
			WebviewGpuPolicy: linux.WebviewGpuPolicyOnDemand,
		},
	})
	if errRun != nil {
		log.WithError(errRun).Error("desktop app failed")
		os.Exit(1)
	}
}

// startService starts the installed proxy service when it is not running yet. On the first
// run it also turns on starting at login; after that the Startup setting on Home decides.
func startService(ctx context.Context, service app.Service, firstRun bool) {
	status := service.Status(ctx)
	if !status.Available || !status.Installed {
		return
	}
	if firstRun && status.Enabled != "enabled" {
		if errEnable := service.Do(ctx, "enable"); errEnable != nil {
			log.WithError(errEnable).Warn("could not start the proxy service at login")
		}
	}
	if status.Active == "active" || status.Active == "activating" {
		return
	}
	if errStart := service.Do(ctx, "start"); errStart != nil {
		log.WithError(errStart).Warn("could not start the proxy service")
	}
}
