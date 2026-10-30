package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestEnsureConfigWritesPrivateLocalOnlyConfigOnce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "cliproxyapi", "config.yaml")
	created, errEnsure := EnsureConfig(path)
	if errEnsure != nil || !created {
		t.Fatalf("first run: created=%v err=%v", created, errEnsure)
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read config: %v", errRead)
	}
	text := string(data)
	if !regexp.MustCompile(`- "sk-[0-9a-f]{40}"`).MatchString(text) {
		t.Fatalf("config should contain a generated client key:\n%s", text)
	}
	for _, want := range []string{`host: "127.0.0.1"`, "disable-control-panel: true", "allow-remote: false"} {
		if !strings.Contains(text, want) {
			t.Fatalf("config missing %q:\n%s", want, text)
		}
	}
	info, _ := os.Stat(path)
	if perm := info.Mode().Perm(); perm != 0o600 {
		t.Fatalf("config permissions = %o, want 600", perm)
	}
	if listen := ReadListen(path); listen.Host != "127.0.0.1" || listen.Port != 8317 {
		t.Fatalf("unexpected listen address: %+v", listen)
	}

	created, errEnsure = EnsureConfig(path)
	if errEnsure != nil || created {
		t.Fatalf("second run must keep the existing file: created=%v err=%v", created, errEnsure)
	}
	again, _ := os.ReadFile(path)
	if !bytes.Equal(again, data) {
		t.Fatal("existing config was modified")
	}
}

func TestReadListenSupportsLegacyKeysAndDefaults(t *testing.T) {
	dir := t.TempDir()
	legacy := filepath.Join(dir, "legacy.yaml")
	if errWrite := os.WriteFile(legacy, []byte("host: \"\"\nport: 9000\n"), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	if listen := ReadListen(legacy); listen.Host != "" || listen.Port != 9000 {
		t.Fatalf("legacy keys: %+v", listen)
	}
	if listen := ReadListen(filepath.Join(dir, "missing.yaml")); listen.Port != defaultPort {
		t.Fatalf("missing file should use the default port: %+v", listen)
	}
}

type fakeRunner struct {
	calls  [][]string
	output string
	err    error
}

func (f *fakeRunner) run(_ context.Context, name string, args ...string) ([]byte, error) {
	f.calls = append(f.calls, append([]string{name}, args...))
	return []byte(f.output), f.err
}

func TestSystemdUserStatusAndActions(t *testing.T) {
	runner := &fakeRunner{output: "LoadState=loaded\nActiveState=inactive\nUnitFileState=disabled\n"}
	service := &SystemdUser{Run: runner.run}
	status := service.Status(context.Background())
	if !status.Available || !status.Installed || status.Active != "inactive" || status.Enabled != "disabled" {
		t.Fatalf("unexpected status: %+v", status)
	}
	if errStart := service.Do(context.Background(), "start"); errStart != nil {
		t.Fatalf("start: %v", errStart)
	}
	last := strings.Join(runner.calls[len(runner.calls)-1], " ")
	if last != "systemctl --user enable --now "+ServiceName {
		t.Fatalf("start should enable and start the unit, ran %q", last)
	}
	if errBad := service.Do(context.Background(), "rm -rf"); errBad == nil {
		t.Fatal("unknown actions must be rejected")
	}

	missing := &SystemdUser{Run: (&fakeRunner{output: "Failed to connect to bus", err: errors.New("exit 1")}).run}
	if status := missing.Status(context.Background()); status.Available {
		t.Fatalf("systemctl failure should report unavailable: %+v", status)
	}
}

func newTestServer(t *testing.T, upstream *httptest.Server) (*Server, Paths) {
	t.Helper()
	dir := t.TempDir()
	paths := Paths{ConfigDir: dir, Config: filepath.Join(dir, "config.yaml"), Token: filepath.Join(dir, "token")}
	port := 1
	if upstream != nil {
		_, portText, _ := net.SplitHostPort(strings.TrimPrefix(upstream.URL, "http://"))
		port, _ = strconv.Atoi(portText)
	}
	config := "server:\n  host: \"\"\n  port: " + strconv.Itoa(port) + "\n"
	if errWrite := os.WriteFile(paths.Config, []byte(config), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	if errWrite := os.WriteFile(paths.Token, []byte("secret-token\n"), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
	return &Server{Paths: paths, Version: "test"}, paths
}

func TestForwardAddsTokenOnlyToManagementRequests(t *testing.T) {
	type seen struct{ path, auth, origin, body string }
	got := make(chan seen, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		got <- seen{r.URL.RequestURI(), r.Header.Get("Authorization"), r.Header.Get("Origin"), string(body)}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer upstream.Close()
	server, _ := newTestServer(t, upstream)

	req := httptest.NewRequest(http.MethodPut, "/v8/management/config/access/api-keys?x=1", strings.NewReader(`["k"]`))
	req.Header.Set("Authorization", "Bearer desktop-app")
	req.Header.Set("Origin", "wails://wails")
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("management request: status %d", recorder.Code)
	}
	management := <-got
	if management.path != "/v8/management/config/access/api-keys?x=1" || management.auth != "Bearer secret-token" ||
		management.origin != "" || management.body != `["k"]` {
		t.Fatalf("unexpected forwarded management request: %+v", management)
	}

	req = httptest.NewRequest(http.MethodGet, "/v1/models", nil)
	req.Header.Set("Authorization", "Bearer sk-client")
	server.ServeHTTP(httptest.NewRecorder(), req)
	if client := <-got; client.auth != "Bearer sk-client" {
		t.Fatalf("client API requests must keep their own key, got %q", client.auth)
	}
}

func TestForwardReportsUnreachableService(t *testing.T) {
	server, _ := newTestServer(t, nil)
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v8/management/config", nil))
	if recorder.Code != http.StatusBadGateway || !strings.Contains(recorder.Body.String(), "service_unreachable") {
		t.Fatalf("expected 502 service_unreachable, got %d %s", recorder.Code, recorder.Body.String())
	}
}

func TestStatusAndOpen(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {}))
	defer upstream.Close()
	server, _ := newTestServer(t, upstream)
	var opened []string
	server.OpenURL = func(rawURL string) error {
		opened = append(opened, rawURL)
		return nil
	}

	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/app/status", nil))
	var status Status
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &status); errDecode != nil {
		t.Fatalf("decode status: %v", errDecode)
	}
	if !status.Reachable || !status.TokenReady || status.AppVersion != "test" {
		t.Fatalf("unexpected status: %+v", status)
	}

	open := func(body string) int {
		rec := httptest.NewRecorder()
		server.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/app/open", strings.NewReader(body)))
		return rec.Code
	}
	if code := open(`{"url":"https://example.com/docs"}`); code != http.StatusOK {
		t.Fatalf("https link: status %d", code)
	}
	if code := open(`{"url":"file:///etc/passwd"}`); code != http.StatusBadRequest {
		t.Fatalf("file link must be refused, got %d", code)
	}
	if len(opened) != 1 || opened[0] != "https://example.com/docs" {
		t.Fatalf("unexpected opened links: %v", opened)
	}
}

