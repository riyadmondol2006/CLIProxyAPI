package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
)

const (
	// DefaultUpdateFeed is the release feed (latest.json) checked when the build does not set one.
	DefaultUpdateFeed = "https://github.com/riyadmondol2006/CLIProxyAPI/releases/download/latest-build/latest.json"
	// UpdateFeedEnv overrides the update feed URL, for testing.
	UpdateFeedEnv = "CPA_UPDATE_FEED"

	// updateCacheTTL is how long a check is reused; failed checks are retried sooner so a
	// network that is not up yet at login does not hide updates for an hour.
	updateCacheTTL      = time.Hour
	updateErrorCacheTTL = 5 * time.Minute
	maxUpdateFeedBytes  = 1 << 20
	maxUpdateBytes      = 512 << 20
	// updatePackageName is the package the app is installed from (packaging/nfpm.yaml).
	updatePackageName = "cliproxyapi"
	// packageQueryTimeout bounds the local rpm/dpkg-query calls made while checking.
	packageQueryTimeout = 10 * time.Second
	// relaunchDelay lets the UI receive the response before the window closes.
	relaunchDelay = 250 * time.Millisecond
	// outputTailLines and outputTailBytes bound installer output in messages and logs.
	outputTailLines = 15
	outputTailBytes = 2000
)

// installScript runs as root through pkexec. It copies the package into a root-owned
// directory and checks its SHA-256 again there, so the user-owned download cannot be
// swapped between the check and the install. The package path ($1), its SHA-256 ($2),
// and its format ($3) are positional arguments and never part of the script text.
// Every failure exits with 1, so exit codes 126 and 127 can only come from pkexec.
// The EXIT trap removes the copy whether the install succeeds or fails.
const installScript = `tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT
case "$3" in
rpm | deb) ext=$3 ;;
*) echo "unknown package format: $3" >&2; exit 1 ;;
esac
cp -- "$1" "$tmp/pkg.$ext" || exit 1
cd "$tmp" || exit 1
echo "$2  pkg.$ext" | sha256sum -c - || exit 1
if [ "$ext" = rpm ]; then
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y ./pkg.rpm || exit 1
  else
    rpm -U --replacepkgs ./pkg.rpm || exit 1
  fi
else
  apt-get install -y ./pkg.deb || exit 1
fi
`

// relaunchScript waits until the old app process ($1) has exited, so the single-instance
// lock is free, then starts the executable passed as $0. It gives up waiting after about
// 15 seconds and starts anyway.
const relaunchScript = `i=0
while kill -0 "$1" 2>/dev/null && [ "$i" -lt 75 ]; do sleep 0.2; i=$((i + 1)); done
exec "$0"`

var (
	updateFeedClient     = &http.Client{Timeout: 20 * time.Second}
	updateDownloadClient = &http.Client{Timeout: 10 * time.Minute}

	assetNamePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+~-]*$`)
	sha256Pattern    = regexp.MustCompile(`^[0-9a-fA-F]{64}$`)
)

// UpdateInfo is returned by GET /app/update.
type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest"`
	Available bool   `json:"available"`
	// DevBuild is true for local builds ("dev"), which never report an available update.
	DevBuild   bool     `json:"dev-build"`
	CheckedAt  string   `json:"checked-at"`
	Error      string   `json:"error"`
	Notes      []string `json:"notes"`
	ReleaseURL string   `json:"release-url"`
	Published  string   `json:"published"`
	// Package is the release package that fits this system, or nil.
	Package     *UpdatePackage `json:"package"`
	CanInstall  bool           `json:"can-install"`
	InstallHint string         `json:"install-hint"`
}

// UpdatePackage describes the package an update installs.
type UpdatePackage struct {
	Name   string `json:"name"`
	Format string `json:"format"`
	Arch   string `json:"arch"`
	Size   int64  `json:"size"`
}

// updateFeedFile is latest.json, published next to the packages by .github/workflows/packages.yml.
type updateFeedFile struct {
	Version    string        `json:"version"`
	Commit     string        `json:"commit"`
	Published  string        `json:"published"`
	ReleaseURL string        `json:"release-url"`
	Notes      []string      `json:"notes"`
	Assets     []updateAsset `json:"assets"`
}

