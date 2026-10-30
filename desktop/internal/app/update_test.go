package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"0.20261030.10", "0.20261030.9", 1},
		{"0.20261030.9", "0.20261030.10", -1},
		{"0.20261031.1", "0.20261030.99", 1},
		{"0.20261030.9", "0.20261030.9", 0},
		{"1.2", "1.2.0", 0},
		{"1.2.0.0", "1.2", 0},
		{"1.2.1", "1.2", 1},
		{"v1.2.3", "1.2.3", 0},
		{"V2", "v1.9.9", 1},
		{"0.20261030.9-1", "0.20261030.9", 0},
		{"1.2.3-rc1", "1.2.3", 0},
		{"1.2-rc1.9", "1.2", 0},
		{"1.10", "1.9", 1},
		{"2", "10", -1},
		{"01.002", "1.2", 0},
		{"6.9.0", "0.20261030.9", 1},
		{"1.99999999999999999999999", "1.99999999999999999999998", 1},
		{"", "0", 0},
		{"", "0.0.1", -1},
		{" 1.0 ", "1", 0},
	}
	for _, tc := range cases {
		if got := CompareVersions(tc.a, tc.b); got != tc.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", tc.a, tc.b, got, tc.want)
		}
	}
}

func TestIsDevBuild(t *testing.T) {
	cases := map[string]bool{"dev": true, "DEV": true, "": true, "  ": true, "0.20261030.9": false, "v1.0.0": false}
	for version, want := range cases {
		if got := IsDevBuild(version); got != want {
			t.Errorf("IsDevBuild(%q) = %v, want %v", version, got, want)
		}
	}
}

func TestResolveUpdateFeed(t *testing.T) {
	t.Setenv(UpdateFeedEnv, "")
	if got := ResolveUpdateFeed("https://built-in"); got != "https://built-in" {
		t.Fatalf("without the variable: %q", got)
	}
	t.Setenv(UpdateFeedEnv, " http://127.0.0.1:1/latest.json ")
	if got := ResolveUpdateFeed("https://built-in"); got != "http://127.0.0.1:1/latest.json" {
		t.Fatalf("the variable must win: %q", got)
	}
}

const testSum = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

func testAsset(name, format, arch, sum string) updateAsset {
	return updateAsset{
		Name: name, Format: format, Arch: arch, Size: 42, SHA256: sum,
		URL: "https://github.com/o/r/releases/download/latest-build/" + name,
	}
}

func TestSelectAssetAndURLAllowList(t *testing.T) {
	rpm := testAsset("cliproxyapi-0.20261030.9-1.x86_64.rpm", "rpm", "amd64", testSum)
	with := func(change func(*updateAsset)) updateAsset {
		asset := rpm
		change(&asset)
		return asset
	}
	cases := []struct {
		name   string
		assets []updateAsset
		format string
		arch   string
		want   string // selected asset name, "" for none
	}{
		{"github release URL", []updateAsset{rpm}, "rpm", "amd64", rpm.Name},
		{"objects.githubusercontent.com", []updateAsset{with(func(a *updateAsset) {
			a.URL = "https://objects.githubusercontent.com/github-production-release-asset/1/" + a.Name
		})}, "rpm", "amd64", rpm.Name},
		{"other arch", []updateAsset{rpm}, "rpm", "arm64", ""},
		{"other format", []updateAsset{rpm}, "deb", "amd64", ""},
		{"unknown format", []updateAsset{rpm}, "", "amd64", ""},
		{"plain http", []updateAsset{with(func(a *updateAsset) { a.URL = "http://github.com/o/r/" + a.Name })}, "rpm", "amd64", ""},
		{"lookalike host", []updateAsset{with(func(a *updateAsset) { a.URL = "https://github.com.evil.example/" + a.Name })}, "rpm", "amd64", ""},
		{"userinfo host", []updateAsset{with(func(a *updateAsset) { a.URL = "https://github.com@evil.example/" + a.Name })}, "rpm", "amd64", ""},
		{"other host", []updateAsset{with(func(a *updateAsset) { a.URL = "https://evil.example/https://github.com/" + a.Name })}, "rpm", "amd64", ""},
		{"empty URL", []updateAsset{with(func(a *updateAsset) { a.URL = "" })}, "rpm", "amd64", ""},
		{"path in name", []updateAsset{with(func(a *updateAsset) { a.Name = "../../.bashrc.rpm" })}, "rpm", "amd64", ""},
		{"space in name", []updateAsset{with(func(a *updateAsset) { a.Name = "x y.rpm" })}, "rpm", "amd64", ""},
		{"name of another format", []updateAsset{with(func(a *updateAsset) { a.Name = "cliproxyapi.deb" })}, "rpm", "amd64", ""},
		{"short checksum", []updateAsset{with(func(a *updateAsset) { a.SHA256 = "abc" })}, "rpm", "amd64", ""},
		{"too large", []updateAsset{with(func(a *updateAsset) { a.Size = maxUpdateBytes + 1 })}, "rpm", "amd64", ""},
		{"bad asset does not hide a good one", []updateAsset{
			with(func(a *updateAsset) { a.URL = "https://evil.example/" + a.Name }),
			with(func(a *updateAsset) {
				a.Name = "cliproxyapi-good.rpm"
				a.URL = "https://github.com/o/r/cliproxyapi-good.rpm"
			}),
		}, "rpm", "amd64", "cliproxyapi-good.rpm"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := selectAsset(tc.assets, tc.format, tc.arch)
			switch {
			case tc.want == "" && got != nil:
				t.Fatalf("expected no package, got %+v", *got)
			case tc.want != "" && (got == nil || got.Name != tc.want):
				t.Fatalf("expected %q, got %+v", tc.want, got)
			}
		})
	}
}