func TestUpstreamHostUsesLoopbackForWildcardBinds(t *testing.T) {
	cases := map[string]string{"": "127.0.0.1:8317", "0.0.0.0": "127.0.0.1:8317", "::": "127.0.0.1:8317",
		"localhost": "127.0.0.1:8317", "192.168.1.5": "192.168.1.5:8317"}
	for host, want := range cases {
		if got := upstreamHost(Listen{Host: host, Port: 8317}); got != want {
			t.Errorf("upstreamHost(%q) = %q, want %q", host, got, want)
		}
	}
}

func TestSaveEndpointPassesSafeNameAndBody(t *testing.T) {
	server, _ := newTestServer(t, nil)
	var gotName string
	var gotData []byte
	server.SaveFile = func(name string, data []byte) (string, error) {
		gotName, gotData = name, data
		return "/home/u/Downloads/" + name, nil
	}
	req := httptest.NewRequest(http.MethodPost, "/app/save?name=../../etc/claude-auth.json", strings.NewReader(`{"k":1}`))
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, req)
	if recorder.Code != http.StatusOK {
		t.Fatalf("save: status %d %s", recorder.Code, recorder.Body.String())
	}
	if gotName != "claude-auth.json" || string(gotData) != `{"k":1}` {
		t.Fatalf("unexpected save call: name=%q data=%q", gotName, gotData)
	}
	if !strings.Contains(recorder.Body.String(), `"cancelled":false`) {
		t.Fatalf("unexpected response: %s", recorder.Body.String())
	}

	server.SaveFile = func(string, []byte) (string, error) { return "", nil }
	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/app/save?name=x.log", strings.NewReader("x")))
	if !strings.Contains(recorder.Body.String(), `"cancelled":true`) {
		t.Fatalf("a cancelled dialog should report cancelled: %s", recorder.Body.String())
	}
}

func TestWriteUniqueNeverOverwrites(t *testing.T) {
	dir := t.TempDir()
	first, errFirst := WriteUnique(dir, "app.log", []byte("one"))
	second, errSecond := WriteUnique(dir, "app.log", []byte("two"))
	if errFirst != nil || errSecond != nil {
		t.Fatalf("write: %v %v", errFirst, errSecond)
	}
	if filepath.Base(first) != "app.log" || filepath.Base(second) != "app (1).log" {
		t.Fatalf("unexpected names: %s, %s", first, second)
	}
	if data, _ := os.ReadFile(first); string(data) != "one" {
		t.Fatal("first file was overwritten")
	}
	if info, _ := os.Stat(second); info.Mode().Perm() != 0o600 {
		t.Fatalf("saved files must be private, got %o", info.Mode().Perm())
	}
}

func TestSafeFileName(t *testing.T) {
	cases := map[string]string{"../../x.json": "x.json", "a\\b\\c.txt": "c.txt", "": "download", "..": "download", "bad\x00name": "badname"}
	for input, want := range cases {
		if got := SafeFileName(input); got != want {
			t.Errorf("SafeFileName(%q) = %q, want %q", input, got, want)
		}
	}
}