type updateAsset struct {
	Name   string `json:"name"`
	Format string `json:"format"`
	Arch   string `json:"arch"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
	URL    string `json:"url"`
}

// updateCheck is one check of the feed: what GET /app/update reports and the package to install.
type updateCheck struct {
	info  UpdateInfo
	asset *updateAsset
	at    time.Time
}

// updateState caches the last check and lets only one install run at a time.
type updateState struct {
	mu         sync.Mutex // guards last
	last       *updateCheck
	installing sync.Mutex
	hooks      updateHooks
}

// updateHooks are the system calls updates make. Tests replace them so that no real
// command (rpm, dpkg-query, pkexec, the relaunch) runs; nil fields use the real system.
type updateHooks struct {
	lookPath       func(name string) (string, error)
	run            Runner
	start          func(name string, args ...string) error
	feedClient     *http.Client
	downloadClient *http.Client
	cacheDir       func() (string, error)
	now            func() time.Time
	arch           string
}

// ResolveUpdateFeed returns the feed URL from UpdateFeedEnv when it is set, else builtIn.
func ResolveUpdateFeed(builtIn string) string {
	if override := strings.TrimSpace(os.Getenv(UpdateFeedEnv)); override != "" {
		return override
	}
	return builtIn
}

// IsDevBuild reports whether version is a local build ("dev" or empty).
func IsDevBuild(version string) bool {
	version = strings.TrimSpace(version)
	return version == "" || strings.EqualFold(version, "dev")
}

// CompareVersions compares dotted versions part by part as numbers and returns -1, 0, or 1.
// A leading "v" and everything from the first character that is not a digit or a dot
// (such as the package release "-1") are ignored, and missing parts count as 0.
func CompareVersions(a, b string) int {
	partsA, partsB := versionParts(a), versionParts(b)
	for i := 0; i < max(len(partsA), len(partsB)); i++ {
		partA, partB := "0", "0"
		if i < len(partsA) {
			partA = partsA[i]
		}
		if i < len(partsB) {
			partB = partsB[i]
		}
		if cmp := compareDecimal(partA, partB); cmp != 0 {
			return cmp
		}
	}
	return 0
}

// versionParts returns the numeric parts of version without leading zeros.
func versionParts(version string) []string {
	version = strings.TrimSpace(version)
	if strings.HasPrefix(version, "v") || strings.HasPrefix(version, "V") {
		version = version[1:]
	}
	if end := strings.IndexFunc(version, func(r rune) bool { return r != '.' && (r < '0' || r > '9') }); end >= 0 {
		version = version[:end]
	}
	if version == "" {
		return nil
	}
	parts := strings.Split(version, ".")
	for i, part := range parts {
		if part = strings.TrimLeft(part, "0"); part == "" {
			part = "0"
		}
		parts[i] = part
	}
	return parts
}

// compareDecimal compares decimal strings without leading zeros, so any length works.
func compareDecimal(a, b string) int {
	if len(a) != len(b) {
		if len(a) < len(b) {
			return -1
		}
		return 1
	}
	return strings.Compare(a, b)
}

// allowedAssetURL accepts only GitHub release downloads.
func allowedAssetURL(raw string) bool {
	if !strings.HasPrefix(raw, "https://github.com/") && !strings.HasPrefix(raw, "https://objects.githubusercontent.com/") {
		return false
	}
	parsed, errParse := url.Parse(raw)
	return errParse == nil && parsed.User == nil &&
		(parsed.Host == "github.com" || parsed.Host == "objects.githubusercontent.com")
}

// usableAsset reports whether a feed asset is safe to offer: a plain file name of its
// format, a SHA-256, a GitHub download URL, and a size within the download limit.
func usableAsset(asset updateAsset) bool {
	return assetNamePattern.MatchString(asset.Name) &&
		strings.HasSuffix(asset.Name, "."+asset.Format) &&
		sha256Pattern.MatchString(asset.SHA256) &&
		allowedAssetURL(asset.URL) &&
		asset.Size >= 0 && asset.Size <= maxUpdateBytes
}

// selectAsset returns the usable package for format and arch, or nil.
func selectAsset(assets []updateAsset, format, arch string) *updateAsset {
	if format == "" {
		return nil
	}
	for _, asset := range assets {
		if asset.Format != format || asset.Arch != arch {
			continue
		}
		if !usableAsset(asset) {
			log.Warnf("update feed: ignoring package %q with an invalid name, checksum, size, or URL", asset.Name)
			continue
		}
		return &asset
	}
	return nil
}

func (s *Server) updateHooks() updateHooks {
	hooks := s.updates.hooks
	if hooks.lookPath == nil {
		hooks.lookPath = exec.LookPath
	}
	if hooks.run == nil {
		hooks.run = execRunner
	}
	if hooks.start == nil {
		hooks.start = startDetached
	}
	if hooks.feedClient == nil {
		hooks.feedClient = updateFeedClient
	}
	if hooks.downloadClient == nil {
		hooks.downloadClient = updateDownloadClient
	}
	if hooks.cacheDir == nil {
		hooks.cacheDir = os.UserCacheDir
	}
	if hooks.now == nil {
		hooks.now = time.Now
	}
	if hooks.arch == "" {
		hooks.arch = runtime.GOARCH
	}
	return hooks
}

func (h updateHooks) has(name string) bool {
	_, errLook := h.lookPath(name)
	return errLook == nil
}

// packageFormat returns how CLIProxyAPI is installed here: "rpm", "deb", or "" when unknown.
// An installed package decides first, then the package tools on PATH.
func (h updateHooks) packageFormat(ctx context.Context) string {
	ctx, cancel := context.WithTimeout(ctx, packageQueryTimeout)
	defer cancel()
	if _, errRPM := h.run(ctx, "rpm", "-q", updatePackageName); errRPM == nil {
		return "rpm"
	}
	if _, errDeb := h.run(ctx, "dpkg-query", "-W", updatePackageName); errDeb == nil {
		return "deb"
	}
	switch {
	case h.has("dnf") || h.has("rpm"):
		return "rpm"
	case h.has("apt-get"):
		return "deb"
	}
	return ""
}

// installer returns the package tool that installs format, or "" when there is none.
func (h updateHooks) installer(format string) string {
	switch format {
	case "rpm":
		if h.has("dnf") {
			return "dnf"
		}
		if h.has("rpm") {
			return "rpm"
		}
	case "deb":
		if h.has("apt-get") {
			return "apt-get"
		}
	}
	return ""
}

// installHint is the command a user can run to install the package by hand.
func installHint(asset updateAsset, installer string) string {
	install := "sudo apt install ./" + asset.Name
	switch {
	case asset.Format == "rpm" && installer == "rpm":
		install = "sudo rpm -U ./" + asset.Name
	case asset.Format == "rpm":
		install = "sudo dnf install ./" + asset.Name
	}
	return fmt.Sprintf("curl -fL -o %s %s && %s", asset.Name, shellQuote(asset.URL), install)
}

// shellQuote quotes value for a POSIX shell when it contains anything unusual.
func shellQuote(value string) string {
	if value != "" && strings.Trim(value, "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._~:/+@%=-") == "" {
		return value
	}
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

// fetchUpdateFeed downloads and decodes the release feed.
func fetchUpdateFeed(ctx context.Context, client *http.Client, feedURL, version string) (updateFeedFile, error) {
	var feed updateFeedFile
	if strings.TrimSpace(feedURL) == "" {
		return feed, errors.New("no update feed is configured")
	}
	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, feedURL, nil)
	if errReq != nil {
		return feed, fmt.Errorf("update feed: %w", errReq)
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "cliproxyapi-desktop/"+version)
	resp, errDo := client.Do(req)
	if errDo != nil {
		return feed, fmt.Errorf("fetch the update feed: %w", errDo)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.WithError(errClose).Debug("close update feed")
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return feed, fmt.Errorf("fetch the update feed: %s", resp.Status)
	}
	if errDecode := json.NewDecoder(io.LimitReader(resp.Body, maxUpdateFeedBytes)).Decode(&feed); errDecode != nil {
		return feed, fmt.Errorf("read the update feed: %w", errDecode)
	}
	if strings.TrimSpace(feed.Version) == "" {
		return feed, errors.New("read the update feed: it has no version")
	}
	return feed, nil
}

// checkUpdate returns the cached check, or checks the feed when the cache is stale or force is set.
func (s *Server) checkUpdate(ctx context.Context, force bool) updateCheck {
	hooks := s.updateHooks()
	s.updates.mu.Lock()
	defer s.updates.mu.Unlock()
	now := hooks.now()
	if last := s.updates.last; last != nil && !force {
		ttl := updateCacheTTL
		if last.info.Error != "" {
			ttl = updateErrorCacheTTL
		}
		if now.Sub(last.at) < ttl {
			return *last
		}
	}
	check := s.runUpdateCheck(ctx, hooks, now)
	s.updates.last = &check
	return check
}

func (s *Server) forgetUpdateCheck() {
	s.updates.mu.Lock()
	defer s.updates.mu.Unlock()
	s.updates.last = nil
}

func (s *Server) runUpdateCheck(ctx context.Context, hooks updateHooks, now time.Time) updateCheck {
	info := UpdateInfo{
		Current:   s.Version,
		DevBuild:  IsDevBuild(s.Version),
		CheckedAt: now.UTC().Format(time.RFC3339),
		Notes:     []string{},
	}
	check := updateCheck{at: now}
	feed, errFetch := fetchUpdateFeed(ctx, hooks.feedClient, s.UpdateFeed, s.Version)
	if errFetch != nil {
		log.WithError(errFetch).Warn("could not check for updates")
		info.Error = errFetch.Error()
		check.info = info
		return check
	}
	info.Latest = feed.Version
	info.Available = !info.DevBuild && CompareVersions(feed.Version, s.Version) > 0
	if feed.Notes != nil {
		info.Notes = feed.Notes
	}
	info.ReleaseURL = feed.ReleaseURL
	info.Published = feed.Published
	format := hooks.packageFormat(ctx)
	if asset := selectAsset(feed.Assets, format, hooks.arch); asset != nil {
		installer := hooks.installer(format)
		check.asset = asset
		info.Package = &UpdatePackage{Name: asset.Name, Format: asset.Format, Arch: asset.Arch, Size: asset.Size}
		info.CanInstall = installer != "" && hooks.has("pkexec")
		info.InstallHint = installHint(*asset, installer)
	}
	check.info = info
	return check
}

// downloadUpdate saves the package into the user's cache directory and checks its SHA-256.
// A package that does not match is deleted.
func downloadUpdate(ctx context.Context, hooks updateHooks, asset updateAsset) (string, error) {
	cacheDir, errCache := hooks.cacheDir()
	if errCache != nil {
		return "", fmt.Errorf("find the cache directory: %w", errCache)
	}
	dir := filepath.Join(cacheDir, "cliproxyapi", "updates")
	if errMkdir := os.MkdirAll(dir, 0o700); errMkdir != nil {
		return "", fmt.Errorf("create %s: %w", dir, errMkdir)
	}
	path := filepath.Join(dir, asset.Name)
	req, errReq := http.NewRequestWithContext(ctx, http.MethodGet, asset.URL, nil)
	if errReq != nil {
		return "", fmt.Errorf("download %s: %w", asset.Name, errReq)
	}
	resp, errDo := hooks.downloadClient.Do(req)
	if errDo != nil {
		return "", fmt.Errorf("download %s: %w", asset.Name, errDo)
	}
	defer func() {
		if errClose := resp.Body.Close(); errClose != nil {
			log.WithError(errClose).Debug("close update download")
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download %s: %s", asset.Name, resp.Status)
	}
	if resp.ContentLength > maxUpdateBytes {
		return "", fmt.Errorf("download %s: the package is larger than 512 MB", asset.Name)
	}
	removeFile(path)
	file, errOpen := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errOpen != nil {
		return "", fmt.Errorf("create %s: %w", path, errOpen)
	}
	hash := sha256.New()
	written, errCopy := io.Copy(io.MultiWriter(file, hash), io.LimitReader(resp.Body, maxUpdateBytes+1))
	errClose := file.Close()
	switch {
	case errCopy != nil:
		removeFile(path)
		return "", fmt.Errorf("download %s: %w", asset.Name, errCopy)
	case errClose != nil:
		removeFile(path)
		return "", fmt.Errorf("save %s: %w", path, errClose)
	case written > maxUpdateBytes:
		removeFile(path)
		return "", fmt.Errorf("download %s: the package is larger than 512 MB", asset.Name)
	}
	if sum := hex.EncodeToString(hash.Sum(nil)); !strings.EqualFold(sum, asset.SHA256) {
		removeFile(path)
		return "", fmt.Errorf("the downloaded %s does not match its SHA-256 checksum", asset.Name)
	}
	return path, nil
}

func removeFile(path string) {
	if errRemove := os.Remove(path); errRemove != nil && !errors.Is(errRemove, os.ErrNotExist) {
		log.WithError(errRemove).Warnf("remove %s", path)
	}
}

// installArgs are the pkexec arguments that install the package at path as root.
// The path, checksum, and format are passed as positional arguments to installScript.
func installArgs(path, sum, format string) []string {
	return []string{"/bin/sh", "-c", installScript, "sh", path, sum, format}
}

// exitCode returns the exit status carried by errRun, or -1 when the command did not run.
func exitCode(errRun error) int {
	var exitErr interface{ ExitCode() int }
	if errors.As(errRun, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

// outputTail returns the last lines of command output, short enough for a message or a log.
func outputTail(out []byte) string {
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) > outputTailLines {
		lines = lines[len(lines)-outputTailLines:]
	}
	tail := strings.Join(lines, "\n")
	if len(tail) > outputTailBytes {
		tail = strings.ToValidUTF8(tail[len(tail)-outputTailBytes:], "")
	}
	return tail
}

func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use GET"})
		return
	}
	force := r.URL.Query().Get("force")
	// The check is cached for everyone, so finish it even if this request goes away.
	check := s.checkUpdate(context.WithoutCancel(r.Context()), force == "1" || force == "true")
	writeJSON(w, http.StatusOK, check.info)
}

func (s *Server) handleUpdateInstall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	if !s.updates.installing.TryLock() {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "an update is already being installed"})
		return
	}
	defer s.updates.installing.Unlock()
	// Stopping a package manager halfway can leave the system broken, so the install
	// does not stop when the UI stops waiting.
	ctx := context.WithoutCancel(r.Context())
	hooks := s.updateHooks()
	check := s.checkUpdate(ctx, true)
	switch {
	case check.info.Error != "":
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "could not check for updates: " + check.info.Error})
		return
	case !check.info.Available:
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no update is available"})
		return
	case !check.info.CanInstall || check.asset == nil:
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "this system cannot install updates from the app; install the package manually"})
		return
	}
	asset := *check.asset

	log.Infof("downloading update %s (%s)", check.info.Latest, asset.Name)
	path, errDownload := downloadUpdate(r.Context(), hooks, asset)
	if errDownload != nil {
		log.WithError(errDownload).Warn("could not download the update")
		writeJSON(w, http.StatusBadGateway, map[string]string{"error": errDownload.Error()})
		return
	}
	defer removeFile(path)

	log.Infof("installing update %s", check.info.Latest)
	out, errInstall := hooks.run(ctx, "pkexec", installArgs(path, asset.SHA256, asset.Format)...)
	if errInstall != nil {
		code := exitCode(errInstall)
		if code == 126 || code == 127 {
			log.Info("update install was cancelled or not authorized")
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "cancelled"})
			return
		}
		tail := outputTail(out)
		log.WithError(errInstall).Warnf("update install failed: %s", tail)
		message := "the installer failed: " + errInstall.Error()
		if tail != "" {
			message += "\n" + tail
		}
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": message})
		return
	}
	log.Debugf("update installer output: %s", outputTail(out))
	log.Infof("installed update %s", check.info.Latest)

	if s.Service != nil {
		if errRestart := s.Service.Do(ctx, "restart"); errRestart != nil {
			log.WithError(errRestart).Warn("could not restart the proxy service after the update")
		}
	}
	s.forgetUpdateCheck()
	writeJSON(w, http.StatusOK, map[string]string{"status": "installed", "version": check.info.Latest})
}

func (s *Server) handleUpdateRelaunch(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
		return
	}
	if s.Quit == nil || !filepath.IsAbs(s.Executable) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "relaunching is unavailable; close and open the app again"})
		return
	}
	pid := strconv.Itoa(os.Getpid())
	if errStart := s.updateHooks().start("/bin/sh", "-c", relaunchScript, s.Executable, pid); errStart != nil {
		log.WithError(errStart).Warn("could not relaunch the app")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": errStart.Error()})
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "relaunching"})
	time.AfterFunc(relaunchDelay, s.Quit)
}