type exitStatusError int

func (e exitStatusError) Error() string { return "exit status " + strconv.Itoa(int(e)) }
func (e exitStatusError) ExitCode() int { return int(e) }

type fakeResult struct {
	out string
	err error
}

// fakeSystem answers command lookups and runs without running anything.
type fakeSystem struct {
	mu      sync.Mutex
	paths   map[string]bool       // commands on PATH
	results map[string]fakeResult // by command name; missing names fail with exit 1
	onRun   func(argv []string)
	calls   [][]string
	started [][]string
}

func (f *fakeSystem) lookPath(name string) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.paths[name] {
		return "/usr/bin/" + name, nil
	}
	return "", exec.ErrNotFound
}

func (f *fakeSystem) run(_ context.Context, name string, args ...string) ([]byte, error) {
	argv := append([]string{name}, args...)
	f.mu.Lock()
	f.calls = append(f.calls, argv)
	result, ok := f.results[name]
	onRun := f.onRun
	f.mu.Unlock()
	if onRun != nil {
		onRun(argv)
	}
	if !ok {
		return []byte(name + ": not installed"), exitStatusError(1)
	}
	return []byte(result.out), result.err
}

func (f *fakeSystem) start(name string, args ...string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.started = append(f.started, append([]string{name}, args...))
	return nil
}

func (f *fakeSystem) callsTo(name string) [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var calls [][]string
	for _, call := range f.calls {
		if call[0] == name {
			calls = append(calls, call)
		}
	}
	return calls
}

func TestPackageFormatDetection(t *testing.T) {
	cases := []struct {
		name      string
		installed string // "rpm", "deb", or "" for not installed
		onPath    []string
		want      string
	}{
		{"installed rpm wins over apt", "rpm", []string{"apt-get"}, "rpm"},
		{"installed deb wins over dnf", "deb", []string{"dnf", "rpm"}, "deb"},
		{"dnf on PATH", "", []string{"dnf"}, "rpm"},
		{"rpm on PATH", "", []string{"rpm"}, "rpm"},
		{"rpm tools before apt", "", []string{"rpm", "apt-get"}, "rpm"},
		{"apt-get on PATH", "", []string{"apt-get"}, "deb"},
		{"nothing", "", nil, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			system := &fakeSystem{paths: map[string]bool{}, results: map[string]fakeResult{}}
			for _, name := range tc.onPath {
				system.paths[name] = true
			}
			switch tc.installed {
			case "rpm":
				system.results["rpm"] = fakeResult{out: "cliproxyapi-0.20261030.9-1.x86_64"}
			case "deb":
				system.results["dpkg-query"] = fakeResult{out: "cliproxyapi\t0.20261030.9-1"}
			}
			hooks := updateHooks{lookPath: system.lookPath, run: system.run}
			if got := hooks.packageFormat(context.Background()); got != tc.want {
				t.Fatalf("packageFormat = %q, want %q", got, tc.want)
			}
			if first := strings.Join(system.calls[0], " "); first != "rpm -q cliproxyapi" {
				t.Fatalf("first query = %q", first)
			}
			if tc.installed != "rpm" {
				if second := strings.Join(system.calls[1], " "); second != "dpkg-query -W cliproxyapi" {
					t.Fatalf("second query = %q", second)
				}
			}
		})
	}
}

