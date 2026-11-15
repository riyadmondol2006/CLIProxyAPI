#!/bin/sh
# cliproxyapi-server: stop and disable the service on removal, not on upgrade.
# deb calls this with "remove" or "upgrade", rpm with 0 (erase) or 1 (upgrade).
case "${1:-}" in
  remove | 0)
    if [ -d /run/systemd/system ]; then
      systemctl disable --now cliproxyapi-server.service >/dev/null 2>&1 || true
    fi
    ;;
esac
exit 0
