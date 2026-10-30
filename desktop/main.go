// Command cliproxyapi-desktop is the CLIProxyAPI desktop app. It shows the management
// UI in a native window and controls the proxy, which runs as a systemd user service.
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"os"
	"sync/atomic"

	"github.com/router-for-me/CLIProxyAPI/desktop/internal/app"
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

func main() {
	paths := app.DefaultPaths()
	if created, errConfig := app.EnsureConfig(paths.Config); errConfig != nil {
		log.WithError(errConfig).Error("could not create the default config")
	} else if created {
		log.Infof("created %s", paths.Config)
	}

	service := app.NewSystemdUser()
	var appCtx atomic.Pointer[context.Context]
	server := &app.Server{
		Paths:   paths,
		Service: service,
		Version: version,
		Debug:   os.Getenv("CPA_DESKTOP_DEBUG") == "1",
		OpenURL: func(rawURL string) error {
			ctx := appCtx.Load()
			if ctx == nil {
				return errors.New("the window is not ready")
			}
			runtime.BrowserOpenURL(*ctx, rawURL)
			return nil
		},
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
		BackgroundColour: &options.RGBA{R: 14, G: 15, B: 18, A: 255},
		AssetServer: &assetserver.Options{
			Assets:  dist,
			Handler: server,
		},
		OnStartup: func(ctx context.Context) {
			appCtx.Store(&ctx)
			go startService(ctx, service)
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

// startService starts the installed proxy service when it is not running yet.
func startService(ctx context.Context, service app.Service) {
	status := service.Status(ctx)
	if !status.Available || !status.Installed {
		return
	}
	if status.Active == "active" || status.Active == "activating" {
		return
	}
	if errStart := service.Do(ctx, "start"); errStart != nil {
		log.WithError(errStart).Warn("could not start the proxy service")
	}
}