// rewriteTransport sends every request to target, so GitHub asset URLs reach the test server.
type rewriteTransport struct{ target *url.URL }

func (t rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	out := req.Clone(req.Context())
	out.URL.Scheme = t.target.Scheme
	out.URL.Host = t.target.Host
	out.Host = ""
	return http.DefaultTransport.RoundTrip(out)
}

type updateFixture struct {
	server  *Server
	system  *fakeSystem
	service *recordingService
	cache   string
	clock   time.Time
	pkg     []byte
	sum     string
	hits    atomic.Int32

	mu         sync.Mutex // guards feed and feedStatus, read by the test server
	feed       updateFeedFile
	feedStatus int
}

// newUpdateFixture serves a feed with a newer version on an rpm-based amd64 system where
// dnf and pkexec are on PATH. Every command is faked.
func newUpdateFixture(t *testing.T) *updateFixture {
	t.Helper()
	f := &updateFixture{pkg: []byte("fake package bytes"), clock: time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)}
	sum := sha256.Sum256(f.pkg)
	f.sum = hex.EncodeToString(sum[:])
	f.feed = updateFeedFile{
		Version:    "0.20261030.9",
		Commit:     "0123456789abcdef0123456789abcdef01234567",
		Published:  "2026-10-30T11:00:00Z",
		ReleaseURL: "https://github.com/o/r/releases/tag/latest-build",
		Notes:      []string{"feat: newest", "fix: older"},
		Assets: []updateAsset{
			testAsset("cliproxyapi-0.20261030.9-1.x86_64.rpm", "rpm", "amd64", f.sum),
			testAsset("cliproxyapi-0.20261030.9-1.aarch64.rpm", "rpm", "arm64", f.sum),
			testAsset("cliproxyapi_0.20261030.9-1_amd64.deb", "deb", "amd64", f.sum),
			testAsset("cliproxyapi_0.20261030.9-1_arm64.deb", "deb", "arm64", f.sum),
		},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/latest.json", func(w http.ResponseWriter, _ *http.Request) {
		f.hits.Add(1)
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.feedStatus != 0 {
			w.WriteHeader(f.feedStatus)
			return
		}
		_ = json.NewEncoder(w).Encode(f.feed)
	})
	mux.HandleFunc("/o/r/releases/download/latest-build/", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(f.pkg)
	})
	upstream := httptest.NewServer(mux)
	t.Cleanup(upstream.Close)
	target, errParse := url.Parse(upstream.URL)
	if errParse != nil {
		t.Fatal(errParse)
	}
	client := &http.Client{Transport: rewriteTransport{target: target}}
	f.system = &fakeSystem{
		paths:   map[string]bool{"rpm": true, "dnf": true, "pkexec": true},
		results: map[string]fakeResult{"rpm": {out: "cliproxyapi-0.20261001.1-1.x86_64"}, "pkexec": {out: "Complete!"}},
	}
	f.service = &recordingService{}
	f.cache = t.TempDir()
	f.server = &Server{Version: "0.20261001.1", UpdateFeed: upstream.URL + "/latest.json", Service: f.service}
	f.server.updates.hooks = updateHooks{
		lookPath:       f.system.lookPath,
		run:            f.system.run,
		start:          f.system.start,
		feedClient:     client,
		downloadClient: client,
		cacheDir:       func() (string, error) { return f.cache, nil },
		now:            func() time.Time { return f.clock },
		arch:           "amd64",
	}
	return f
}

