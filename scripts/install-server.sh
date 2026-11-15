#!/usr/bin/env bash
# Installs or upgrades the CLIProxyAPI server package (cliproxyapi-server) from the latest
# GitHub release on Debian/Ubuntu (apt) or Fedora/RHEL (dnf/yum), amd64 or arm64:
#
#   curl -fsSL https://raw.githubusercontent.com/riyadmondol2006/CLIProxyAPI/main/scripts/install-server.sh | sudo bash
#
# The package runs the cliproxyapi-server system service on port 8317. Re-run to upgrade.
# CLIPROXYAPI_RELEASE_API overrides the release API URL (for mirrors and testing).
set -eu

REPO="riyadmondol2006/CLIProxyAPI"
API_URL="${CLIPROXYAPI_RELEASE_API:-https://api.github.com/repos/${REPO}/releases/latest}"
PACKAGE="cliproxyapi-server"
KEY_FILE="/etc/cliproxyapi/management-key"

die() {
  echo "error: $*" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || die "run as root, e.g.: curl -fsSL <this script's URL> | sudo bash"
[ "$(uname -s)" = Linux ] || die "only Linux is supported"

# Downloader: curl or wget.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -H "Accept: application/vnd.github+json" -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q --tries=3 --header="Accept: application/vnd.github+json" -O "$2" "$1"; }
else
  die "curl or wget is required"
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  sha256() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  die "sha256sum is required"
fi

case "$(uname -m)" in
  x86_64 | amd64) arch=amd64 rpm_arch=x86_64 ;;
  aarch64 | arm64) arch=arm64 rpm_arch=aarch64 ;;
  *) die "unsupported CPU architecture: $(uname -m) (amd64 and arm64 are supported)" ;;
esac

# Package manager, the release file to look for, and whether the desktop package is present.
if command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
  manager=apt
  pattern="/${PACKAGE}_[^/\"]*_${arch}[.]deb"
  installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q "install ok installed"; }
elif command -v dnf >/dev/null 2>&1; then
  manager=dnf
  pattern="/${PACKAGE}-[^/\"]*[.]${rpm_arch}[.]rpm"
  installed() { rpm -q "$1" >/dev/null 2>&1; }
elif command -v yum >/dev/null 2>&1; then
  manager=yum
  pattern="/${PACKAGE}-[^/\"]*[.]${rpm_arch}[.]rpm"
  installed() { rpm -q "$1" >/dev/null 2>&1; }
else
  die "no supported package manager found (apt, dnf or yum); try the Docker image instead"
fi

# The desktop package ships the same /usr/bin/cli-proxy-api; don't let the package
# manager remove it silently.
if installed cliproxyapi; then
  die "the desktop package 'cliproxyapi' is installed; remove it first (it conflicts with ${PACKAGE})"
fi

first_install=1
[ -e /etc/cliproxyapi/config.yaml ] && first_install=0

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
# apt reads local packages as the unprivileged _apt user.
chmod 0755 "$tmp"

echo "Finding the latest ${PACKAGE} release..."
fetch "$API_URL" "$tmp/release.json" ||
  die "could not read $API_URL (GitHub API rate limit or network problem?)"

# Without jq: put each release asset on its own line (assets start with their API url),
# then take the browser_download_url and digest from the line of the wanted package.
asset=$(tr -d '\r\n' <"$tmp/release.json" | awk -v pattern="$pattern" '
  {
    text = $0
    gsub(/"[ \t]*:[ \t]*/, "\":", text)
    n = split(text, parts, /"url":"https:\/\/api[.]github[.]com\/repos\/[^"]*\/releases\/assets\//)
    for (i = 2; i <= n; i++) {
      if (!match(parts[i], /"browser_download_url":"[^"]*"/)) continue
      url = substr(parts[i], RSTART + 24, RLENGTH - 25)
      if (url !~ (pattern "$")) continue
      digest = ""
      if (match(parts[i], /"digest":"sha256:[0-9a-fA-F]+"/)) digest = substr(parts[i], RSTART + 17, RLENGTH - 18)
      print url, digest
      exit
    }
  }')
[ -n "$asset" ] || die "the latest release has no ${PACKAGE} package for ${manager}/${arch}"
url=${asset%% *}
digest=${asset#* }
[ -n "$digest" ] && [ "$digest" != "$url" ] || die "the release lists no sha256 digest for ${url##*/}"
name=${url##*/}

echo "Downloading ${name}..."
fetch "$url" "$tmp/$name" || die "download failed: $url"
chmod 0644 "$tmp/$name"
actual=$(sha256 "$tmp/$name")
if [ "$(printf '%s' "$actual" | tr 'A-F' 'a-f')" != "$(printf '%s' "$digest" | tr 'A-F' 'a-f')" ]; then
  die "sha256 mismatch for ${name}: expected ${digest}, got ${actual}"
fi
echo "Verified sha256 ${actual}"

echo "Installing ${name} with ${manager}..."
case "$manager" in
  apt)
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -q || echo "warning: apt-get update failed; continuing" >&2
    apt-get install -y "$tmp/$name"
    ;;
  dnf) dnf install -y "$tmp/$name" ;;
  yum) yum install -y "$tmp/$name" ;;
esac

# A first install already printed the package's message with the URL and the new key.
if [ "$first_install" -eq 0 ]; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}') || ip=""
  fi
  [ -n "$ip" ] || ip="<this-server-ip>"
  echo
  echo "CLIProxyAPI server is up to date (${name})."
  echo "  Open:           http://${ip}:8317/"
  echo "  Show the key:   sudo cat ${KEY_FILE}"
  echo "  Service:        sudo systemctl status cliproxyapi-server"
fi
if [ -d /run/systemd/system ] && ! systemctl is-active --quiet cliproxyapi-server 2>/dev/null; then
  echo "warning: the service is not running; see: sudo journalctl -u cliproxyapi-server" >&2
fi
