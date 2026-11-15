#!/bin/sh
# Container entrypoint for CLIProxyAPI. Everything the proxy keeps lives in /data:
# config.yaml, management-key, auths/, static/ (the control panel), logs and usage.
set -eu

DATA_DIR=/data
CONF="$DATA_DIR/config.yaml"
KEY_FILE="$DATA_DIR/management-key"
BIN=/usr/bin/cli-proxy-api

# Run another command when one is given, e.g. "docker run ... cliproxyapi sh".
if [ "$#" -gt 0 ] && [ "${1#-}" = "$1" ]; then
  exec "$@"
fi

if ! touch "$DATA_DIR/.write-test" 2>/dev/null; then
  echo "error: $DATA_DIR is not writable by uid $(id -u). Use a named volume, or" >&2
  echo "       chown the mounted directory to $(id -u):$(id -g)." >&2
  exit 1
fi
rm -f "$DATA_DIR/.write-test"

mkdir -p "$DATA_DIR/auths" "$DATA_DIR/static"
chmod 0700 "$DATA_DIR/auths"
# Serve the control panel baked into this image, also when offline.
cp -f /usr/share/cliproxyapi/management.html "$DATA_DIR/static/management.html"

if [ ! -e "$CONF" ]; then
  key="${CPA_MANAGEMENT_KEY:-}"
  generated=0
  if [ -z "$key" ]; then
    # 24 random bytes = 32 URL-safe characters.
    key=$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n=')
    generated=1
  fi
  case "$key" in
    *"
"*)
      echo "error: CPA_MANAGEMENT_KEY must be a single line" >&2
      exit 1
      ;;
  esac
  # YAML single-quoted string: a quote is written as two quotes.
  quoted=$(printf '%s' "$key" | sed "s/'/''/g")
  umask 077
  cat >"$CONF.tmp" <<CONFIG
# CLIProxyAPI configuration, created on the container's first start.
# The web control panel edits this file. Every option is described in
# /usr/share/cliproxyapi/config.example.yaml inside the image.
config-version: 8

server:
  host: ""
  port: 8317

management:
  # Allow the web control panel and management API from other machines.
  allow-remote: true
  # Replaced by its hash on startup.
  secret-key: '$quoted'
  # The panel ships with the image, so never download another one.
  disable-auto-update-panel: true

# Client API keys. Create them in the web control panel. Until one exists,
# require-api-key makes the proxy refuse every request instead of serving them openly.
access:
  require-api-key: true
  api-keys: []

oauth:
  auth-dir: "$DATA_DIR/auths"
CONFIG
  mv -f "$CONF.tmp" "$CONF"
  if [ "$generated" = 1 ]; then
    printf '%s\n' "$key" >"$KEY_FILE"
    chmod 0600 "$KEY_FILE"
    echo "=================================================================="
    echo " CLIProxyAPI first start: a management key was generated."
    echo ""
    echo "   Management key: $key"
    echo ""
    echo " Open http://<this-host>:8317/ and log in with it."
    echo " It is shown only once. Saved in $KEY_FILE inside the volume:"
    echo "   docker exec <container> cat $KEY_FILE"
    echo "=================================================================="
  else
    echo "CLIProxyAPI first start: created $CONF with the key from CPA_MANAGEMENT_KEY."
  fi
  umask 022
fi

exec "$BIN" --config "$CONF" "$@"