func (f *updateFixture) setFeed(change func(feed *updateFeedFile)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	change(&f.feed)
}

func (f *updateFixture) setFeedStatus(status int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.feedStatus = status
}

func (f *updateFixture) request(method, target string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	f.server.ServeHTTP(recorder, httptest.NewRequest(method, target, nil))
	return recorder
}

func (f *updateFixture) check(t *testing.T, target string) UpdateInfo {
	t.Helper()
	recorder := f.request(http.MethodGet, target)
	if recorder.Code != http.StatusOK {
		t.Fatalf("GET %s: status %d %s", target, recorder.Code, recorder.Body.String())
	}
	var info UpdateInfo
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &info); errDecode != nil {
		t.Fatalf("decode %s: %v", recorder.Body.String(), errDecode)
	}
	return info
}

func errorBody(t *testing.T, recorder *httptest.ResponseRecorder) string {
	t.Helper()
	var body map[string]string
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
		t.Fatalf("decode %s: %v", recorder.Body.String(), errDecode)
	}
	return body["error"]
}

func TestUpdateCheckResponse(t *testing.T) {
	f := newUpdateFixture(t)
	recorder := f.request(http.MethodGet, "/app/update")
	var raw map[string]json.RawMessage
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &raw); errDecode != nil {
		t.Fatalf("decode: %v", errDecode)
	}
	keys := make([]string, 0, len(raw))
	for key := range raw {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	wantKeys := []string{"available", "can-install", "checked-at", "current", "dev-build", "error", "install-hint",
		"latest", "notes", "package", "published", "release-url"}
	if !slices.Equal(keys, wantKeys) {
		t.Fatalf("response keys = %v, want %v", keys, wantKeys)
	}
	var pkg map[string]json.RawMessage
	if errDecode := json.Unmarshal(raw["package"], &pkg); errDecode != nil || len(pkg) != 4 ||
		pkg["name"] == nil || pkg["format"] == nil || pkg["arch"] == nil || pkg["size"] == nil {
		t.Fatalf("package must have exactly name, format, arch, size: %s", raw["package"])
	}

	info := f.check(t, "/app/update")
	name := "cliproxyapi-0.20261030.9-1.x86_64.rpm"
	want := UpdateInfo{
		Current:     "0.20261001.1",
		Latest:      "0.20261030.9",
		Available:   true,
		CheckedAt:   "2026-10-30T12:00:00Z",
		Notes:       []string{"feat: newest", "fix: older"},
		ReleaseURL:  "https://github.com/o/r/releases/tag/latest-build",
		Published:   "2026-10-30T11:00:00Z",
		Package:     &UpdatePackage{Name: name, Format: "rpm", Arch: "amd64", Size: 42},
		CanInstall:  true,
		InstallHint: "curl -fL -o " + name + " https://github.com/o/r/releases/download/latest-build/" + name + " && sudo dnf install ./" + name,
	}
	if gotJSON, wantJSON := mustJSON(t, info), mustJSON(t, want); gotJSON != wantJSON {
		t.Fatalf("update info:\n got %s\nwant %s", gotJSON, wantJSON)
	}
}

func mustJSON(t *testing.T, value any) string {
	t.Helper()
	data, errMarshal := json.Marshal(value)
	if errMarshal != nil {
		t.Fatal(errMarshal)
	}
	return string(data)
}

