#!/bin/sh
# Install the Vibeproof dashboard as a systemd user service, so it is always
# running on http://localhost:4173: started at login (or at boot when lingering
# is enabled for the user), restarted if it stops, rebuilt before each start.
#
#   sh scripts/install-dashboard-service.sh            install or update
#   sh scripts/install-dashboard-service.sh --remove   stop and uninstall
#
# Re-run it after moving the project or changing the Node version: the unit
# stores absolute paths because systemd does not load nvm.
set -eu

UNIT=vibeproof-dashboard.service
UNIT_DIR="$HOME/.config/systemd/user"

if [ "${1:-}" = "--remove" ]; then
  systemctl --user disable --now "$UNIT" 2>/dev/null || true
  rm -f "$UNIT_DIR/$UNIT"
  systemctl --user daemon-reload
  echo "Removed $UNIT"
  exit 0
fi

APP_DIR=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node) || { echo "node not found on PATH" >&2; exit 1; }
[ -f "$APP_DIR/node_modules/typescript/bin/tsc" ] || { echo "Run npm install in $APP_DIR first" >&2; exit 1; }

mkdir -p "$UNIT_DIR"
cat > "$UNIT_DIR/$UNIT" <<EOF
[Unit]
Description=Vibeproof dashboard (http://localhost:4173)
Documentation=file://$APP_DIR/README.md

[Service]
Type=simple
WorkingDirectory=$APP_DIR
# Rebuild first so the service always runs the current code (after git pull, edits).
ExecStartPre=$NODE $APP_DIR/node_modules/typescript/bin/tsc -p $APP_DIR/tsconfig.json
ExecStart=$NODE $APP_DIR/dist/cli.js dashboard --port 4173
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable "$UNIT"
systemctl --user restart "$UNIT"
echo "Installed $UNIT: http://localhost:4173"
if ! loginctl show-user "$USER" -p Linger 2>/dev/null | grep -q yes; then
  echo "Note: it starts when you log in. To start it at boot before login: loginctl enable-linger $USER"
fi
