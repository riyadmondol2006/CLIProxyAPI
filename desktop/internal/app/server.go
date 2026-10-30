package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strconv"
	"strings"
	"time"

	log "github.com/sirupsen/logrus"
)

const managementPrefix = "/v8/management"

// Server answers every request the UI makes that is not a bundled asset:
// /app/* endpoints for the desktop shell, and everything else is forwarded
// to the local proxy service.
type Server struct {
	Paths   Paths
	Service Service
	Version string
	// OpenURL opens a link in the user's browser.
	OpenURL func(rawURL string) error
	// SaveFile stores a file the UI downloads and returns where it went, or "" when the
	// user cancels. WebKitGTK in Wails cannot handle browser downloads itself.
	SaveFile func(name string, data []byte) (string, error)
	// Debug logs every request the UI makes (enable with CPA_DESKTOP_DEBUG=1).
	Debug bool
}

// Status is returned by GET /app/status.
type Status struct {
	AppVersion string        `json:"app-version"`
	ConfigPath string        `json:"config-path"`
	Listen     Listen        `json:"listen"`
	Service    ServiceStatus `json:"service"`
	TokenReady bool          `json:"token-ready"`
	Reachable  bool          `json:"reachable"`
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if s.Debug {
		log.Infof("ui request: %s %s", r.Method, r.URL.Path)
	}
	switch {
	case r.URL.Path == "/app/status":
		s.handleStatus(w, r)
	case strings.HasPrefix(r.URL.Path, "/app/service/"):
		s.handleService(w, r)
	case r.URL.Path == "/app/open":
		s.handleOpen(w, r)
	case r.URL.Path == "/app/save":
		s.handleSave(w, r)
	case strings.HasPrefix(r.URL.Path, "/app/"):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	default:
		s.forward(w, r)
	}
}

// upstreamHost is the address the app dials for the proxy. Wildcard and loopback
// binds are reached through 127.0.0.1 so the proxy sees a local management client.
func upstreamHost(listen Listen) string {
	host := strings.Trim(strings.TrimSpace(listen.Host), "[]")
	switch strings.ToLower(host) {
	case "", "0.0.0.0", "::", "localhost", "127.0.0.1", "::1":
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, strconv.Itoa(listen.Port))
}

func (s *Server) status(ctx context.Context) Status {
	listen := ReadListen(s.Paths.Config)
	status := Status{
		AppVersion: s.Version,
		ConfigPath: s.Paths.Config,
		Listen:     listen,
		TokenReady: ReadToken(s.Paths.Token) != "",
	}
	if s.Service != nil {
		status.Service = s.Service.Status(ctx)
	}
	dialer := net.Dialer{Timeout: time.Second}
	if conn, errDial := dialer.DialContext(ctx, "tcp", upstreamHost(listen)); errDial == nil {
		status.Reachable = true
		if errClose := conn.Close(); errClose != nil {
			log.WithError(errClose).Debug("close probe connection")
		}
	}
	return status
}

func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use GET"})
		return
	}
	writeJSON(w, http.StatusOK, s.status(r.Context()))
}

func (s *Server) handleService(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	if s.Service == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "service control is unavailable"})
		return
	}
	action := strings.TrimPrefix(r.URL.Path, "/app/service/")
	if errDo := s.Service.Do(r.Context(), action); errDo != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": errDo.Error()})
		return
	}
	writeJSON(w, http.StatusOK, s.status(r.Context()))
}

func (s *Server) handleOpen(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	var body struct {
		URL string `json:"url"`
	}
	if errDecode := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&body); errDecode != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid body"})
		return
	}
	parsed, errParse := url.Parse(body.URL)
	if errParse != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "only http and https links can be opened"})
		return
	}
	if s.OpenURL == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "opening links is unavailable"})
		return
	}
	if errOpen := s.OpenURL(parsed.String()); errOpen != nil {
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": errOpen.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) handleSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	if s.SaveFile == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "saving files is unavailable"})
		return
	}
	data, errRead := io.ReadAll(io.LimitReader(r.Body, maxSaveBytes+1))
	if errRead != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "could not read the file"})
		return
	}
	if len(data) > maxSaveBytes {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "file is too large"})
		return
	}
	path, errSave := s.SaveFile(SafeFileName(r.URL.Query().Get("name")), data)
	if errSave != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": errSave.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"path": path, "cancelled": path == ""})
}

func (s *Server) forward(w http.ResponseWriter, r *http.Request) {
	target := &url.URL{Scheme: "http", Host: upstreamHost(ReadListen(s.Paths.Config))}
	proxy := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(target)
			pr.Out.Host = target.Host
			// The UI runs on the app's own origin; the proxy does not need browser origin headers.
			pr.Out.Header.Del("Origin")
			pr.Out.Header.Del("Referer")
			if strings.HasPrefix(pr.In.URL.Path, managementPrefix) {
				pr.Out.Header.Del("X-Management-Key")
				pr.Out.Header.Set("Authorization", "Bearer "+ReadToken(s.Paths.Token))
			}
		},
		FlushInterval: -1,
		ErrorHandler: func(rw http.ResponseWriter, _ *http.Request, errProxy error) {
			if errors.Is(errProxy, context.Canceled) {
				return
			}
			writeJSON(rw, http.StatusBadGateway, map[string]string{
				"error": "The CLIProxyAPI service is not reachable. Start it from the app or check its log.",
				"code":  "service_unreachable",
			})
		},
	}
	proxy.ServeHTTP(w, r)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if errEncode := json.NewEncoder(w).Encode(value); errEncode != nil {
		log.WithError(errEncode).Debug("write JSON response")
	}
}