func TestUpdateCheckVariants(t *testing.T) {
	cases := []struct {
		name  string
		setup func(f *updateFixture)
		check func(t *testing.T, info UpdateInfo)
	}{
		{"dev build is never available", func(f *updateFixture) { f.server.Version = "dev" }, func(t *testing.T, info UpdateInfo) {
			if info.Available || !info.DevBuild || info.Latest != "0.20261030.9" {
				t.Fatalf("dev build: %+v", info)
			}
		}},
		{"same version is not available", func(f *updateFixture) { f.server.Version = "0.20261030.9" }, func(t *testing.T, info UpdateInfo) {
			if info.Available || info.DevBuild || info.Package == nil {
				t.Fatalf("same version: %+v", info)
			}
		}},
		{"newer local version is not available", func(f *updateFixture) { f.server.Version = "1.0.0" }, func(t *testing.T, info UpdateInfo) {
			if info.Available {
				t.Fatalf("newer local version: %+v", info)
			}
		}},
		{"no pkexec", func(f *updateFixture) { delete(f.system.paths, "pkexec") }, func(t *testing.T, info UpdateInfo) {
			if !info.Available || info.CanInstall || info.Package == nil || info.InstallHint == "" {
				t.Fatalf("without pkexec the hint must remain: %+v", info)
			}
		}},
		{"rpm without dnf", func(f *updateFixture) { delete(f.system.paths, "dnf") }, func(t *testing.T, info UpdateInfo) {
			if !info.CanInstall || !strings.HasSuffix(info.InstallHint, "&& sudo rpm -U ./"+info.Package.Name) {
				t.Fatalf("rpm only: %+v", info)
			}
		}},
		{"deb system", func(f *updateFixture) {
			f.system.results = map[string]fakeResult{"dpkg-query": {}, "pkexec": {}}
			f.system.paths = map[string]bool{"apt-get": true, "pkexec": true}
		}, func(t *testing.T, info UpdateInfo) {
			name := "cliproxyapi_0.20261030.9-1_amd64.deb"
			if !info.CanInstall || info.Package == nil || info.Package.Name != name || info.Package.Format != "deb" ||
				!strings.HasSuffix(info.InstallHint, "&& sudo apt install ./"+name) {
				t.Fatalf("deb system: %+v", info)
			}
		}},
		{"arm64", func(f *updateFixture) { f.server.updates.hooks.arch = "arm64" }, func(t *testing.T, info UpdateInfo) {
			if info.Package == nil || info.Package.Name != "cliproxyapi-0.20261030.9-1.aarch64.rpm" {
				t.Fatalf("arm64: %+v", info.Package)
			}
		}},
		{"unknown system", func(f *updateFixture) {
			f.system.results = map[string]fakeResult{}
			f.system.paths = map[string]bool{"pkexec": true}
		}, func(t *testing.T, info UpdateInfo) {
			if !info.Available || info.Package != nil || info.CanInstall || info.InstallHint != "" {
				t.Fatalf("unknown system: %+v", info)
			}
		}},
		{"asset outside GitHub is missing", func(f *updateFixture) {
			f.setFeed(func(feed *updateFeedFile) {
				for i := range feed.Assets {
					feed.Assets[i].URL = "https://evil.example/" + feed.Assets[i].Name
				}
			})
		}, func(t *testing.T, info UpdateInfo) {
			if !info.Available || info.Package != nil || info.CanInstall {
				t.Fatalf("disallowed URLs: %+v", info)
			}
		}},
		{"feed without notes", func(f *updateFixture) { f.setFeed(func(feed *updateFeedFile) { feed.Notes = nil }) }, func(t *testing.T, info UpdateInfo) {
			if info.Notes == nil || len(info.Notes) != 0 {
				t.Fatalf("notes must be an empty list: %#v", info.Notes)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newUpdateFixture(t)
			tc.setup(f)
			tc.check(t, f.check(t, "/app/update"))
		})
	}
}

func TestUpdateFeedErrorsAreReported(t *testing.T) {
	cases := []struct {
		name  string
		setup func(f *updateFixture)
		want  string
	}{
		{"not found", func(f *updateFixture) { f.setFeedStatus(http.StatusNotFound) }, "404"},
		{"no feed", func(f *updateFixture) { f.server.UpdateFeed = "" }, "no update feed"},
		{"bad URL", func(f *updateFixture) { f.server.UpdateFeed = "http://[::1" }, "update feed"},
		{"unreachable", func(f *updateFixture) {
			f.server.UpdateFeed = "http://127.0.0.1:1/latest.json"
			f.server.updates.hooks.feedClient = &http.Client{}
		}, "fetch the update feed"},
		{"no version", func(f *updateFixture) { f.setFeed(func(feed *updateFeedFile) { feed.Version = "" }) }, "no version"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newUpdateFixture(t)
			tc.setup(f)
			info := f.check(t, "/app/update")
			if !strings.Contains(info.Error, tc.want) || info.Available || info.Package != nil || info.Notes == nil {
				t.Fatalf("expected an error containing %q: %+v", tc.want, info)
			}
		})
	}

	f := newUpdateFixture(t)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("<html>not json"))
	}))
	defer upstream.Close()
	f.server.UpdateFeed = upstream.URL
	f.server.updates.hooks.feedClient = &http.Client{}
	if info := f.check(t, "/app/update"); !strings.Contains(info.Error, "read the update feed") {
		t.Fatalf("invalid JSON: %+v", info)
	}

	if recorder := f.request(http.MethodPost, "/app/update"); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /app/update: %d", recorder.Code)
	}
}

