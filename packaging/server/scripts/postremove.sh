#!/bin/sh
# cliproxyapi-server: reload systemd after removal. "apt purge" also deletes the config,
# the management key and all data; "apt remove" and rpm erase keep them.
if [ "${1:-}" = purge ]; then
  rm -rf /etc/cliproxyapi /var/lib/cliproxyapi
fi
if [ -d /run/systemd/system ]; then
  systemctl daemon-reload >/dev/null 2>&1 || true
fi
exit 0
