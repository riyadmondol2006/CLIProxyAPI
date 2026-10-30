// Command devserver serves the desktop UI and the desktop backend over plain HTTP so
// the app can be developed and tested in a browser without WebKitGTK.
package main

import (
	"bytes"
	"flag"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/router-for-me/CLIProxyAPI/desktop/internal/app"
	log "github.com/sirupsen/logrus"
)

// desktopMarker makes the UI behave as it does inside the app window.
const desktopMarker = "<script>window.__CPA_DESKTOP__=true</script>"

func main() {
	listen := flag.String("listen", "127.0.0.1:34115", "address to serve on")
	dist := flag.String("dist", "frontend/dist", "built UI directory")
	config := flag.String("config", "", "config path (default: the app's config path)")
	token := flag.String("token-file", "", "local management token path (default: the app's token path)")
	saveDir := flag.String("save-dir", app.DownloadsDir(), "where downloads from the UI are saved")
	flag.Parse()

	paths := app.DefaultPaths()
	if *config != "" {
		paths.Config = *config
	}
	if *token != "" {
		paths.Token = *token
	}
	backend := &app.Server{
		Paths:   paths,
		Service: app.NewSystemdUser(),
		Version: "dev",
		OpenURL: func(rawURL string) error { return exec.Command("xdg-open", rawURL).Start() },
		// No native dialog here: save straight into the save directory.
		SaveFile: func(name string, data []byte) (string, error) { return app.WriteUnique(*saveDir, name, data) },
	}

	index, errIndex := os.ReadFile(filepath.Join(*dist, "index.html"))
	if errIndex != nil {
		log.WithError(errIndex).Error("build the UI first")
		os.Exit(1)
	}
	index = bytes.Replace(index, []byte("<head>"), []byte("<head>"+desktopMarker), 1)

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" || r.URL.Path == "/index.html" {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			if _, errWrite := w.Write(index); errWrite != nil {
				log.WithError(errWrite).Debug("write index")
			}
			return
		}
		if !strings.HasPrefix(r.URL.Path, "/app/") {
			if _, errStat := os.Stat(filepath.Join(*dist, filepath.Clean(r.URL.Path))); errStat == nil {
				http.ServeFile(w, r, filepath.Join(*dist, filepath.Clean(r.URL.Path)))
				return
			}
		}
		backend.ServeHTTP(w, r)
	})
	log.Infof("desktop UI on http://%s", *listen)
	if errServe := http.ListenAndServe(*listen, handler); errServe != nil {
		log.WithError(errServe).Error("serve")
		os.Exit(1)
	}
}