func TestUpdateCheckIsCachedUnlessForced(t *testing.T) {
	f := newUpdateFixture(t)
	first := f.check(t, "/app/update")
	f.clock = f.clock.Add(59 * time.Minute)
	second := f.check(t, "/app/update")
	if hits := f.hits.Load(); hits != 1 || second.CheckedAt != first.CheckedAt {
		t.Fatalf("second check within the hour must be cached: hits=%d %s %s", hits, first.CheckedAt, second.CheckedAt)
	}
	forced := f.check(t, "/app/update?force=1")
	if hits := f.hits.Load(); hits != 2 || forced.CheckedAt == first.CheckedAt {
		t.Fatalf("force=1 must check again: hits=%d", hits)
	}
	f.clock = f.clock.Add(61 * time.Minute)
	f.check(t, "/app/update")
	if hits := f.hits.Load(); hits != 3 {
		t.Fatalf("a check older than an hour must be refreshed: hits=%d", hits)
	}

	// Failed checks are retried after a few minutes instead of an hour.
	f.setFeedStatus(http.StatusBadGateway)
	if info := f.check(t, "/app/update?force=1"); info.Error == "" {
		t.Fatal("expected an error")
	}
	f.setFeedStatus(0)
	f.clock = f.clock.Add(time.Minute)
	if info := f.check(t, "/app/update"); info.Error == "" || f.hits.Load() != 4 {
		t.Fatalf("a recent error is cached: hits=%d %+v", f.hits.Load(), info)
	}
	f.clock = f.clock.Add(updateErrorCacheTTL)
	if info := f.check(t, "/app/update"); info.Error != "" || f.hits.Load() != 5 {
		t.Fatalf("an old error is retried: hits=%d %+v", f.hits.Load(), info)
	}
}

func TestInstallArgsKeepValuesOutOfTheScript(t *testing.T) {
	path := "/home/u/.cache/cliproxyapi/updates/cliproxyapi-1.rpm"
	got := installArgs(path, testSum, "rpm")
	want := []string{"/bin/sh", "-c", installScript, "sh", path, testSum, "rpm"}
	if !slices.Equal(got, want) {
		t.Fatalf("installArgs = %q, want %q", got, want)
	}
	for _, value := range []string{path, testSum, "cliproxyapi-1"} {
		if strings.Contains(installScript, value) {
			t.Fatalf("the script must not contain %q", value)
		}
	}
	for _, step := range []string{`tmp=$(mktemp -d)`, `cp -- "$1" "$tmp/pkg.$ext"`, `cd "$tmp"`,
		`echo "$2  pkg.$ext" | sha256sum -c -`, `dnf install -y ./pkg.rpm`, `rpm -U --replacepkgs ./pkg.rpm`,
		`apt-get install -y ./pkg.deb`, `rm -rf "$tmp"`} {
		if !strings.Contains(installScript, step) {
			t.Fatalf("the script is missing %q", step)
		}
	}
}

