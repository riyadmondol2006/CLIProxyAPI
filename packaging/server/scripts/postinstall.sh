#!/bin/sh
# cliproxyapi-server: create the service user, the config with a management key on first
# install, and start the system service. Upgrades keep the config and key and restart it.
# deb calls this with "configure <old-version>", rpm with 1 (install) or 2 (upgrade).
set -e

SERVICE=cliproxyapi-server.service
SVC_USER=cliproxyapi
CONF_DIR=/etc/cliproxyapi
CONF="$CONF_DIR/config.yaml"
KEY_FILE="$CONF_DIR/management-key"
DATA_DIR=/var/lib/cliproxyapi
SHARE_DIR=/usr/share/cliproxyapi

case "${1:-}" in
  abort-*) exit 0 ;;
esac

# A new package install (not an upgrade): enable and start the service.
fresh=0
case "${1:-}" in
  1) fresh=1 ;;
  configure) [ -n "${2:-}" ] || fresh=1 ;;
esac

if ! getent group "$SVC_USER" >/dev/null 2>&1; then
  groupadd --system "$SVC_USER"
fi
if ! getent passwd "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --gid "$SVC_USER" --home-dir "$DATA_DIR" --no-create-home \
    --shell /usr/sbin/nologin --comment "CLIProxyAPI server" "$SVC_USER"
fi

# The service rewrites its config atomically (temp file + rename), so it owns the directory.
install -d -m 0750 -o "$SVC_USER" -g "$SVC_USER" "$CONF_DIR" "$DATA_DIR"
install -d -m 0700 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR/auths"
install -d -m 0755 -o "$SVC_USER" -g "$SVC_USER" "$DATA_DIR/static"
install -m 0644 -o "$SVC_USER" -g "$SVC_USER" "$SHARE_DIR/management.html" "$DATA_DIR/static/management.html"

key=""
if [ ! -e "$CONF" ]; then
  # 24 random bytes = 32 URL-safe characters.
  key=$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '\n=')
  umask 077
  printf '%s\n' "$key" >"$KEY_FILE.tmp"
  chown root:root "$KEY_FILE.tmp"
  chmod 0600 "$KEY_FILE.tmp"
  mv -f "$KEY_FILE.tmp" "$KEY_FILE"
  sed "s|__MANAGEMENT_KEY__|$key|" "$SHARE_DIR/config.default.yaml" >"$CONF.tmp"
  chown "$SVC_USER:$SVC_USER" "$CONF.tmp"
  chmod 0600 "$CONF.tmp"
  mv -f "$CONF.tmp" "$CONF"
  fresh=1
fi

if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
  if [ "$fresh" = 1 ]; then
    systemctl enable --now "$SERVICE" >/dev/null 2>&1 ||
      echo "warning: could not start $SERVICE; see: journalctl -u $SERVICE" >&2
  else
    systemctl try-restart "$SERVICE" >/dev/null 2>&1 || true
  fi
fi

if [ "$fresh" = 1 ]; then
  ip=$(hostname -I 2>/dev/null | awk '{print $1}') || ip=""
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") {print $(i + 1); exit}}') || ip=""
  fi
  [ -n "$ip" ] || ip="<this-server-ip>"
  echo
  echo "CLIProxyAPI server is installed."
  echo "  Open:           http://$ip:8317/"
  if [ -n "$key" ]; then
    echo "  Management key: $key"
  fi
  echo "  Show the key:   sudo cat $KEY_FILE"
  echo "  Config:         $CONF"
  echo "  Logs:           sudo journalctl -u cliproxyapi-server -f"
  echo
fi
exit 0