func TestInstallUpdate(t *testing.T) {
	f := newUpdateFixture(t)
	f.check(t, "/app/update")
	var installedSum string
	f.system.onRun = func(argv []string) {
		if argv[0] != "pkexec" {
			return
		}
		data, errRead := os.ReadFile(argv[5])
		if errRead != nil {
			t.Errorf("the package must exist while installing: %v", errRead)
			return
		}
		sum := sha256.Sum256(data)
		installedSum = hex.EncodeToString(sum[:])
	}

	recorder := f.request(http.MethodPost, "/app/update/install")
	if recorder.Code != http.StatusOK {
		t.Fatalf("install: %d %s", recorder.Code, recorder.Body.String())
	}
	var body map[string]string
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil ||
		len(body) != 2 || body["status"] != "installed" || body["version"] != "0.20261030.9" {
		t.Fatalf("install response: %s", recorder.Body.String())
	}

	name := "cliproxyapi-0.20261030.9-1.x86_64.rpm"
	path := filepath.Join(f.cache, "cliproxyapi", "updates", name)
	calls := f.system.callsTo("pkexec")
	want := []string{"pkexec", "/bin/sh", "-c", installScript, "sh", path, f.sum, "rpm"}
	if len(calls) != 1 || !slices.Equal(calls[0], want) {
		t.Fatalf("pkexec calls = %q, want %q", calls, [][]string{want})
	}
	if installedSum != f.sum {
		t.Fatalf("installed package checksum %q, want %q", installedSum, f.sum)
	}
	if _, errStat := os.Stat(path); !errors.Is(errStat, os.ErrNotExist) {
		t.Fatalf("the download must be removed after installing: %v", errStat)
	}
	if strings.Join(f.service.actions, ",") != "restart" {
		t.Fatalf("service actions: %v", f.service.actions)
	}
	// The install re-checks the feed, and a successful install clears the cache.
	if hits := f.hits.Load(); hits != 2 {
		t.Fatalf("install must re-check the feed: hits=%d", hits)
	}
	f.check(t, "/app/update")
	if hits := f.hits.Load(); hits != 3 {
		t.Fatalf("install must clear the cache: hits=%d", hits)
	}
}

func TestInstallRejectsChecksumMismatch(t *testing.T) {
	f := newUpdateFixture(t)
	f.setFeed(func(feed *updateFeedFile) {
		for i := range feed.Assets {
			feed.Assets[i].SHA256 = testSum
		}
	})
	recorder := f.request(http.MethodPost, "/app/update/install")
	if recorder.Code != http.StatusBadGateway || !strings.Contains(errorBody(t, recorder), "checksum") {
		t.Fatalf("checksum mismatch: %d %s", recorder.Code, recorder.Body.String())
	}
	if calls := f.system.callsTo("pkexec"); len(calls) != 0 {
		t.Fatalf("pkexec must not run: %q", calls)
	}
	entries, errRead := os.ReadDir(filepath.Join(f.cache, "cliproxyapi", "updates"))
	if errRead != nil || len(entries) != 0 {
		t.Fatalf("the bad download must be deleted: %v %v", entries, errRead)
	}
	if len(f.service.actions) != 0 {
		t.Fatalf("service must not restart: %v", f.service.actions)
	}
}

func TestInstallFailures(t *testing.T) {
	longOutput := make([]string, 0, 40)
	for i := 1; i <= 40; i++ {
		longOutput = append(longOutput, fmt.Sprintf("line %d", i))
	}
	cases := []struct {
		name   string
		result fakeResult
		status int
		check  func(t *testing.T, message string)
	}{
		{"dialog dismissed", fakeResult{err: exitStatusError(126)}, http.StatusForbidden, func(t *testing.T, message string) {
			if message != "cancelled" {
				t.Fatalf("message = %q", message)
			}
		}},
		{"not authorized", fakeResult{out: "Error executing command as another user: Not authorized", err: exitStatusError(127)}, http.StatusForbidden, func(t *testing.T, message string) {
			if message != "cancelled" {
				t.Fatalf("message = %q", message)
			}
		}},
		{"installer failed", fakeResult{out: strings.Join(longOutput, "\n"), err: exitStatusError(1)}, http.StatusInternalServerError, func(t *testing.T, message string) {
			if !strings.Contains(message, "line 40") || strings.Contains(message, "line 25\n") || strings.Contains(message, "line 1\n") {
				t.Fatalf("message must hold only the last lines: %q", message)
			}
		}},
		{"pkexec missing at run time", fakeResult{err: exec.ErrNotFound}, http.StatusInternalServerError, func(t *testing.T, message string) {
			if !strings.Contains(message, "executable file not found") {
				t.Fatalf("message = %q", message)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newUpdateFixture(t)
			f.system.results["pkexec"] = tc.result
			recorder := f.request(http.MethodPost, "/app/update/install")
			if recorder.Code != tc.status {
				t.Fatalf("status %d, want %d: %s", recorder.Code, tc.status, recorder.Body.String())
			}
			tc.check(t, errorBody(t, recorder))
			if len(f.service.actions) != 0 {
				t.Fatalf("service must not restart after a failed install: %v", f.service.actions)
			}
			if entries, _ := os.ReadDir(filepath.Join(f.cache, "cliproxyapi", "updates")); len(entries) != 0 {
				t.Fatalf("the download must be removed: %v", entries)
			}
		})
	}
}

func TestInstallPreconditions(t *testing.T) {
	cases := []struct {
		name   string
		setup  func(f *updateFixture)
		method string
		status int
	}{
		{"GET", func(*updateFixture) {}, http.MethodGet, http.StatusMethodNotAllowed},
		{"up to date", func(f *updateFixture) { f.server.Version = "0.20261030.9" }, http.MethodPost, http.StatusConflict},
		{"dev build", func(f *updateFixture) { f.server.Version = "dev" }, http.MethodPost, http.StatusConflict},
		{"no pkexec", func(f *updateFixture) { delete(f.system.paths, "pkexec") }, http.MethodPost, http.StatusServiceUnavailable},
		{"no package for this system", func(f *updateFixture) { f.server.updates.hooks.arch = "riscv64" }, http.MethodPost, http.StatusServiceUnavailable},
		{"feed error", func(f *updateFixture) { f.setFeedStatus(http.StatusInternalServerError) }, http.MethodPost, http.StatusServiceUnavailable},
		{"already installing", func(f *updateFixture) { f.server.updates.installing.Lock() }, http.MethodPost, http.StatusConflict},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newUpdateFixture(t)
			tc.setup(f)
			recorder := f.request(tc.method, "/app/update/install")
			if recorder.Code != tc.status || errorBody(t, recorder) == "" {
				t.Fatalf("status %d, want %d: %s", recorder.Code, tc.status, recorder.Body.String())
			}
			if calls := f.system.callsTo("pkexec"); len(calls) != 0 {
				t.Fatalf("pkexec must not run: %q", calls)
			}
		})
	}
}

func TestRelaunch(t *testing.T) {
	f := newUpdateFixture(t)
	f.server.Executable = "/usr/bin/cliproxyapi-desktop"
	if recorder := f.request(http.MethodPost, "/app/update/relaunch"); recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("without Quit: %d %s", recorder.Code, recorder.Body.String())
	}

	quit := make(chan struct{})
	f.server.Quit = func() { close(quit) }
	f.server.Executable = ""
	if recorder := f.request(http.MethodPost, "/app/update/relaunch"); recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("without an executable: %d", recorder.Code)
	}
	f.server.Executable = "cliproxyapi-desktop"
	if recorder := f.request(http.MethodPost, "/app/update/relaunch"); recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("a relative executable must not be relaunched: %d", recorder.Code)
	}
	if recorder := f.request(http.MethodGet, "/app/update/relaunch"); recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET: %d", recorder.Code)
	}
	if len(f.system.started) != 0 {
		t.Fatalf("nothing may start: %q", f.system.started)
	}

	f.server.Executable = "/usr/bin/cliproxyapi-desktop"
	if recorder := f.request(http.MethodPost, "/app/update/relaunch"); recorder.Code != http.StatusAccepted {
		t.Fatalf("relaunch: %d %s", recorder.Code, recorder.Body.String())
	}
	want := []string{"/bin/sh", "-c", relaunchScript, "/usr/bin/cliproxyapi-desktop", strconv.Itoa(os.Getpid())}
	if len(f.system.started) != 1 || !slices.Equal(f.system.started[0], want) {
		t.Fatalf("started %q, want %q", f.system.started, want)
	}
	select {
	case <-quit:
	case <-time.After(10 * time.Second):
		t.Fatal("Quit was not called")
	}
}
